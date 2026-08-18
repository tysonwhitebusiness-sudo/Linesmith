/**
 * Propline — Tier 1, MLB (general key) + Soccer/EPL (second key).
 *
 * Live-verified this session: MLB player props work immediately with
 * the-odds-api-style market keys (batter_hits, etc). Soccer/EPL props do
 * NOT — the-odds-api-style guesses (`player_goal_scorer_anytime`) returned
 * nothing, but the real keys (`anytime_goal_scorer`, `first_goal_scorer`)
 * are live with real pricing on BetRivers/Bovada/Unibet. NFL/CFB/Tennis
 * checked out as genuinely empty via the discovery endpoint below (matches
 * Propline's own docs: those markets are "launching 2026 season").
 *
 * Because guessing market-key names cost real coverage once already, this
 * adapter always calls `/events/{id}/markets` first to discover the real
 * available keys for that specific event, then fetches odds for exactly
 * those — never a hardcoded guess list. Two calls per event per refresh
 * (discovery + odds) against a 1,000/day budget per key, which is generous
 * enough that this doesn't need a board-wide cache the way ParlayAPI/SharpAPI
 * do.
 *
 * Registered twice (`proplineAdapter` / `propline2Adapter`) under separate
 * provider ids/keys/budgets, same reasoning as the two ParlayAPI identities.
 */

import type { FetchResult, GameLookupContext, NormalizedPropRow, ProviderAdapter, SportKey, UnresolvedRow } from '../types';
import { proplineConfig, propline2Config } from '../config';
import { buildRosterIndex, normalizeBookmaker, resolveMarketKey, resolvePlayer, unresolvedBookmaker, unresolvedMarket, unresolvedPlayer } from '../entityResolution';

const BASE = 'https://api.prop-line.com/v1';

const SPORT_KEYS: Partial<Record<SportKey, string>> = {
  mlb: 'baseball_mlb',
  soccer_epl: 'soccer_epl',
};

interface ProplineEvent {
  id: number | string;
  home_team: string;
  away_team: string;
}

interface ProplineMarketListing {
  key: string;
  outcomes_count: number;
}

interface ProplineOddsOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number | null;
}
interface ProplineMarket {
  key: string;
  outcomes: ProplineOddsOutcome[];
}
interface ProplineBookmaker {
  key: string;
  markets: ProplineMarket[];
}

// Events lists are sport-wide, cached the same way oddsApiIo.ts's `getEvents`
// is — fetching it once per game in a slate refresh would multiply requests
// by slate size for no benefit.
const eventsCache = new Map<string, { fetchedAt: number; events: ProplineEvent[] }>();
const EVENTS_TTL_MS = 5 * 60_000;

async function getEvents(configKey: string, apiKey: string, sportKey: string): Promise<ProplineEvent[]> {
  const cached = eventsCache.get(configKey);
  if (cached && Date.now() - cached.fetchedAt < EVENTS_TTL_MS) return cached.events;
  const res = await fetch(`${BASE}/sports/${sportKey}/events?apiKey=${apiKey}`, { cache: 'no-store' });
  if (!res.ok) return cached?.events ?? [];
  const events = (await res.json()) as ProplineEvent[];
  eventsCache.set(configKey, { fetchedAt: Date.now(), events });
  return events;
}

function findEvent(events: ProplineEvent[], game: GameLookupContext): ProplineEvent | undefined {
  return events.find(
    (e) =>
      (e.home_team === game.homeTeamName && e.away_team === game.awayTeamName) ||
      (e.home_team === game.awayTeamName && e.away_team === game.homeTeamName),
  );
}

