/**
 * Merge game lines from the-odds-api and OddsHarvester into a unified view.
 *
 * Strategy:
 *  1. the-odds-api provides best-line summaries (SLA-backed, reliable).
 *  2. OddsHarvester adds per-bookmaker detail and live scores (richer, optional).
 *  3. Merged by "awayTeam@homeTeam" key, case- and punctuation-insensitive.
 */

import type { BookmakerOdds, UnifiedGameLine } from './types';
import type { GameLine } from './oddsApi';
import type { HarvesterMatch } from './oddsHarvester';

// ---------------------------------------------------------------------------
// Team name normalisation
// ---------------------------------------------------------------------------

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function matchupKey(away: string, home: string): string {
  return `${norm(away)}@${norm(home)}`;
}

// ---------------------------------------------------------------------------
// Convert the-odds-api American odds → decimal for unified BookmakerOdds
// ---------------------------------------------------------------------------

function americanToDecimal(american: number | undefined): number | undefined {
  if (american == null || !Number.isFinite(american)) return undefined;
  return american > 0
    ? 1 + american / 100
    : 1 - 100 / american;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export function mergeLines(
  oddsApiLines: GameLine[],
  harvesterMatches: HarvesterMatch[],
): UnifiedGameLine[] {
  const byMatchup = new Map<string, UnifiedGameLine>();

  // --- Pass 1: seed from the-odds-api (best lines) ---
  for (const line of oddsApiLines) {
    const key = matchupKey(line.awayTeam, line.homeTeam);
    byMatchup.set(key, {
      eventId: line.eventId,
      commenceTime: line.commenceTime,
      homeTeam: line.homeTeam,
      awayTeam: line.awayTeam,
      moneyline: line.moneyline,
      spread: line.spread,
      total: line.total,
      // `?? []` guards a cache entry written before `bookmakers` existed on
      // GameLine — old JSON in odds_cache won't have this field until its
      // next real fetch, up to the 6h TTL away.
      bookmakers: line.bookmakers ?? [],
      bookCount: line.bookCount,
      source: 'odds-api',
    });
  }

  // --- Pass 2: merge in OddsHarvester (per-bookmaker + live) ---
  for (const match of harvesterMatches) {
    const key = matchupKey(match.awayTeam, match.homeTeam);
    const existing = byMatchup.get(key);

    const bookmakers: BookmakerOdds[] = match.bookmakers;

    if (existing) {
      // Union, not overwrite — the-odds-api's own per-book prices (seeded in
      // Pass 1) used to be silently discarded here whenever a harvester
      // match existed for the same game. OddsHarvester's entries still win
      // on a same-bookmaker conflict (its richer/live data was already the
      // de-facto priority before this fix), but a bookmaker only the-odds-api
      // covered is no longer thrown away.
      const harvesterBooks = new Set(bookmakers.map((b) => b.bookmaker));
      existing.bookmakers = [...bookmakers, ...existing.bookmakers.filter((b) => !harvesterBooks.has(b.bookmaker))];
      existing.livePeriod = match.livePeriod ?? existing.livePeriod;
      existing.liveScore = match.liveScore ?? existing.liveScore;
      existing.source = 'both';
      // Reflects the post-union distinct-book count, not just harvester's own.
      existing.bookCount = Math.max(existing.bookCount, existing.bookmakers.length);
      // Fill in missing eventId / commenceTime if the-odds-api didn't have them
      if (!existing.eventId) existing.eventId = match.matchUrl;
    } else {
      // OddsHarvester-only entry — build best-line summary from bookmaker data.
      byMatchup.set(key, {
        eventId: match.matchUrl,
        commenceTime: match.matchDate,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        moneyline: bestMoneyline(bookmakers),
        total: bestTotal(bookmakers),
        bookmakers,
        bookCount: bookmakers.length,
        source: 'oddsharvester',
        livePeriod: match.livePeriod,
        liveScore: match.liveScore,
      });
    }
  }

  return [...byMatchup.values()];
}

// ---------------------------------------------------------------------------
// Helpers: extract best lines from a BookmakerOdds[] when there's no
// the-odds-api summary
// ---------------------------------------------------------------------------

function bestMoneyline(books: BookmakerOdds[]): UnifiedGameLine['moneyline'] | undefined {
  // Compare in decimal and convert once at the end. Comparing a decimal price
  // against an already-converted American one mixes units, and silently picks
  // the wrong book on every underdog price.
  let home: { decimal: number; book: string } | undefined;
  let away: { decimal: number; book: string } | undefined;

  for (const b of books) {
    if (b.homeOdds != null && Number.isFinite(b.homeOdds) && (home == null || b.homeOdds > home.decimal)) {
      home = { decimal: b.homeOdds, book: b.bookmaker };
    }
    if (b.awayOdds != null && Number.isFinite(b.awayOdds) && (away == null || b.awayOdds > away.decimal)) {
      away = { decimal: b.awayOdds, book: b.bookmaker };
    }
  }

  if (!home && !away) return undefined;
  return {
    home: decimalToAmerican(home?.decimal),
    away: decimalToAmerican(away?.decimal),
    // The two sides can be best at different books; only name one when they agree.
    book: home && away && home.book === away.book ? home.book : undefined,
  };
}

function bestTotal(books: BookmakerOdds[]): UnifiedGameLine['total'] | undefined {
  for (const b of books) {
    if (b.point != null) {
      return {
        point: b.point,
        overPrice: b.overPrice != null ? decimalToAmerican(b.overPrice) : undefined,
        underPrice: b.underPrice != null ? decimalToAmerican(b.underPrice) : undefined,
        book: b.bookmaker,
      };
    }
  }
  return undefined;
}

/** Convert decimal odds back to American for the existing UI. */
function decimalToAmerican(decimal: number | undefined): number | undefined {
  if (decimal == null || !Number.isFinite(decimal)) return undefined;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}
