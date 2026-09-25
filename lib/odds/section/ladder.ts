/**
 * "All lines" (O-G), ported from the mockup's `ladderCard`: lines x books, the
 * best price per line on each side, and Pinnacle's fair % where it prices the
 * line. Pure.
 */
import { BOOK_GROUP_ORDER, bookGroup, bookLabel } from '@/lib/odds/books/registry';
import { atLine, decimal, pricedLines } from './board';
import { pinnacleAt } from './sharp';
import type { MarketSpec, OddsMarket, OddsQuote } from './types';

export interface LadderRow {
  line: number;
  pinnacleFairA: number | null;
  cells: Record<string, { a: OddsQuote | null; b: OddsQuote | null }>;
  bestA: OddsQuote | null;
  bestB: OddsQuote | null;
}

export function ladder(m: OddsMarket, sp: MarketSpec, span: number): { books: string[]; rows: LadderRow[] } {
  const lines = pricedLines(m, sp, span);
  const onLadder = (q: OddsQuote) => q.line != null && lines.includes(q.side === sp.sides[0] ? q.line : -q.line);
  const books = [...new Set(m.cur.filter(onLadder).map(q => q.book))].filter(k => bookGroup(k) !== 'pickem')
    .sort((a, b) => BOOK_GROUP_ORDER.indexOf(bookGroup(a)) - BOOK_GROUP_ORDER.indexOf(bookGroup(b))
      || bookLabel(a).localeCompare(bookLabel(b)));
  const get = (k: string, i: 0 | 1, L: number) =>
    m.cur.find(q => q.book === k && q.side === sp.sides[i] && atLine(sp, q, sp.sides[i], L)) ?? null;
  const rows = lines.map(L => {
    const cells: LadderRow['cells'] = {};
    let bestA: OddsQuote | null = null, bestB: OddsQuote | null = null;
    for (const k of books) {
      const a = get(k, 0, L), b = get(k, 1, L);
      cells[k] = { a, b };
      if (a && (!bestA || decimal(a.price) > decimal(bestA.price))) bestA = a;
      if (b && (!bestB || decimal(b.price) > decimal(bestB.price))) bestB = b;
    }
    return { line: L, pinnacleFairA: pinnacleAt(m, sp, L)?.fairA ?? null, cells, bestA, bestB };
  });
  return { books, rows };
}