function buildAdapter(id: 'propline' | 'propline_2', getConfig: typeof proplineConfig): ProviderAdapter {
  return {
    meta: {
      id,
      label: id === 'propline_2' ? 'Propline (Soccer)' : 'Propline',
      tier: 'tier1',
      get enabled() {
        return getConfig().enabled;
      },
      delaySeconds: null,
      books: ['betrivers', 'bovada', 'unibet', 'betmgm', 'draftkings', 'fanduel', 'pinnacle'],
    },

    async fetchGameProps(game: GameLookupContext): Promise<FetchResult> {
      const config = getConfig();
      if (!config.enabled || !config.key) {
        return { rows: [], unresolved: [], cost: {}, warnings: [`${id} is disabled.`] };
      }
      const sportKey = SPORT_KEYS[game.sport];
      if (!sportKey) {
        return { rows: [], unresolved: [], cost: {}, warnings: [`${id} has no sport mapping for ${game.sport}.`] };
      }

      const events = await getEvents(id, config.key, sportKey);
      const event = findEvent(events, game);
      if (!event) {
        return { rows: [], unresolved: [], cost: { requests: 1 }, warnings: [`Propline has no event matching ${game.awayAbbr} @ ${game.homeAbbr}.`] };
      }

      // Discovery first — never guess market-key names (see module comment).
      const marketsRes = await fetch(`${BASE}/sports/${sportKey}/events/${event.id}/markets?apiKey=${config.key}`, { cache: 'no-store' });
      if (!marketsRes.ok) {
        return { rows: [], unresolved: [], cost: { requests: 1 }, warnings: [`Propline markets discovery failed (${marketsRes.status}).`] };
      }
      const marketListings = (await marketsRes.json()) as ProplineMarketListing[];
      const playerMarketKeys = marketListings.map((m) => m.key).filter((k) => k !== 'h2h' && k !== 'spreads' && k !== 'totals');
      if (playerMarketKeys.length === 0) {
        return { rows: [], unresolved: [], cost: { requests: 2 }, warnings: [] };
      }

      const oddsRes = await fetch(
        `${BASE}/sports/${sportKey}/events/${event.id}/odds?apiKey=${config.key}&markets=${playerMarketKeys.join(',')}`,
        { cache: 'no-store' },
      );
      const cost = { requests: 2 };
      if (!oddsRes.ok) {
        return { rows: [], unresolved: [], cost, warnings: [`Propline odds request failed (${oddsRes.status}).`] };
      }
      const oddsJson = (await oddsRes.json()) as { bookmakers?: ProplineBookmaker[] };

      const rosterIndex = buildRosterIndex(game.roster);
      const rows: NormalizedPropRow[] = [];
      const unresolved: UnresolvedRow[] = [];
      const fetchedAt = new Date().toISOString();

      for (const bm of oddsJson.bookmakers ?? []) {
        const bookmaker = normalizeBookmaker(bm.key);
        if (!bookmaker) {
          unresolved.push(unresolvedBookmaker(bm.key, id));
          continue;
        }
        for (const market of bm.markets) {
          const marketKey = resolveMarketKey(market.key);
          if (!marketKey) {
            unresolved.push(unresolvedMarket(market.key, `Propline ${bookmaker}`));
            continue;
          }
          for (const outcome of market.outcomes) {
            const rawName = outcome.description ?? outcome.name;
            const player = resolvePlayer(rawName, game.homeAbbr, rosterIndex) ?? resolvePlayer(rawName, game.awayAbbr, rosterIndex);
            if (!player) {
              unresolved.push(unresolvedPlayer(rawName, `Propline ${bookmaker}`));
              continue;
            }
            const side = /under/i.test(outcome.name) ? 'under' : 'over';
            rows.push({
              providerId: id,
              gameId: game.gameId,
              subjectId: player.subjectId,
              subjectName: player.subjectName,
              marketKey,
              line: outcome.point ?? null,
              side,
              bookmaker,
              americanOdds: outcome.price,
              decimalOdds: null,
              fetchedAt,
              isDelayed: false,
              delaySeconds: null,
            });
          }
        }
      }

      return { rows, unresolved, cost, warnings: [] };
    },
  };
}

export const proplineAdapter = buildAdapter('propline', proplineConfig);
export const propline2Adapter = buildAdapter('propline_2', propline2Config);
