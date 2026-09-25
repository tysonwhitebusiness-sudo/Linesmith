/**
 * Closing-line research for a finished game (odds build P8, O3; the mockup's
 * `renderFinal`, `om-mock.js`). Pure: every number the "Lines · closing-line
 * research" surface shows, from the game's `/api/odds/game` payload, its start
 * and its final score.
 *
 * A book's CLOSE is its last main-line price recorded at or before the start:
 * its history's last point <= start, else its current main quote when that
 * quote has not changed since the start. A book with neither has no close — it
 * is left out, never guessed.
 */
import { BOOK_GROUP_ORDER, bookGroup, bookLabel } from '@/lib/odds/books/registry';
import { decimal, implied } from './board';
import { devig } from './sharp';
import type { MarketSpec, OddsMarket, OpenerRow } from './types';

export interface Close {
  line: number | null;       // side A's line
  a: number | null;          // side A's price
  b: number | null;          // side B's price
  at: string;
}

/** Every book's close in one market, keyed by book. */
export function closes(m: OddsMarket | undefined, sp: MarketSpec, start: string): Map<string, Close> {
  const out = new Map<string, Close>();
  if (!m) return out;
  const t = Date.parse(start);
  for (const [book, pts] of Object.entries(m.hist)) {
    let last = null;
    for (const p of pts) if (Date.parse(p[0]) <= t) last = p;
    if (last && (last[2] != null || last[3] != null)) out.set(book, { line: last[1], a: last[2], b: last[3], at: last[0] });
  }
  const books = new Set(m.cur.map(q => q.book));
  for (const book of books) {
    if (out.has(book)) continue;
    const qa = m.cur.find(q => q.book === book && q.main && q.side === sp.sides[0]);
    const qb = m.cur.find(q => q.book === book && q.main && q.side === sp.sides[1]);
    const pre = (q: typeof qa) => !!q && Date.parse(q.since) <= t;
    if (!pre(qa) && !pre(qb)) continue;
    out.set(book, {
      line: qa && pre(qa) ? qa.line : qb && pre(qb) && qb.line != null ? (sp.signed ? -qb.line : qb.line) : null,
      a: qa && pre(qa) ? qa.price : null, b: qb && pre(qb) ? qb.price : null,
      at: [qa, qb].filter(pre).map(q => q!.since).sort().pop()!,
    });
  }
  for (const [book] of out) if (bookGroup(book) === 'pickem') out.delete(book);
  return out;
}

/** The consensus close: the line most books closed at (side A). */
export function consensusClose(c: Map<string, Close>): number | null {
  const cnt = new Map<number, number>();
  for (const v of c.values()) if (v.line != null && v.a != null) cnt.set(v.line, (cnt.get(v.line) ?? 0) + 1);
  const e = [...cnt].sort((x, y) => y[1] - x[1] || Math.abs(x[0]) - Math.abs(y[0]));
  return e.length ? e[0][0] : null;
}

export interface FinalScore { home: number; away: number }

export interface ClosingRow {
  book: string;
  group: string;
  openA: number | null;       // the moneyline opener, side A (home)
  openFlagged: boolean;
  closeA: number | null;
  closeB: number | null;
  /** The book's closing side-A implied probability minus Pinnacle's no-vig close (positive = it charged more). */
  vsSharp: number | null;
  /** The value of the book's side-A opener at Pinnacle's fair close: fair × decimal(open) − 1. */
  openerClv: number | null;
  spread: Close | null;
  total: Close | null;
}

export interface ClosingResearch {
  start: string;
  score: FinalScore;
  books: number;
  /** Pinnacle's no-vig close on side A of the moneyline. */
  fairClose: number | null;
  ml: { winner: 'home' | 'away' | 'draw'; pinOpen: number | null; pinClose: number | null;
    /** Did Pinnacle's price on the winner shorten from open to close? null without both. */
    towardResult: boolean | null };
  spread: { line: number | null; pinnacle: Close | null; covered: 'home' | 'away' | 'push' | null; margin: number };
  total: { line: number | null; went: 'over' | 'under' | 'push' | null; points: number };
  rows: ClosingRow[];
}

const TABLE_GROUPS = new Set(['sharp', 'exchange', 'us', 'nevada']);

const groupRank = (g: string) => {
  const i = BOOK_GROUP_ORDER.indexOf(g as (typeof BOOK_GROUP_ORDER)[number]);
  return i < 0 ? BOOK_GROUP_ORDER.length : i;
};

/**
 * The finished game's closing-line research. `markets` is keyed like the
 * payload (`fg_ml`, `fg_sp`, `fg_tot`); side A is home for the moneyline and
 * spread, over for the total.
 */
export function closingResearch(markets: Map<string, OddsMarket>, start: string, score: FinalScore,
                                specs: { ml: MarketSpec; sp: MarketSpec; tot: MarketSpec }): ClosingResearch {
  const ml = closes(markets.get('fg_ml'), specs.ml, start);
  const sp = closes(markets.get('fg_sp'), specs.sp, start);
  const tot = closes(markets.get('fg_tot'), specs.tot, start);
  const pin = ml.get('pinnacle');
  const fairClose = pin && pin.a != null && pin.b != null ? devig(pin.a, pin.b) : null;
  const winner = score.home > score.away ? 'home' : score.home < score.away ? 'away' : 'draw';
  const pinOpen: OpenerRow | undefined = markets.get('fg_ml')?.open.pinnacle;
  const openW = pinOpen ? (winner === 'away' ? pinOpen.priceB : pinOpen.priceA) : null;
  const closeW = pin ? (winner === 'away' ? pin.b : pin.a) : null;
  const margin = score.home - score.away;
  const spLine = consensusClose(sp);
  const covered = spLine == null ? null : margin + spLine > 0 ? 'home' : margin + spLine < 0 ? 'away' : 'push';
  const points = score.home + score.away;
  const totLine = consensusClose(tot);
  const went = totLine == null ? null : points > totLine ? 'over' : points < totLine ? 'under' : 'push';
  // The table is the mockup's: the sharp, exchange, US and Nevada books (offshore
  // and international closes stay in the movement chart, not in this table).
  const books = [...new Set([...ml.keys(), ...sp.keys(), ...tot.keys()])].filter(b => TABLE_GROUPS.has(bookGroup(b)));
  const rows: ClosingRow[] = books.map(book => {
    const c = ml.get(book) ?? null;
    const o = markets.get('fg_ml')?.open[book] ?? null;
    const openA = o && !o.flagged ? o.priceA : null;
    return {
      book, group: bookGroup(book), openA, openFlagged: !!o?.flagged,
      closeA: c?.a ?? null, closeB: c?.b ?? null,
      vsSharp: c?.a != null && fairClose != null ? implied(c.a) - fairClose : null,
      openerClv: openA != null && fairClose != null ? fairClose * decimal(openA) - 1 : null,
      spread: sp.get(book) ?? null, total: tot.get(book) ?? null,
    };
  }).sort((x, y) => groupRank(x.group) - groupRank(y.group) || bookLabel(x.book).localeCompare(bookLabel(y.book)));
  return {
    start, score, books: books.length, fairClose,
    ml: { winner, pinOpen: openW ?? null, pinClose: closeW ?? null,
      towardResult: openW != null && closeW != null && winner !== 'draw' ? decimal(closeW) < decimal(openW) : null },
    spread: { line: spLine, pinnacle: sp.get('pinnacle') ?? null, covered, margin },
    total: { line: totLine, went, points },
    rows,
  };
}
