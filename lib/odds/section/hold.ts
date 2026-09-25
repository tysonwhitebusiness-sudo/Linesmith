/**
 * Market hold (O-B), ported from the mockup's `bestCard`: the hold at one book
 * (the median of every book two-sided at the line, exchanges excluded) against
 * the hold at the best prices. A negative hold is reported as a fact (D20),
 * never labelled an opportunity. Pure.
 */
import { implied } from './board';
import type { BestPrice, BoardRow } from './types';

export interface HoldSummary {
  /** The median book's hold (the typical price you pay). */
  typical: { book: string; hold: number } | null;
  /** The lowest single-book hold. */
  lowest: { book: string; hold: number } | null;
  /** The hold across the best price on each side; negative when the best prices cross. */
  atBest: number | null;
}

export function holdSummary(rows: BoardRow[], best0: BestPrice | null, best1: BestPrice | null): HoldSummary {
  const two = rows.filter(r => r.at && r.qa && r.qb && r.group !== 'pickem' && r.group !== 'exchange');
  const holds = two.map(r => ({ book: r.book, hold: implied(r.qa!.price) + implied(r.qb!.price) - 1 }))
    .sort((a, b) => a.hold - b.hold);
  return {
    typical: holds.length ? holds[Math.floor(holds.length / 2)] : null,
    lowest: holds[0] ?? null,
    atBest: best0 && best1 ? implied(best0.quote.price) + implied(best1.quote.price) - 1 : null,
  };
}
