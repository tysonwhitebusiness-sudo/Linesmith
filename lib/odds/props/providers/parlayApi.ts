/**
 * ParlayAPI — Tier 1, multi-sport (MLB, NFL, CFB, Soccer, Tennis).
 *
 * Live-verified this session: NFL (2,870 rows, 8 books incl. Pinnacle/
 * Underdog/PrizePicks/Novig), CFB (1,505 rows, 4 books), MLB (5,000+ rows,
 * 18 books), Soccer/EPL (787 rows, team-total-heavy, thin books — treated as
 * secondary per the odds-stack plan). Tennis returned only alternate
 * game-level lines, no real player props — SharpAPI stays tennis's primary
 * source, this adapter still supports the sport key for completeness but
 * isn't scheduled for it.
 *
 * Registered twice under two different provider ids sharing this same
 * implementation (`parlayApiAdapter` / `parlayApiMlbAdapter`) — two separate
 * API keys, two separate `provider_usage` budgets, so MLB usage on the
 * dedicated key never competes with NFL/CFB usage on the general key.
 *
 * Billing: the `/sports/{sport}/props` endpoint returns the WHOLE slate for
 * that sport in one call (like SharpAPI's board), not per-event — one board
 * cache per (config, sport) pair avoids re-fetching the same board once per
 * game in a slate-wide refresh loop.
 */

import type { FetchResult, GameLookupContext, NormalizedPropRow, ProviderAdapter, SportKey, UnresolvedRow } from '../types';
import { parlayApiConfig, parlayApiMlbConfig } from '../config';
import { buildRosterIndex, normalizeBookmaker, resolveMarketKey, resolvePlayer, unresolvedBookmaker, unresolvedMarket, unresolvedPlayer } from '../entityResolution';

const BASE = 'https://parlay-api.com/v1';

const SPORT_KEYS: Record<SportKey, string> = {
  mlb: 'baseball_mlb',
  nfl: 'americanfootball_nfl',
  cfb: 'americanfootball_ncaaf',
  soccer_epl: 'soccer_epl',
  tennis_atp: 'tennis_atp',
  tennis_wta: 'tennis_wta',
};

interface ParlayPropRow {
  event_id: string;
  home_team: string;
  away_team: string;
  bookmaker_title: string;
  player: string;
  market: string;
  line: number | null;
  over_price?: number | null;
  under_price?: number | null;
}

// One board per (config id, sport) — a slate-wide refresh loop calls
// fetchGameProps once per game, so without this a 15-game MLB slate would
// issue 15 identical whole-sport requests.
const boardCache = new Map<string, { fetchedAt: number; rows: ParlayPropRow[] }>();
const BOARD_TTL_MS = 90_000;

async function fetchBoard(configKey: string, apiKey: string, sportKey: string): Promise<{ rows: ParlayPropRow[]; wasFetched: boolean; creditsUsed: number }> {
  const cacheKey = `${configKey}:${sportKey}`;
  const cached = boardCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < BOARD_TTL_MS) {
    return { rows: cached.rows, wasFetched: false, creditsUsed: 0 };
  }

  const res = await fetch(`${BASE}/sports/${sportKey}/props`, { headers: { 'X-API-Key': apiKey }, cache: 'no-store' });
  if (!res.ok) return { rows: cached?.rows ?? [], wasFetched: true, creditsUsed: 0 };

  const rows = (await res.json()) as ParlayPropRow[];
  boardCache.set(cacheKey, { fetchedAt: Date.now(), rows });

  // ParlayAPI bills per unique market returned x regions, not a fixed rate —
  // the response doesn't self-report a per-call cost, so we track spend via
  // the account-wide x-requests-used header delta rather than guessing.
  const used = Number(res.headers.get('x-requests-used'));
  return { rows, wasFetched: true, creditsUsed: Number.isFinite(used) ? used : 0 };
}

function buildAdapter(id: 'parlayapi' | 'parlayapi_mlb', getConfig: typeof parlayApiConfig): ProviderAdapter {
  return {
    meta: {
      id,
      label: id === 'parlayapi_mlb' ? 'ParlayAPI (MLB)' : 'ParlayAPI',
      tier: 'tier1',
      get enabled() {
        return getConfig().enabled;
      },
      delaySeconds: null,
      books: ['draftkings', 'fanduel', 'betmgm', 'pinnacle', 'bovada'],
    },

    async fetchGameProps(game: GameLookupContext): Promise<FetchResult> {
      const config = getConfig();
      if (!config.enabled || !config.key) {
        return { rows: [], unresolved: [], cost: {}, warnings: [`${id} is disabled.`] };
      }

      const sportKey = SPORT_KEYS[game.sport];
      const { rows: board, wasFetched, creditsUsed } = await fetchBoard(id, config.key, sportKey);
      const cost = wasFetched ? { requests: creditsUsed } : {};

      const forThisGame = board.filter(
        (r) =>
          (r.home_team === game.homeTeamName && r.away_team === game.awayTeamName) ||
          (r.home_team === game.awayTeamName && r.away_team === game.homeTeamName),
      );

      const rosterIndex = buildRosterIndex(game.roster);
      const rows: NormalizedPropRow[] = [];
      const unresolved: UnresolvedRow[] = [];
      const fetchedAt = new Date().toISOString();

      for (const row of forThisGame) {
        const bookmaker = normalizeBookmaker(row.bookmaker_title);
        if (!bookmaker) {
          unresolved.push(unresolvedBookmaker(row.bookmaker_title, `${id} event ${row.event_id}`));
          continue;
        }
        const marketKey = resolveMarketKey(row.market);
        if (!marketKey) {
          unresolved.push(unresolvedMarket(row.market, `player ${row.player}`));
          continue;
        }
        const player = resolvePlayer(row.player, game.homeAbbr, rosterIndex) ?? resolvePlayer(row.player, game.awayAbbr, rosterIndex);
        if (!player) {
          unresolved.push(unresolvedPlayer(row.player, `${id} event ${row.event_id}`));
          continue;
        }

        for (const [side, price] of [
          ['over', row.over_price],
          ['under', row.under_price],
        ] as const) {
          if (price == null) continue;
          rows.push({
            providerId: id,
            gameId: game.gameId,
            subjectId: player.subjectId,
            subjectName: player.subjectName,
            marketKey,
            line: row.line,
            side,
            bookmaker,
            americanOdds: price,
            decimalOdds: null,
            fetchedAt,
            isDelayed: false,
            delaySeconds: null,
          });
        }
      }

      return { rows, unresolved, cost, warnings: [] };
    },
  };
}

export const parlayApiAdapter = buildAdapter('parlayapi', parlayApiConfig);
export const parlayApiMlbAdapter = buildAdapter('parlayapi_mlb', parlayApiMlbConfig);
