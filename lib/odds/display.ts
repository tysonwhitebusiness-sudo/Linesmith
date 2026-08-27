/**
 * Display helpers for odds.
 *
 * The two sources disagree about units — the-odds-api's best-line summary is
 * already American, OddsHarvester's per-book breakdown is decimal — so every
 * conversion lives here rather than being re-derived at each call site.
 */

import type { BookmakerOdds, UnifiedGameLine } from './types';
import { devigTwoWay } from './devig';

/** Above this, a decimal price is a bad row, not a real long-shot line —
 * confirmed live 2026-08-27 (MLB game 822692): a single garbage `tab_au`
 * row (decimal 101, i.e. +10000 American) got picked as the "best"
 * moneyline price across 21 real bookmakers, since bestMoneylineFromBooks
 * (and the total/spread equivalents below) had no sanity bound — it just
 * maximizes whatever's there. 30 (~+2900 American) is well above any real
 * two-outcome moneyline/spread/total price ever seen in this data, so it
 * costs nothing to reject while still catching the actual bad row. */
const MAX_PLAUSIBLE_DECIMAL_ODDS = 30;

function isPlausibleDecimalOdds(decimal: number | null | undefined): decimal is number {
  return decimal != null && Number.isFinite(decimal) && decimal > 1 && decimal <= MAX_PLAUSIBLE_DECIMAL_ODDS;
}

/** Decimal → American. `1.91` → `-110`, `3.50` → `+250`. */
export function decimalToAmerican(decimal: number | undefined | null): number | undefined {
  if (decimal == null || !Number.isFinite(decimal) || decimal <= 1) return undefined;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** American → decimal, for ranking prices on a linear payout scale. */
export function americanToDecimal(price: number | undefined | null): number | undefined {
  if (price == null || !Number.isFinite(price) || price === 0) return undefined;
  return price > 0 ? price / 100 + 1 : 100 / -price + 1;
}

/** American odds as displayed: always signed, em dash when absent. */
export function formatAmerican(price: number | undefined | null): string {
  if (price == null || !Number.isFinite(price)) return '—';
  return price > 0 ? `+${price}` : String(price);
}

/** Signed point value: `+1.5`, `-1.5`, `0`. */
export function formatPoint(point: number | undefined | null): string {
  if (point == null || !Number.isFinite(point)) return '—';
  return point > 0 ? `+${point}` : String(point);
}

/** Raw implied probability from decimal odds (includes the book's vig). */
export function impliedFromDecimal(decimal: number | undefined | null): number | undefined {
  if (decimal == null || !Number.isFinite(decimal) || decimal <= 1) return undefined;
  return 1 / decimal;
}

/**
 * Home share of a two-way market, with the overround divided out.
 *
 * Returns `null` when only one side is priced — half a market can't be
 * normalised, and guessing the other half would invent a number.
 */
export function homeShare(
  homeDecimal: number | undefined,
  awayDecimal: number | undefined,
): number | null {
  const devigged = devigTwoWay(homeDecimal, awayDecimal);
  return devigged ? devigged.a : null;
}

/**
 * Is this period still in play?
 *
 * OddsPortal keeps finished games in the live feed for a while, and a pulsing
 * dot on a final score is a lie about freshness.
 */
const FINISHED = /finished|final|full.time|ft/i;

export function isInPlay(livePeriod: string | undefined | null): boolean {
  return Boolean(livePeriod) && !FINISHED.test(livePeriod as string);
}

export type OddsSourceId = 'odds-api' | 'oddsharvester' | 'both' | string;

export function sourceLabel(source: OddsSourceId | undefined): string {
  if (source === 'oddsharvester') return 'OddsPortal';
  if (source === 'both') return 'the-odds-api + OddsPortal';
  return 'the-odds-api';
}

/** Short timestamp used everywhere odds freshness is shown. */
export function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatStamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Credit thresholds, mirroring `lib/odds/oddsApi.ts`'s reserve (25) and its
 * warning point (2× reserve). The server's own `warnings[]` remains the
 * authority — these only decide whether the credit *count* is tinted amber.
 */
export const LOW_CREDIT_THRESHOLD = 50;
export const EXHAUSTED_CREDIT_THRESHOLD = 25;

/**
 * Observed range of a set of prices, or `null` when there's nothing to compare.
 * Feeds the relative colour scale in the per-bookmaker view.
 */
export function rankOf(values: number[]): { min: number; max: number } | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return { min: Math.min(...finite), max: Math.max(...finite) };
}

