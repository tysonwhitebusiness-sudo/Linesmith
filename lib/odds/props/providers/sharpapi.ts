/**
 * SharpAPI — Tier 1 baseline coverage.
 *
 * Verified live in docs/odds-provider-verification.md § 1. Free tier: DK +
 * FD only, 60s delay, 12 req/min, no monthly cap. The response's own
 * `meta.tier` block self-documents delay/books/rate on every call — read
 * from there rather than trusting only the env defaults, so a plan change
 * shows up automatically.
 */

import type { FetchResult, GameLookupContext, NormalizedPropRow, ProviderAdapter, SportKey, UnresolvedRow } from '../types';
import { sharpApiConfig } from '../config';
import {
  buildRosterIndex,
  normalizeBookmaker,
  resolveMarketKey,
  resolvePlayer,
  unresolvedBookmaker,
  unresolvedMarket,
  unresolvedPlayer,
} from '../entityResolution';

const BASE = 'https://api.sharpapi.io/api/v1';

/**
 * SharpAPI's own `sport`/`league` query values per Linesmith sport — confirmed
 * live this session (`sport=baseball&league=mlb`, `sport=football&league=nfl`).
 * Only sports actually verified live are listed; an unmapped sport is treated
 * as unsupported rather than guessed.
 */
const SPORT_LEAGUE: Partial<Record<SportKey, { sport: string; league: string }>> = {
  mlb: { sport: 'baseball', league: 'mlb' },
  nfl: { sport: 'football', league: 'nfl' },
};

interface SharpApiRow {
  sportsbook: string;
  event_id: string;
  home_team: string;
  away_team: string;
  selection: string;
  selection_type: string;
  market_type: string;
  team_side?: 'home' | 'away';
  odds_american: number;
  odds_decimal: number;
  line: number | null;
  is_main_line: boolean;
  event_start_time: string;
  player_name?: string | null;
  stat_category?: string | null;
  is_player_prop: boolean;
}

interface SharpApiResponse {
  data: SharpApiRow[];
  meta?: { tier?: { data_delay_seconds?: number; books?: string[]; requests_per_minute?: number } };
}

// One SharpAPI call returns every game's player props for a sport, not just
// one — `fetchGameProps` is called once per game in a slate-wide refresh, so
// without this cache a 15-game slate would issue 15 identical league-wide
// requests and burn most of the 12/min budget re-fetching the same board.
// TTL matches the provider's own documented delay: refetching faster than
// the data itself changes buys nothing. Keyed per sport now that this adapter
// serves more than MLB.
const propsBoardCache = new Map<SportKey, { fetchedAt: number; response: SharpApiResponse }>();
const BOARD_TTL_MS = 90_000;
// No timeout on these fetches meant a slow/hung connection could stall
// every caller on the useGameLines/candidate-building hot path indefinitely.
const FETCH_TIMEOUT_MS = 8_000;

async function fetchProps(
  config: ReturnType<typeof sharpApiConfig>,
  sportKey: SportKey,
): Promise<{ response: SharpApiResponse | null; wasFetched: boolean }> {
  const cached = propsBoardCache.get(sportKey);
  if (cached && Date.now() - cached.fetchedAt < BOARD_TTL_MS) {
    return { response: cached.response, wasFetched: false };
  }

  const mapping = SPORT_LEAGUE[sportKey];
  if (!mapping) return { response: null, wasFetched: false };

  const url = `${BASE}/odds?sport=${mapping.sport}&league=${mapping.league}&is_player_prop=true&limit=500`;
  try {
    const res = await fetch(url, { headers: { 'X-API-Key': config.key ?? '' }, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { response: cached?.response ?? null, wasFetched: true };
    const response = (await res.json()) as SharpApiResponse;
    propsBoardCache.set(sportKey, { fetchedAt: Date.now(), response });
    return { response, wasFetched: true };
  } catch {
    // Timeout or network failure — serve the last cached board (even if
    // past TTL) rather than letting a hung connection stall every caller.
    return { response: cached?.response ?? null, wasFetched: true };
  }
}

export const sharpApiAdapter: ProviderAdapter = {
  meta: {
    id: 'sharpapi',
    label: 'SharpAPI',
    scheduled: true, // Tier 1's MLB loop — see types.ts's ProviderMeta.scheduled doc
    get enabled() {
      return sharpApiConfig().enabled;
    },
    delaySeconds: sharpApiConfig().delaySeconds,
    books: ['draftkings', 'fanduel'],
  },

  async fetchGameProps(game: GameLookupContext): Promise<FetchResult> {
    const config = sharpApiConfig();
    if (!config.enabled) return { rows: [], unresolved: [], cost: {}, warnings: ['SharpAPI is disabled.'] };

    if (!SPORT_LEAGUE[game.sport]) {
      return { rows: [], unresolved: [], cost: {}, warnings: [`SharpAPI has no sport/league mapping for ${game.sport}.`] };
    }

    const { response: json, wasFetched } = await fetchProps(config, game.sport);
    const cost = { requests: wasFetched ? 1 : 0 };
    if (!json) return { rows: [], unresolved: [], cost, warnings: ['SharpAPI request failed.'] };

    const rosterIndex = buildRosterIndex(game.roster);
    const rows: NormalizedPropRow[] = [];
    const unresolved: UnresolvedRow[] = [];
    const delaySeconds = json.meta?.tier?.data_delay_seconds ?? config.delaySeconds;
    const fetchedAt = new Date().toISOString();

    // SharpAPI's feed spans every game live right now — scope to this one.
    const forThisGame = json.data.filter(
      (r) =>
        (r.home_team === game.homeTeamName && r.away_team === game.awayTeamName) ||
        (r.home_team === game.awayTeamName && r.away_team === game.homeTeamName),
    );

    for (const row of forThisGame) {
      if (!row.player_name || !row.stat_category) continue; // team/futures rows slipped past the filter

      const bookmaker = normalizeBookmaker(row.sportsbook);
      if (!bookmaker) {
        unresolved.push(unresolvedBookmaker(row.sportsbook, `SharpAPI event ${row.event_id}`));
        continue;
      }

      const marketKey = resolveMarketKey(row.stat_category);
      if (!marketKey) {
        unresolved.push(unresolvedMarket(row.stat_category, `player ${row.player_name}`));
        continue;
      }

      // The row doesn't reliably say which side the player is on, so try both
      // — `resolvePlayer` matches on exact normalized name first regardless of
      // the team hint, and only falls back to the team-scoped last-name match
      // when that fails, so trying both sides here is safe rather than loose.
      const player =
        resolvePlayer(row.player_name, game.homeAbbr, rosterIndex) ??
        resolvePlayer(row.player_name, game.awayAbbr, rosterIndex);
      if (!player) {
        unresolved.push(unresolvedPlayer(row.player_name, `SharpAPI event ${row.event_id}`));
        continue;
      }

      rows.push({
        providerId: 'sharpapi',
        gameId: game.gameId,
        subjectId: player.subjectId,
        subjectName: player.subjectName,
        marketKey,
        line: row.line,
        side: row.selection_type,
        bookmaker,
        americanOdds: row.odds_american,
        decimalOdds: row.odds_decimal ?? null,
        fetchedAt,
        isDelayed: delaySeconds > 0,
        delaySeconds,
      });
    }

    return { rows, unresolved, cost, warnings: [] };
  },
};
