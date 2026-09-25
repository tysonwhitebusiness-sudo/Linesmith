/**
 * The price board's arithmetic (O-A), ported from the approved mockup's
 * `boardRows` / `bestOf` / `mainLines` / `allLines` (`docs/design/odds-rebuild/
 * om-mock.js`). Pure: no fetch, no React. `tests/odds-section-board.test.ts`
 * asserts the mockup's on-screen numbers from its frozen snapshot.
 */
import { BOOK_GROUP_ORDER, bookGroup, bookLabel } from '@/lib/odds/books/registry';
import type { BestPrice, BoardRow, MarketSpec, OddsMarket, OddsQuote } from './types';

export const decimal = (a: number) => 1 + (a > 0 ? a / 100 : 100 / -a);
export const implied = (a: number) => 1 / decimal(a);

/** Is this quote at line L? A spread's side B sits at −L. A moneyline has no line. */
export function atLine(sp: MarketSpec, q: OddsQuote, side: string, L: number | null): boolean {
  if (sp.noLine) return true;
  if (sp.signed) return side === sp.sides[0] ? q.line === L : q.line === (L == null ? null : -L);
  return q.line === L;
}

/** A pick'em row that posts a line and no price (PrizePicks; a flat +100 pick'em row other than Underdog). */
export function noPrice(book: string, q: OddsQuote | null): boolean {
  return book === 'prizepicks' || (!!q && q.price === 100 && bookGroup(book) === 'pickem' && book !== 'underdog');
}

const isPriced = (r: BoardRow) => r.group !== 'pickem';
const groupRank = (g: string) => {
  const i = BOOK_GROUP_ORDER.indexOf(g as (typeof BOOK_GROUP_ORDER)[number]);
  return i < 0 ? BOOK_GROUP_ORDER.length : i;
};
const ageOrder = (q: OddsQuote) => (q.checkedAt ? -Date.parse(q.checkedAt) : Infinity);

/**
 * One row per book: its quotes at line L if it has them, else its main line
 * (shown dimmed — never dropped). D19: with >= 5 priced books at L, a price
 * whose implied probability is under 0.6x or over 1.6x the median is an
 * outlier: kept, labelled, never best. Rows sort by group (D18), then the
 * user's book first within its group, then name.
 */
export function boardRows(m: OddsMarket, sp: MarketSpec, L: number | null, userBook?: string | null): BoardRow[] {
  const by = new Map<string, OddsQuote[]>();
  for (const q of m.cur) (by.get(q.book) ?? by.set(q.book, []).get(q.book)!).push(q);
  const rows: BoardRow[] = [];
  const [A, B] = sp.sides;
  for (const [book, qs] of by) {
    const pick = (side: string, pred: (q: OddsQuote) => boolean) =>
      qs.filter(q => q.side === side && pred(q))
        .sort((x, y) => (x.main ? -1 : 1) - (y.main ? -1 : 1) || ageOrder(x) - ageOrder(y))[0] ?? null;
    let qa = pick(A, q => atLine(sp, q, A, L));
    let qb = pick(B, q => atLine(sp, q, B, L));
    const at = !!(qa || qb);
    if (!at) {
      qa = pick(A, q => q.main);
      qb = pick(B, q => q.main);
    }
    if (!qa && !qb) continue;
    const q = (qa ?? qb)!;
    const mainA = qs.find(c => c.side === A && c.main);
    const checks = [qa, qb].filter((x): x is OddsQuote => !!x && !!x.checkedAt).map(x => x.checkedAt!).sort();
    const sinces = [qa, qb].filter((x): x is OddsQuote => !!x).map(x => x.since).sort();
    rows.push({
      book, group: bookGroup(book), qa, qb, at,
      line: q.line != null ? (q.side === A ? q.line : -q.line) : null,
      checkedAt: checks.length ? checks[checks.length - 1] : null,
      since: sinces.length ? sinces[sinces.length - 1] : null,
      source: q.source, extra: (qa?.extra ?? qb?.extra) ?? null,
      opener: m.open[book] ?? null, mainLine: mainA ? mainA.line : null,
    });
  }
  for (const i of [0, 1] as const) {
    const ps = rows.filter(r => r.at && (i ? r.qb : r.qa) && r.group !== 'pickem')
      .map(r => implied((i ? r.qb : r.qa)!.price)).sort((a, b) => a - b);
    const med = ps[Math.floor(ps.length / 2)];
    if (ps.length >= 5) {
      for (const r of rows) {
        const q = i ? r.qb : r.qa;
        if (r.at && q && (implied(q.price) < med * 0.6 || implied(q.price) > med * 1.6)) {
          if (i) r.outlierB = true; else r.outlierA = true;
        }
      }
    }
  }
  rows.sort((a, b) => groupRank(a.group) - groupRank(b.group)
    || (a.book === userBook ? -1 : b.book === userBook ? 1 : 0)
    || bookLabel(a.book).localeCompare(bookLabel(b.book)));
  return rows;
}

/** The best price on one side at the selected line: pick'em rows and outliers never count (O-B). */
export function bestPrice(rows: BoardRow[], side: 0 | 1): BestPrice | null {
  let b: BestPrice | null = null;
  for (const r of rows) {
    const q = side === 0 ? r.qa : r.qb;
    if (!r.at || !q || !isPriced(r) || (side === 0 ? r.outlierA : r.outlierB)) continue;
    if (!b || decimal(q.price) > decimal(b.quote.price)) b = { book: r.book, quote: q };
  }
  return b;
}

/** The consensus line: the modal main line on side A across priced books. */
export function consensusLine(m: OddsMarket, sp: MarketSpec): { modal: number | null; counts: Record<string, number> } {
  const cnt: Record<string, number> = {};
  for (const q of m.cur) {
    if (q.main && q.side === sp.sides[0] && q.line != null && bookGroup(q.book) !== 'pickem') {
      cnt[q.line] = (cnt[q.line] ?? 0) + 1;
    }
  }
  const e = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  return { modal: e.length ? +e[0][0] : null, counts: cnt };
}

/** Every line priced on side A within `span` of the consensus, ascending (the line stepper's stops). */
export function pricedLines(m: OddsMarket, sp: MarketSpec, span: number): number[] {
  const cen = consensusLine(m, sp).modal;
  const s = new Set<number>();
  for (const q of m.cur) {
    if (q.side === sp.sides[0] && q.line != null && (cen == null || Math.abs(q.line - cen) <= span)) s.add(q.line);
  }
  return [...s].sort((a, b) => a - b);
}

/** How many priced books sit within 5 cents (0.05 decimal) of the best on a side. */
export function withinFiveCents(rows: BoardRow[], best: BestPrice | null, side: 0 | 1): number {
  if (!best) return 0;
  return rows.filter(r => {
    const q = side ? r.qb : r.qa;
    return r.at && isPriced(r) && q && decimal(best.quote.price) - decimal(q.price) <= 0.05;
  }).length;
}

/** Books with history but no current row: they pulled the market. */
export function pulledBooks(m: OddsMarket, rows: BoardRow[]): string[] {
  const have = new Set(rows.map(r => r.book));
  return Object.keys(m.hist).filter(k => !have.has(k));
}