/** "New York Yankees" → "Yankees". Used where no abbreviation is to hand. */
export function shortTeam(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name;
  const last = words[words.length - 1];
  // "Red Sox" / "Blue Jays" lose their meaning cut down to one word.
  if (/^(sox|jays|rays)$/i.test(last) && words.length >= 3) {
    return `${words[words.length - 2]} ${last}`;
  }
  return last;
}

// ---------------------------------------------------------------------------
// Source / bookmaker projection
// ---------------------------------------------------------------------------

export type SourceFilter = 'all' | 'odds-api' | 'oddsharvester';

export const SOURCE_FILTER_LABEL: Record<SourceFilter, string> = {
  all: 'All sources',
  'odds-api': 'the-odds-api',
  oddsharvester: 'OddsPortal',
};

export interface ProjectedLine {
  /** False when the chosen source has nothing to say about this game. */
  available: boolean;
  moneyline?: UnifiedGameLine['moneyline'];
  spread?: UnifiedGameLine['spread'];
  total?: UnifiedGameLine['total'];
  bookmakers: BookmakerOdds[];
  livePeriod?: string;
  liveScore?: { home: string; away: string };
  bookCount: number;
  source: OddsSourceId;
  /** Book the headline numbers came from, or null when it's the best available. */
  headlineBook: string | null;
}

/** Best available moneyline across a per-book breakdown, compared in decimal.
 * `draw` (soccer only) is maximized independently, same as home/away — a
 * book's own draw price is unrelated to whichever book has the best home
 * or away price, so there's no "coherence" concern the way total/spread
 * points have. */
export function bestMoneylineFromBooks(books: BookmakerOdds[]): UnifiedGameLine['moneyline'] | undefined {
  let homeBest: { decimal: number; book: string } | undefined;
  let awayBest: { decimal: number; book: string } | undefined;
  let drawBest: { decimal: number; book: string } | undefined;

  for (const b of books) {
    if (isPlausibleDecimalOdds(b.homeOdds) && (homeBest == null || b.homeOdds > homeBest.decimal)) {
      homeBest = { decimal: b.homeOdds, book: b.bookmaker };
    }
    if (isPlausibleDecimalOdds(b.awayOdds) && (awayBest == null || b.awayOdds > awayBest.decimal)) {
      awayBest = { decimal: b.awayOdds, book: b.bookmaker };
    }
    if (isPlausibleDecimalOdds(b.drawOdds) && (drawBest == null || b.drawOdds > drawBest.decimal)) {
      drawBest = { decimal: b.drawOdds, book: b.bookmaker };
    }
  }

  if (!homeBest && !awayBest && !drawBest) return undefined;
  return {
    home: decimalToAmerican(homeBest?.decimal),
    away: decimalToAmerican(awayBest?.decimal),
    draw: decimalToAmerican(drawBest?.decimal),
    // Two sides can come from different books; name one only when they agree.
    book: homeBest && awayBest && homeBest.book === awayBest.book ? homeBest.book : undefined,
  };
}

/** Best available total across a per-book breakdown — over and under sides
 * maximized independently (same disclosed convention as moneyline/spread
 * above: the two sides can come from different books). Point comes from
 * whichever side's best book set it; when both sides disagree on the
 * point (a real possibility with multiple sources), the over side's point
 * wins, matching this codebase's existing tie-break convention
 * (predict/mlb_game_lines.py's summarise_odds_event does the same). */
export function bestTotalFromBooks(books: BookmakerOdds[]): UnifiedGameLine['total'] | undefined {
  let overBest: { decimal: number; book: string; point?: number } | undefined;
  let underBest: { decimal: number; book: string; point?: number } | undefined;

  for (const b of books) {
    if (isPlausibleDecimalOdds(b.overPrice) && (overBest == null || b.overPrice > overBest.decimal)) {
      overBest = { decimal: b.overPrice, book: b.bookmaker, point: b.point };
    }
    if (isPlausibleDecimalOdds(b.underPrice) && (underBest == null || b.underPrice > underBest.decimal)) {
      underBest = { decimal: b.underPrice, book: b.bookmaker, point: b.point };
    }
  }

  if (!overBest && !underBest) return undefined;
  return {
    point: overBest?.point ?? underBest?.point,
    overPrice: decimalToAmerican(overBest?.decimal),
    underPrice: decimalToAmerican(underBest?.decimal),
    book: overBest && underBest && overBest.book === underBest.book ? overBest.book : undefined,
  };
}

/** Best available spread across a per-book breakdown — home and away sides
 * maximized independently, same convention as bestTotalFromBooks. */
