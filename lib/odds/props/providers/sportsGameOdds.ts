/**
 * SportsGameOdds — Tier 2, "More books". User-triggered only, never scheduled.
 *
 * Verified live in docs/odds-provider-verification.md § 3: confirmed exactly
 * 1 object billed per event returned, with the full player-prop board
 * embedded in that same event object — 8 books, ~5 min delay, 19 stat
 * categories, dramatically better than either of the two conflicting
 * pre-Phase-0 estimates.
 *
 * `teamID` follows an observed, derivable pattern (`DETROIT_TIGERS_MLB` for
 * "Detroit Tigers") rather than a documented lookup table — scoping the
 * request to exactly the two teams playing, narrowed by a time window, is
 * what keeps this to exactly 1 billed object per "More books" click instead
 * of pulling (and billing for) the whole day's slate.
 */

import type { FetchResult, GameLookupContext, NormalizedPropRow, ProviderAdapter, SportKey, UnresolvedRow } from '../types';
import { sportsGameOddsConfig } from '../config';
import { buildRosterIndex, normalizeBookmaker, resolveMarketKey, resolvePlayer, unresolvedBookmaker, unresolvedMarket, unresolvedPlayer } from '../entityResolution';
import type { GameLine } from '../../oddsApi';

const BASE = 'https://api.sportsgameodds.com/v2';

/**
 * SportsGameOdds' own league id per sport — confirmed live this session for
 * NFL/NCAAF (real props found); MLS/UEFA Champions League are the only
 * soccer leagues on this account's plan (not EPL, which stays on Propline),
 * so no soccer_epl entry here on purpose.
 */
const LEAGUE_IDS: Partial<Record<SportKey, string>> = {
  mlb: 'MLB',
  nfl: 'NFL',
  cfb: 'NCAAF',
};

