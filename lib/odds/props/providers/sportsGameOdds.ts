/**
 * SportsGameOdds — also powers the click-only "More books" panel, but is
 * genuinely scheduled too (a dedicated MLB job, plus NFL/CFB via
 * multiSportRefresh.ts) — the old header claim that it was "never scheduled"
 * was already stale before 2026-08-20's rename, since sportsGameOddsRefresh.ts
 * existed and was wired into scheduler.ts.
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
 *
 * Second identity (2026-08-20, see docs/api-capability-audit-2026-08-20.md):
 * `sportsgameodds_multisport` is a real, separate free account dedicated to
 * NFL/CFB (via multiSportRefresh.ts) so its spend never competes with MLB's
 * — same reasoning as ParlayAPI's per-sport identities below in parlayApi.ts.
 */

import type { FetchResult, GameLookupContext, NormalizedPropRow, ProviderAdapter, SportKey, UnresolvedRow } from '../types';
import { sportsGameOddsConfig, sportsGameOddsMultisportConfig } from '../config';
import { buildRosterIndex, normalizeBookmaker, resolveMarketKey, resolvePlayer, unresolvedBookmaker, unresolvedMarket, unresolvedPlayer } from '../entityResolution';

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

function buildAdapter(id: 'sportsgameodds' | 'sportsgameodds_multisport', getConfig: typeof sportsGameOddsConfig): ProviderAdapter {
  return {
    meta: {
      id,
      label: id === 'sportsgameodds_multisport' ? 'SportsGameOdds (NFL/CFB)' : 'SportsGameOdds',
      // Both run automatically — 'sportsgameodds' via a dedicated MLB job
      // (sportsGameOddsRefresh.ts / Python's job_sportsgameodds),
      // 'sportsgameodds_multisport' via multiSportRefresh.ts's NFL/CFB path.
      // See types.ts's ProviderMeta.scheduled doc.
      scheduled: true,
      get enabled() {
        return getConfig().enabled;
      },
      // ~5 minutes observed in Phase 0 — not self-disclosed by the provider as a fixed constant.
      delaySeconds: 300,
      books: ['draftkings', 'fanduel', 'betmgm', 'caesars', 'espnbet', 'bovada', 'pointsbet', 'unibet'],
    },

    async fetchGameProps(game: GameLookupContext): Promise<FetchResult> {
      const config = getConfig();
      if (!config.enabled || !config.key) {
        return { rows: [], unresolved: [], cost: {}, warnings: [`${id} is disabled.`] };
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
            providerId: id,
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
}

export const sportsGameOddsAdapter = buildAdapter('sportsgameodds', sportsGameOddsConfig);
export const sportsGameOddsMultisportAdapter = buildAdapter('sportsgameodds_multisport', sportsGameOddsMultisportConfig);
