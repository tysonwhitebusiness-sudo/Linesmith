/**
 * Odds-API.io — Tier 1, the user's own sportsbook (Fanatics).
 *
 * Verified live in docs/odds-provider-verification.md § 2. Two findings that
 * shape this adapter beyond the spec:
 *  - The free tier's book pair is a **persistent account-level lock**, not a
 *    per-request choice — the first successful call locked this account to
 *    Fanatics + BetMGM. `bookmakers=` is sent as a fixed constant, never varied.
 *  - Player props were only observed under Fanatics; BetMGM's side of the
 *    same response carried none. Both books are still requested (BetMGM's
 *    game lines are real and useful), but a missing Fanatics props array is
 *    a genuine "no props posted" state, not a bug to retry.
 */

import { decimalToAmerican } from '@/lib/odds/display';
import type { FetchResult, GameLookupContext, NormalizedPropRow, ProviderAdapter, UnresolvedRow } from '../types';
import { oddsApiIoConfig } from '../config';
import { buildRosterIndex, normalizeBookmaker, resolveMarketKey, resolvePlayer, unresolvedBookmaker, unresolvedMarket, unresolvedPlayer } from '../entityResolution';

const BASE = 'https://api.odds-api.io/v3';

interface OddsApiIoEvent {
  id: number;
  home: string;
  away: string;
  date: string;
  league?: { slug?: string };
}

interface OddsApiIoOddsResponse {
  id: number;
  bookmakers: Record<string, Array<{ name: string; updatedAt: string; odds: Array<{ label?: string; hdp?: number; over?: string; under?: string; home?: string; away?: string }> }>>;
}

// Shared across every game in a refresh cycle — the events list is
// league-wide, so fetching it once per game would multiply the request count
// by the slate size for no benefit.
let eventsCache: { fetchedAt: number; events: OddsApiIoEvent[] } | null = null;
const EVENTS_TTL_MS = 5 * 60_000;

async function getEvents(apiKey: string): Promise<OddsApiIoEvent[]> {
  if (eventsCache && Date.now() - eventsCache.fetchedAt < EVENTS_TTL_MS) return eventsCache.events;
  const res = await fetch(`${BASE}/events?sport=baseball&apiKey=${apiKey}`, { cache: 'no-store' });
  if (!res.ok) return eventsCache?.events ?? [];
  const events = (await res.json()) as OddsApiIoEvent[];
  eventsCache = { fetchedAt: Date.now(), events };
  return events;
}

function findEvent(events: OddsApiIoEvent[], game: GameLookupContext): OddsApiIoEvent | undefined {
  return events.find(
    (e) =>
      e.league?.slug === 'usa-mlb' &&
      ((e.home === game.homeTeamName && e.away === game.awayTeamName) ||
        (e.home === game.awayTeamName && e.away === game.homeTeamName)),
  );
}

/** "Zach McKinstry (Hits+Runs+RBIs)" -> { player: "Zach McKinstry", stat: "Hits+Runs+RBIs" }. */
function splitPlayerLabel(label: string): { player: string; stat: string } | null {
  const match = label.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!match) return null;
  return { player: match[1].trim(), stat: match[2].trim() };
}

export const oddsApiIoAdapter: ProviderAdapter = {
  meta: {
    id: 'oddsapiio',
    label: 'Odds-API.io',
    tier: 'tier1',
    get enabled() {
      return oddsApiIoConfig().enabled;
    },
    // Not self-disclosed by the provider — honest-unknown rather than assumed real-time.
    delaySeconds: null,
    books: ['fanatics', 'betmgm'],
  },

  async fetchGameProps(game: GameLookupContext): Promise<FetchResult> {
    const config = oddsApiIoConfig();
    if (!config.enabled || !config.key) {
      return { rows: [], unresolved: [], cost: {}, warnings: ['Odds-API.io is disabled.'] };
    }

    const events = await getEvents(config.key);
    const event = findEvent(events, game);
    if (!event) {
      return { rows: [], unresolved: [], cost: {}, warnings: [`Odds-API.io has no event matching ${game.awayAbbr} @ ${game.homeAbbr}.`] };
    }

    const res = await fetch(
      `${BASE}/odds?eventId=${event.id}&bookmakers=${config.books.join(',')}&apiKey=${config.key}`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      return { rows: [], unresolved: [], cost: { requests: 1 }, warnings: [`Odds-API.io odds request failed (${res.status}).`] };
    }
    const json = (await res.json()) as OddsApiIoOddsResponse;

    const rosterIndex = buildRosterIndex(game.roster);
    const rows: NormalizedPropRow[] = [];
    const unresolved: UnresolvedRow[] = [];
    const fetchedAt = new Date().toISOString();

    for (const [bookmakerRaw, markets] of Object.entries(json.bookmakers ?? {})) {
      const bookmaker = normalizeBookmaker(bookmakerRaw);
      if (!bookmaker) {
        unresolved.push(unresolvedBookmaker(bookmakerRaw, 'Odds-API.io'));
        continue;
      }
      const propsMarket = markets.find((m) => m.name === 'Player Props');
      if (!propsMarket) continue;

      for (const entry of propsMarket.odds) {
        if (!entry.label) continue;
        const split = splitPlayerLabel(entry.label);
        if (!split) {
          unresolved.push(unresolvedMarket(entry.label, `Odds-API.io ${bookmaker} — unparsed label`));
          continue;
        }

        const marketKey = resolveMarketKey(split.stat);
        if (!marketKey) {
          unresolved.push(unresolvedMarket(split.stat, `player ${split.player}`));
          continue;
        }

        const player =
          resolvePlayer(split.player, game.homeAbbr, rosterIndex) ??
          resolvePlayer(split.player, game.awayAbbr, rosterIndex);
        if (!player) {
          unresolved.push(unresolvedPlayer(split.player, `Odds-API.io ${bookmaker}`));
          continue;
        }

        const over = entry.over && entry.over !== 'N/A' ? Number(entry.over) : null;
        const under = entry.under && entry.under !== 'N/A' ? Number(entry.under) : null;

        for (const [side, decimal] of [
          ['over', over],
          ['under', under],
        ] as const) {
          if (decimal == null) continue; // one-sided line — omit rather than fabricate the missing side
          const american = decimalToAmerican(decimal);
          if (american == null) continue;
          rows.push({
            providerId: 'oddsapiio',
            gameId: game.gameId,
            subjectId: player.subjectId,
            subjectName: player.subjectName,
            marketKey,
            line: entry.hdp ?? null,
            side,
            bookmaker,
            americanOdds: american,
            decimalOdds: decimal,
            fetchedAt,
            isDelayed: false,
            delaySeconds: null,
          });
        }
      }
    }

    return { rows, unresolved, cost: { requests: 1 }, warnings: [] };
  },
};
