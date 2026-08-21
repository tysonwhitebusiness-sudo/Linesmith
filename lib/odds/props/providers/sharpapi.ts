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
import type { GameLine } from '../../oddsApi';

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

// ---------------------------------------------------------------------------
// Game-level lines (moneyline/spread/total) — a second, separately cached
// board fetch with `is_player_prop=false`. Confirmed live this session (MLB):
// the `is_player_prop=true` board used above only leaks a handful of
// team/futures rows through incidentally; the real team-level board lives at
// this separate filter value, with real `market_type`s like `moneyline`,
// `run_line` (baseball's spread-equivalent), and `total_runs`, each row
// tagged `is_main_line` to distinguish the main number from alternate lines.
// NFL's own `market_type` names weren't observed live (no real NFL game was
// on SharpAPI's preseason board at build time — only outright futures like
// MVP/Rookie of the Year), so the same baseball-derived category sets below
// include football's likely names (`spread`, `total_points`) as an educated
// extension of the confirmed pattern, not a guess at unrelated shapes.
const gameLinesBoardCache = new Map<SportKey, { fetchedAt: number; response: SharpApiResponse }>();

async function fetchGameLinesBoard(
  config: ReturnType<typeof sharpApiConfig>,
  sportKey: SportKey,
): Promise<{ response: SharpApiResponse | null; wasFetched: boolean }> {
  const cached = gameLinesBoardCache.get(sportKey);
  if (cached && Date.now() - cached.fetchedAt < BOARD_TTL_MS) {
    return { response: cached.response, wasFetched: false };
  }

  const mapping = SPORT_LEAGUE[sportKey];
  if (!mapping) return { response: null, wasFetched: false };

  const url = `${BASE}/odds?sport=${mapping.sport}&league=${mapping.league}&is_player_prop=false&limit=500`;
  try {
    const res = await fetch(url, { headers: { 'X-API-Key': config.key ?? '' }, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { response: cached?.response ?? null, wasFetched: true };
    const response = (await res.json()) as SharpApiResponse;
    gameLinesBoardCache.set(sportKey, { fetchedAt: Date.now(), response });
    return { response, wasFetched: true };
  } catch {
    return { response: cached?.response ?? null, wasFetched: true };
  }
}

const MONEYLINE_TYPE = 'moneyline';
const SPREAD_TYPES = new Set(['spread', 'run_line', 'puck_line', 'point_spread']);
const TOTAL_TYPES = new Set(['total_points', 'total_runs', 'total_goals']);

interface GameLineAccumulator {
  eventId: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  moneylineHome?: { price: number; book: string };
  moneylineAway?: { price: number; book: string };
  spreadHome?: { point: number; price: number; book: string };
  spreadAway?: { point: number; price: number; book: string };
  totalOver?: { point: number; price: number; book: string };
  totalUnder?: { point: number; price: number; book: string };
  books: Set<string>;
}

/**
 * Real moneyline/spread/total lines for every game currently on SharpAPI's
 * board for a sport — unmetered, so this is a free side effect of the same
 * account already used for player props. Best-price-per-side, matching
 * `summariseOddsEvent`'s "best available" convention in oddsApi.ts.
 */
export async function getSharpApiGameLines(
  sportKey: SportKey,
): Promise<{ lines: GameLine[]; fetchedAt: string | null; warnings: string[] }> {
  const config = sharpApiConfig();
  if (!config.enabled) return { lines: [], fetchedAt: null, warnings: ['SharpAPI is disabled.'] };
  if (!SPORT_LEAGUE[sportKey]) {
    return { lines: [], fetchedAt: null, warnings: [`SharpAPI has no sport/league mapping for ${sportKey}.`] };
  }

  const { response, wasFetched } = await fetchGameLinesBoard(config, sportKey);
  if (!response) return { lines: [], fetchedAt: null, warnings: ['SharpAPI game-lines request failed.'] };

  const byEvent = new Map<string, GameLineAccumulator>();

  for (const row of response.data) {
    if (row.is_player_prop || !row.is_main_line) continue;

    let acc = byEvent.get(row.event_id);
    if (!acc) {
      acc = {
        eventId: row.event_id,
        commenceTime: row.event_start_time,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        books: new Set(),
      };
      byEvent.set(row.event_id, acc);
    }
    acc.books.add(row.sportsbook);

    if (row.market_type === MONEYLINE_TYPE) {
      if (row.team_side === 'home' && (!acc.moneylineHome || row.odds_american > acc.moneylineHome.price)) {
        acc.moneylineHome = { price: row.odds_american, book: row.sportsbook };
      }
      if (row.team_side === 'away' && (!acc.moneylineAway || row.odds_american > acc.moneylineAway.price)) {
        acc.moneylineAway = { price: row.odds_american, book: row.sportsbook };
      }
    } else if (SPREAD_TYPES.has(row.market_type) && row.line != null) {
      if (row.team_side === 'home' && !acc.spreadHome) {
        acc.spreadHome = { point: row.line, price: row.odds_american, book: row.sportsbook };
      }
      if (row.team_side === 'away' && !acc.spreadAway) {
        acc.spreadAway = { point: row.line, price: row.odds_american, book: row.sportsbook };
      }
    } else if (TOTAL_TYPES.has(row.market_type) && row.line != null) {
      if (row.selection_type === 'over' && !acc.totalOver) {
        acc.totalOver = { point: row.line, price: row.odds_american, book: row.sportsbook };
      }
      if (row.selection_type === 'under' && !acc.totalUnder) {
        acc.totalUnder = { point: row.line, price: row.odds_american, book: row.sportsbook };
      }
    }
  }

  const lines: GameLine[] = [...byEvent.values()].map((acc) => ({
    eventId: acc.eventId,
    commenceTime: acc.commenceTime,
    homeTeam: acc.homeTeam,
    awayTeam: acc.awayTeam,
    // SharpAPI's own game-line board doesn't build a per-book breakdown the
    // way oddsApi.ts now does — out of scope for that fix, left empty here.
    bookmakers: [],
    moneyline:
      acc.moneylineHome || acc.moneylineAway
        ? {
            home: acc.moneylineHome?.price,
            away: acc.moneylineAway?.price,
            book: acc.moneylineHome && acc.moneylineAway && acc.moneylineHome.book === acc.moneylineAway.book
              ? acc.moneylineHome.book
              : undefined,
          }
        : undefined,
    spread:
      acc.spreadHome || acc.spreadAway
        ? {
            homePoint: acc.spreadHome?.point,
            homePrice: acc.spreadHome?.price,
            awayPoint: acc.spreadAway?.point,
            awayPrice: acc.spreadAway?.price,
            book: acc.spreadHome?.book,
          }
        : undefined,
    total:
      acc.totalOver || acc.totalUnder
        ? {
            point: acc.totalOver?.point ?? acc.totalUnder?.point,
            overPrice: acc.totalOver?.price,
            underPrice: acc.totalUnder?.price,
            book: acc.totalOver?.book ?? acc.totalUnder?.book,
          }
        : undefined,
    bookCount: acc.books.size,
  }));

  return { lines, fetchedAt: wasFetched ? new Date().toISOString() : null, warnings: [] };
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