export function bestSpreadFromBooks(books: BookmakerOdds[]): UnifiedGameLine['spread'] | undefined {
  let homeBest: { decimal: number; book: string; point?: number } | undefined;
  let awayBest: { decimal: number; book: string; point?: number } | undefined;

  for (const b of books) {
    if (isPlausibleDecimalOdds(b.spreadHomePrice) && (homeBest == null || b.spreadHomePrice > homeBest.decimal)) {
      homeBest = { decimal: b.spreadHomePrice, book: b.bookmaker, point: b.spreadHome };
    }
    if (isPlausibleDecimalOdds(b.spreadAwayPrice) && (awayBest == null || b.spreadAwayPrice > awayBest.decimal)) {
      awayBest = { decimal: b.spreadAwayPrice, book: b.bookmaker, point: b.spreadAway };
    }
  }

  if (!homeBest && !awayBest) return undefined;
  return {
    homePoint: homeBest?.point,
    homePrice: decimalToAmerican(homeBest?.decimal),
    awayPoint: awayBest?.point,
    awayPrice: decimalToAmerican(awayBest?.decimal),
    book: homeBest && awayBest && homeBest.book === awayBest.book ? homeBest.book : undefined,
  };
}

/** Totals as one named book quotes them, so the point and prices stay coherent. */
function totalFromBook(book: BookmakerOdds | undefined): UnifiedGameLine['total'] | undefined {
  if (!book || book.point == null) return undefined;
  return {
    point: book.point,
    overPrice: decimalToAmerican(book.overPrice),
    underPrice: decimalToAmerican(book.underPrice),
    book: book.bookmaker,
  };
}

function spreadFromBook(book: BookmakerOdds | undefined): UnifiedGameLine['spread'] | undefined {
  if (!book || book.spreadHome == null) return undefined;
  return {
    homePoint: book.spreadHome,
    homePrice: decimalToAmerican(book.spreadHomePrice),
    awayPoint: book.spreadAway,
    awayPrice: decimalToAmerican(book.spreadAwayPrice),
    book: book.bookmaker,
  };
}

/**
 * Apply the source and bookmaker filters to one game.
 *
 * Filtering here rather than in each component keeps the rule in one place:
 * choosing "the-odds-api" must drop the live score and per-book detail too,
 * because those only ever come from the scraper.
 */
export function projectLine(
  line: UnifiedGameLine,
  sourceFilter: SourceFilter = 'all',
  bookmaker: string | null = null,
): ProjectedLine {
  const books = line.bookmakers ?? [];

  if (sourceFilter === 'odds-api') {
    if (line.source === 'oddsharvester') {
      return { available: false, bookmakers: [], bookCount: 0, source: 'odds-api', headlineBook: null };
    }
    return {
      available: true,
      moneyline: line.moneyline,
      spread: line.spread,
      total: line.total,
      bookmakers: [],
      bookCount: line.bookCount,
      source: 'odds-api',
      headlineBook: null,
    };
  }

  const scraperOnly = sourceFilter === 'oddsharvester';
  if (scraperOnly && books.length === 0) {
    return { available: false, bookmakers: [], bookCount: 0, source: 'oddsharvester', headlineBook: null };
  }

  const chosen = bookmaker ? books.find((b) => b.bookmaker === bookmaker) : undefined;

  if (chosen) {
    return {
      available: true,
      moneyline: {
        home: decimalToAmerican(chosen.homeOdds),
        away: decimalToAmerican(chosen.awayOdds),
        book: chosen.bookmaker,
      },
      spread: spreadFromBook(chosen) ?? (scraperOnly ? undefined : line.spread),
      total: totalFromBook(chosen),
      bookmakers: books,
      livePeriod: line.livePeriod,
      liveScore: line.liveScore,
      bookCount: scraperOnly ? books.length : line.bookCount,
      source: scraperOnly ? 'oddsharvester' : line.source,
      headlineBook: chosen.bookmaker,
    };
  }

  if (scraperOnly) {
    const withPoint = books.find((b) => b.point != null);
    return {
      available: true,
      moneyline: bestMoneylineFromBooks(books),
      total: totalFromBook(withPoint),
      spread: spreadFromBook(books.find((b) => b.spreadHome != null)),
      bookmakers: books,
      livePeriod: line.livePeriod,
      liveScore: line.liveScore,
      bookCount: books.length,
      source: 'oddsharvester',
      headlineBook: null,
    };
  }

  return {
    available: true,
    moneyline: line.moneyline,
    spread: line.spread,
    total: line.total,
    bookmakers: books,
    livePeriod: line.livePeriod,
    liveScore: line.liveScore,
    bookCount: line.bookCount,
    source: line.source,
    headlineBook: null,
  };
}
