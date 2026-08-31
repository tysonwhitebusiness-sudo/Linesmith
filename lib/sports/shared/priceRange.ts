/**
 * The game page's price-dispersion card — Phase 6.20.
 *
 * WHAT IT ANSWERS THAT THE BOOKMAKER GRID BESIDE IT DOES NOT. The grid shows
 * every book's price. It does not show how much they DISAGREE, or where the
 * best number sits inside that disagreement — and a wide range with your book
 * at the short end is a different proposition from a tight range at the same
 * number. `RangeBar`'s own header makes exactly this argument; it was written
 * for this card in the chart-grammar pass and then never rendered anywhere.
 *
 * ONE SIDE, NAMED. The board draws "NYY moneyline", not both sides at once. A
 * range bar carrying two opposite-signed populations on one axis is two charts
 * sharing an axis for no reason. This takes the HOME side and the title says
 * whose price it is.
 *
 * AMERICAN ODDS, CONVERTED ONCE. `BookmakerOdds` stores decimal;
 * `decimalToAmerican` is the app's existing converter and the same one the
 * hero strip and the bookmaker grid already print through, so three cards on
 * one page cannot disagree about what −134 means.
 *
 * NOT ZERO-BASED, and no shared domain: the axis is the observed spread, which
 * is `RangeBar`'s documented contract. A range of +112 to +124 anchored at
 * zero is a sliver against the right-hand edge.
 */

import type { UnifiedGameLine } from '@/lib/odds/types';
import { decimalToAmerican } from '@/lib/odds/display';

export interface PriceRangeData {
  title: string;
  points: Array<{ book: string; value: number }>;
  /** The book carrying the best price, drawn last so it survives being covered. */
  highlightBook?: string;
  /**
   * The real consensus — the MEDIAN, not the midpoint of the range. Those
   * differ whenever the books are unevenly spread, which is most of the time,
   * and `RangeBar` draws the consensus as a separate hairline precisely so the
   * two can be seen to differ.
   */
  consensus: number | null;
  emptyMessage: string;
}

export function toPriceRange(gameLine: UnifiedGameLine | null, homeLabel: string): PriceRangeData | null {
  const books = gameLine?.bookmakers ?? [];
  const points = books
    .map((b) => ({ book: b.bookmaker, value: decimalToAmerican(b.homeOdds) }))
    .filter((p): p is { book: string; value: number } => typeof p.value === 'number' && Number.isFinite(p.value));

  // THREE BOOKS IS THE FLOOR. One tick is a number the grid already shows and
  // two is a line segment; the card only says something the grid cannot once
  // there are enough prices for the spread to have a shape. Measured book
  // depth says who clears it: MLB 39 and soccer 33 comfortably, CFB 4 and
  // tennis/NFL 3 marginally, NBA and NHL never — they have zero rows.
  if (points.length < 3) return null;

  const sorted = [...points].sort((a, b) => a.value - b.value);
  const mid = sorted[Math.floor(sorted.length / 2)];
  // Best price for a home backer is the LARGEST American number: +150 beats
  // −110 beats −200, which is one ordering across both signs and needs no
  // special case at zero.
  const best = sorted[sorted.length - 1];

  return {
    title: `${homeLabel} moneyline`,
    points,
    highlightBook: best.book,
    consensus: mid?.value ?? null,
    emptyMessage: 'Not enough books pricing this game to show a spread.',
  };
}