function sgoTeamId(fullName: string, leagueId: string): string {
  const slug = fullName
    .toUpperCase()
    .replace(/[.']/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${slug}_${leagueId}`;
}

interface SgoOddEntry {
  statID: string;
  playerID?: string | null;
  /** Present on game-level rows instead of playerID: 'home' | 'away' | 'all'. */
  statEntityID?: string;
  /** 'game' for full-game lines; inning/quarter/half-scoped rows use other values, filtered out. */
  periodID?: string;
  /** 'ml' moneyline, 'sp' spread, 'ou' over/under — confirmed live this session (MLB). */
  betTypeID?: string;
  sideID: string;
  bookOdds?: string;
  bookOddsAvailable?: boolean;
  bookOverUnder?: string;
  bookSpread?: string;
  byBookmaker?: Record<
    string,
    { odds: string; overUnder?: string; spread?: string; available: boolean; lastUpdatedAt: string }
  >;
}

interface SgoEvent {
  eventID: string;
  teams: { home: { teamID: string; names: { long: string } }; away: { teamID: string; names: { long: string } } };
  odds: Record<string, SgoOddEntry>;
  players?: Record<string, { name?: string; firstName?: string; lastName?: string }>;
}

interface SgoEventsResponse {
  success: boolean;
  data: SgoEvent[];
}

/** playerID like "ANGEL_GENAO_1_MLB" -> "Angel Genao" as a fallback when the event's own `players` map lacks the name. */
function nameFromPlayerId(playerId: string): string {
  return playerId
    .replace(/_MLB$/, '')
    .replace(/_\d+$/, '')
    .split('_')
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(' ');
}

export const sportsGameOddsAdapter: ProviderAdapter = {
  meta: {
    id: 'sportsgameodds',
    label: 'SportsGameOdds',
    tier: 'tier2',
    get enabled() {
      return sportsGameOddsConfig().enabled;
    },
    // ~5 minutes observed in Phase 0 — not self-disclosed by the provider as a fixed constant.
    delaySeconds: 300,
    books: ['draftkings', 'fanduel', 'betmgm', 'caesars', 'espnbet', 'bovada', 'pointsbet', 'unibet'],
  },

  async fetchGameProps(game: GameLookupContext): Promise<FetchResult> {
    const config = sportsGameOddsConfig();
    if (!config.enabled || !config.key) {
      return { rows: [], unresolved: [], cost: {}, warnings: ['SportsGameOdds is disabled.'] };
    }

    const leagueId = LEAGUE_IDS[game.sport];
    if (!leagueId) {
      return { rows: [], unresolved: [], cost: {}, warnings: [`SportsGameOdds has no league mapping for ${game.sport}.`] };
    }

    const homeId = sgoTeamId(game.homeTeamName, leagueId);
    const awayId = sgoTeamId(game.awayTeamName, leagueId);
    const gameTime = new Date(game.gameDate);
    const startsAfter = new Date(gameTime.getTime() - 3 * 3_600_000).toISOString();
    const startsBefore = new Date(gameTime.getTime() + 3 * 3_600_000).toISOString();

    const url =
      `${BASE}/events?leagueID=${leagueId}&teamID=${homeId},${awayId}` +
      `&startsAfter=${startsAfter}&startsBefore=${startsBefore}&oddsAvailable=true&limit=5`;

    const res = await fetch(url, { headers: { 'X-Api-Key': config.key }, cache: 'no-store' });
    if (!res.ok) {
      return { rows: [], unresolved: [], cost: {}, warnings: [`SportsGameOdds request failed (${res.status}).`] };
    }
    const json = (await res.json()) as SgoEventsResponse;
    const events = json.data ?? [];
    // The billing model is 1 object per item in `data` — bill for exactly what came back, even if the
    // team-ID scoping (a derived, unverified-by-docs pattern) returned more than the intended single game.
    const cost = { objects: events.length };

    const event = events.find(
      (e) => (e.teams.home.teamID === homeId && e.teams.away.teamID === awayId) ||
             (e.teams.home.teamID === awayId && e.teams.away.teamID === homeId),
    );
    if (!event) {
      return {
        rows: [],
        unresolved: [],
        cost,
        warnings: [`SportsGameOdds returned no event matching ${game.awayAbbr} @ ${game.homeAbbr} (derived team IDs ${awayId}/${homeId}).`],
      };
    }

    const rosterIndex = buildRosterIndex(game.roster);
    const rows: NormalizedPropRow[] = [];
    const unresolved: UnresolvedRow[] = [];

    for (const odd of Object.values(event.odds)) {
      if (!odd.playerID) continue; // team/game-level market, not a player prop
      if (odd.sideID !== 'over' && odd.sideID !== 'under') continue;

      const marketKey = resolveMarketKey(odd.statID);
      if (!marketKey) {
        unresolved.push(unresolvedMarket(odd.statID, `player ${odd.playerID}`));
        continue;
      }

      const rawName = event.players?.[odd.playerID]?.name ?? nameFromPlayerId(odd.playerID);
      const player =
        resolvePlayer(rawName, game.homeAbbr, rosterIndex) ?? resolvePlayer(rawName, game.awayAbbr, rosterIndex);
      if (!player) {
        unresolved.push(unresolvedPlayer(rawName, `SportsGameOdds playerID ${odd.playerID}`));
        continue;
      }

      const line = odd.bookOverUnder != null ? Number(odd.bookOverUnder) : null;

      for (const [bookRaw, book] of Object.entries(odd.byBookmaker ?? {})) {
        if (!book.available) continue;
        const bookmaker = normalizeBookmaker(bookRaw);
        if (!bookmaker) {
          unresolved.push(unresolvedBookmaker(bookRaw, `SportsGameOdds`));
          continue;
        }
        const american = Number(book.odds);
        if (!Number.isFinite(american)) continue;

        rows.push({
          providerId: 'sportsgameodds',
          gameId: game.gameId,
          subjectId: player.subjectId,
          subjectName: player.subjectName,
          marketKey,
          line: book.overUnder != null ? Number(book.overUnder) : line,
          side: odd.sideID,
          bookmaker,
          americanOdds: american,
          decimalOdds: null,
          fetchedAt: book.lastUpdatedAt,
          isDelayed: true,
          delaySeconds: Math.round((Date.now() - new Date(book.lastUpdatedAt).getTime()) / 1000),
        });
      }
    }

    return { rows, unresolved, cost, warnings: [] };
  },
};

// ---------------------------------------------------------------------------
// Game-level lines (moneyline/spread/total) — the exact same event lookup
// `fetchGameProps` already makes (scoped to these two teams, `oddsAvailable=
// true`, `limit=5`) also returns full-game moneyline/spread/total rows under
// `event.odds`, tagged `statEntityID: 'home'|'away'|'all'` instead of a
// `playerID`. Player-prop fetching previously discarded them at
// `if (!odd.playerID) continue`. Confirmed live this session (MLB): real
// `betTypeID`s `ml`/`sp`/`ou`, `periodID: 'game'` for the full-game number
// (inning/half-scoped rows use other period ids and are filtered out here).
// ---------------------------------------------------------------------------

const GAME_LEVEL_BET_TYPES = new Set(['ml', 'sp', 'ou']);

/**
 * Real moneyline/spread/total for one game. Same billing model as
 * `fetchGameProps` (1 object per event returned) — this is a second request
 * scoped to the same two teams, not a shared call with the props fetch,
 * since the two are triggered independently (props by a slate refresh, this
 * by a Game Detail page view).
 */
export async function getSportsGameOddsGameLine(
  game: Pick<GameLookupContext, 'sport' | 'homeTeamName' | 'awayTeamName' | 'gameDate'>,
): Promise<{ line: GameLine | null; warnings: string[] }> {
  const config = sportsGameOddsConfig();
  if (!config.enabled || !config.key) {
    return { line: null, warnings: ['SportsGameOdds is disabled.'] };
  }

  const leagueId = LEAGUE_IDS[game.sport];
  if (!leagueId) {
    return { line: null, warnings: [`SportsGameOdds has no league mapping for ${game.sport}.`] };
  }

  const homeId = sgoTeamId(game.homeTeamName, leagueId);
  const awayId = sgoTeamId(game.awayTeamName, leagueId);
  const gameTime = new Date(game.gameDate);
  const startsAfter = new Date(gameTime.getTime() - 3 * 3_600_000).toISOString();
  const startsBefore = new Date(gameTime.getTime() + 3 * 3_600_000).toISOString();

  const url =
    `${BASE}/events?leagueID=${leagueId}&teamID=${homeId},${awayId}` +
    `&startsAfter=${startsAfter}&startsBefore=${startsBefore}&oddsAvailable=true&limit=5`;

  const res = await fetch(url, { headers: { 'X-Api-Key': config.key }, cache: 'no-store' });
  if (!res.ok) {
    return { line: null, warnings: [`SportsGameOdds request failed (${res.status}).`] };
  }
  const json = (await res.json()) as SgoEventsResponse;
  const events = json.data ?? [];

  const event = events.find(
    (e) => (e.teams.home.teamID === homeId && e.teams.away.teamID === awayId) ||
           (e.teams.home.teamID === awayId && e.teams.away.teamID === homeId),
  );
  if (!event) {
    return {
      line: null,
      warnings: [`SportsGameOdds returned no event matching ${game.awayTeamName} @ ${game.homeTeamName}.`],
    };
  }

  let moneylineHome: { price: number; book: string } | undefined;
  let moneylineAway: { price: number; book: string } | undefined;
  let spreadHome: { point: number; price: number; book: string } | undefined;
  let spreadAway: { point: number; price: number; book: string } | undefined;
  let totalOver: { point: number; price: number; book: string } | undefined;
  let totalUnder: { point: number; price: number; book: string } | undefined;
  const books = new Set<string>();

  for (const odd of Object.values(event.odds)) {
    if (odd.playerID) continue; // player prop, not a game-level line
    if (odd.periodID !== 'game' || !odd.betTypeID || !GAME_LEVEL_BET_TYPES.has(odd.betTypeID)) continue;

    for (const [bookRaw, book] of Object.entries(odd.byBookmaker ?? {})) {
      if (!book.available) continue;
      const american = Number(book.odds);
      if (!Number.isFinite(american)) continue;
      books.add(bookRaw);

      if (odd.betTypeID === 'ml') {
        if (odd.sideID === 'home' && (!moneylineHome || american > moneylineHome.price)) {
          moneylineHome = { price: american, book: bookRaw };
        }
        if (odd.sideID === 'away' && (!moneylineAway || american > moneylineAway.price)) {
          moneylineAway = { price: american, book: bookRaw };
        }
      } else if (odd.betTypeID === 'sp') {
        const point = book.spread != null ? Number(book.spread) : null;
        if (point == null) continue;
        if (odd.sideID === 'home' && !spreadHome) spreadHome = { point, price: american, book: bookRaw };
        if (odd.sideID === 'away' && !spreadAway) spreadAway = { point, price: american, book: bookRaw };
      } else if (odd.betTypeID === 'ou') {
        const point = book.overUnder != null ? Number(book.overUnder) : null;
        if (point == null) continue;
        if (odd.sideID === 'over' && !totalOver) totalOver = { point, price: american, book: bookRaw };
        if (odd.sideID === 'under' && !totalUnder) totalUnder = { point, price: american, book: bookRaw };
      }
    }
  }

  if (!moneylineHome && !moneylineAway && !spreadHome && !spreadAway && !totalOver && !totalUnder) {
    return { line: null, warnings: [] };
  }

  const line: GameLine = {
    eventId: event.eventID,
    commenceTime: game.gameDate,
    homeTeam: event.teams.home.names.long,
    awayTeam: event.teams.away.names.long,
    moneyline:
      moneylineHome || moneylineAway
        ? {
            home: moneylineHome?.price,
            away: moneylineAway?.price,
            book: moneylineHome && moneylineAway && moneylineHome.book === moneylineAway.book ? moneylineHome.book : undefined,
          }
        : undefined,
    spread:
      spreadHome || spreadAway
        ? {
            homePoint: spreadHome?.point,
            homePrice: spreadHome?.price,
            awayPoint: spreadAway?.point,
            awayPrice: spreadAway?.price,
            book: spreadHome?.book,
          }
        : undefined,
    total:
      totalOver || totalUnder
        ? {
            point: totalOver?.point ?? totalUnder?.point,
            overPrice: totalOver?.price,
            underPrice: totalUnder?.price,
            book: totalOver?.book ?? totalUnder?.book,
          }
        : undefined,
    bookCount: books.size,
  };

  return { line, warnings: [] };
}
