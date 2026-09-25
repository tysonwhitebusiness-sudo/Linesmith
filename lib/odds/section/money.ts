/**
 * "Where the money is" (odds build P10, O7 / Track V3; the approved mockup's
 * `moneyGame` and `moneyProp`). Pure: the rows the card draws, from the
 * splits and exchange rows `lib/db/oddsRead.ts` reads (`market_splits`,
 * `exchange_books`).
 *
 * Every row names WHOSE customers or which exchange it describes —
 * DraftKings' customers, Circa's customers, a consensus that does not say
 * whose, contest picks, tracked bet counts, exchange volume. No row speaks
 * for everyone who bets, and no row claims to be the total wagered: each
 * source only sees its own book. `tests/odds-ui.test.ts` bans the words that
 * would say otherwise from this file and the card.
 */
import type { SlateOddsGame } from './slate';

/** One observation from `market_splits` (the newest per source/book/market/side/line). */
export interface SplitObs {
  at: string;
  source: string;
  kind: string;          // bets_money | picks | bet_count | pick_counts
  book: string | null;
  market: string;        // ml | sp | tot | game | a prop market key
  side: string;          // home | away | over | under | '' (a whole-game count)
  line: number | null;
  pctBets: number | null;
  pctMoney: number | null;
  count: number | null;
  countTotal: number | null;
}

/** One exchange contract from `exchange_books`. */
export interface ExchangeObs {
  exchange: string;      // kalshi | polymarket
  market: string;
  side: string;
  point: number | null;
  bestBid: number | null;   // 0..1
  bestAsk: number | null;
  volume24h: number | null;
  openInterest: number | null;
  liquidity: number | null;
  at: string;
}

/** DraftKings' money % over time, per market: [at, line, bets % side A, money % side A]. */
export type SplitHistPoint = [at: string, line: number | null, bets: number | null, money: number | null];

export interface MoneyPayload {
  splits: SplitObs[];
  /** Keyed `${source}|${book}|${market}` (the mockup's `splitHist`), side A only, oldest first. */
  splitHist: Record<string, SplitHistPoint[]>;
  exchanges: ExchangeObs[];
}

/** The gap, in points, at which money and bets are said to split. */
export const SPLIT_GAP = 15;

export interface SideShare { bets: number | null; money: number | null }

export type MoneyRow =
  | { kind: 'split'; key: string; name: string; source: string; book: string | null; note: string; at: string; a: SideShare; b: SideShare;
      /** Set when |money − bets| ≥ 15 on side A: which side draws the larger share of the money than of the bets, and by how much. */
      split: { side: 0 | 1; pts: number } | null }
  | { kind: 'picks'; key: string; name: string; note: string; at: string; a: number; b: number; picks: number | null }
  | { kind: 'count'; key: string; name: string; note: string; at: string; count: number }
  | { kind: 'exchanges'; key: string; name: string; note: string;
      kalshi: { volume24h: number; openInterest: number } | null;
      polymarket: { volume24h: number; liquidity: number } | null };

/** Money vs bets on side A: a split when the two differ by 15 points or more. */
export function moneySplit(a: SideShare): { side: 0 | 1; pts: number } | null {
  if (a.money == null || a.bets == null) return null;
  const gap = Math.round(a.money - a.bets);
  return Math.abs(gap) >= SPLIT_GAP ? { side: gap > 0 ? 0 : 1, pts: Math.abs(gap) } : null;
}

const find = (p: MoneyPayload, source: string, book: string | null, market: string, side: string) =>
  p.splits.find(s => s.source === source && (book == null || s.book === book) && s.market === market && s.side === side && s.kind !== 'pick_counts');

/**
 * The game page's rows for one full-game market (`ml`/`sp`/`tot`), in the
 * approved order: DraftKings customers (DK Network, else VSiN's DraftKings
 * row), Circa customers, ScoresAndOdds consensus, Covers contest picks,
 * Action Network's tracked bet count, then the exchanges' moneyline volume.
 * Each row is present only when its source has data for this market.
 */
export function gameMoneyRows(p: MoneyPayload, market: 'ml' | 'sp' | 'tot', sides: [string, string]): MoneyRow[] {
  const rows: MoneyRow[] = [];
  const pair = (name: string, source: string, book: string, note: string) => {
    const a = find(p, source, book, market, sides[0]), b = find(p, source, book, market, sides[1]);
    if (!a || !b || (a.pctBets == null && a.pctMoney == null)) return false;
    const sa = { bets: a.pctBets, money: a.pctMoney }, sb = { bets: b.pctBets, money: b.pctMoney };
    rows.push({ kind: 'split', key: `${source}|${book}`, name, source, book, note, at: a.at > b.at ? a.at : b.at, a: sa, b: sb, split: moneySplit(sa) });
    return true;
  };
  if (!pair('DraftKings customers', 'dknetwork', 'draftkings', 'DK Network')) pair('DraftKings customers', 'vsin', 'draftkings', 'VSiN');
  pair('Circa customers', 'vsin', 'circa', 'VSiN');
  pair('ScoresAndOdds consensus', 'sao_consensus', 'scoresandodds', 'source does not say whose bets');
  const ca = p.splits.find(s => s.source === 'covers' && s.market === market && s.side === sides[0]);
  const cb = p.splits.find(s => s.source === 'covers' && s.market === market && s.side === sides[1]);
  if (ca?.pctBets != null && cb?.pctBets != null) {
    const n = ca.count != null && cb.count != null ? ca.count + cb.count : null;
    rows.push({ kind: 'picks', key: 'covers', name: 'Covers contest picks', note: 'picks, not money', at: ca.at, a: ca.pctBets, b: cb.pctBets, picks: n });
  }
  const an = p.splits.find(s => s.source === 'actionnetwork' && s.kind === 'bet_count' && s.count != null);
  if (an) rows.push({ kind: 'count', key: 'actionnetwork', name: 'Action Network', note: 'tracked bets on this game (all markets), not split by side', at: an.at, count: an.count! });
  const ml = p.exchanges.filter(e => e.market === 'ml');
  const sum = (xs: ExchangeObs[], f: (e: ExchangeObs) => number | null) => xs.reduce((a, e) => a + (f(e) ?? 0), 0);
  const k = ml.filter(e => e.exchange === 'kalshi'), pm = ml.filter(e => e.exchange === 'polymarket');
  const kalshi = k.length && k.some(e => e.volume24h != null) ? { volume24h: sum(k, e => e.volume24h), openInterest: sum(k, e => e.openInterest) } : null;
  const poly = pm.length && pm.some(e => e.volume24h != null || e.liquidity != null) ? { volume24h: sum(pm, e => e.volume24h), liquidity: sum(pm, e => e.liquidity) } : null;
  if (kalshi || poly) rows.push({ kind: 'exchanges', key: 'exchanges', name: 'Exchanges', note: 'traded, not bets', kalshi, polymarket: poly });
  return rows;
}

/** DraftKings' money % on side A over the game's history: first → now, for the sparkline. */
export function dkMoneyTrend(p: MoneyPayload, market: 'ml' | 'sp' | 'tot'): { points: [number, number][]; first: { at: string; money: number }; last: { at: string; money: number } } | null {
  const h = (p.splitHist[`dknetwork|draftkings|${market}`] ?? []).filter(x => x[3] != null);
  if (h.length < 2) return null;
  return {
    points: h.map(x => [Date.parse(x[0]), x[3]!] as [number, number]),
    first: { at: h[0][0], money: h[0][3]! },
    last: { at: h[h.length - 1][0], money: h[h.length - 1][3]! },
  };
}

export interface PropMoney {
  /** Sleeper's pick'em entries at the line in view: counts, not money. */
  sleeper: { line: number; over: number; under: number; pctOver: number; at: string } | null;
  /** Kalshi's N+ contracts for this player and market, lowest first. */
  kalshi: { contract: string; point: number; bid: number | null; ask: number | null; volume24h: number | null; openInterest: number | null }[];
}

/**
 * The player page's rows for one prop market at the line in view. No source
 * publishes a money or bet share for a player prop, so the card always says
 * so; what exists is Sleeper's pick counts and Kalshi's contract volume.
 */
export function propMoneyRows(p: MoneyPayload, market: string, line: number | null): PropMoney {
  const sl = p.splits.filter(s => s.source === 'sleeper' && s.kind === 'pick_counts' && s.market === market && s.count != null);
  const lines = [...new Set(sl.map(s => s.line).filter((x): x is number => x != null))];
  const at = line != null && lines.includes(line) ? line : null;
  let sleeper: PropMoney['sleeper'] = null;
  if (at != null) {
    const o = sl.find(s => s.line === at && s.side === 'over'), u = sl.find(s => s.line === at && s.side === 'under');
    const ov = o?.count ?? 0, un = u?.count ?? 0;
    if (ov + un > 0) sleeper = { line: at, over: ov, under: un, pctOver: Math.round((100 * ov) / (ov + un)), at: (o ?? u)!.at };
  }
  const ex = p.exchanges.filter(e => e.exchange === 'kalshi' && e.market === market && e.point != null);
  const byPoint = new Map<number, PropMoney['kalshi'][number]>();
  for (const e of ex.filter(e => e.side === 'over')) {
    byPoint.set(e.point!, { contract: `${Math.ceil(e.point!)}+`, point: e.point!, bid: e.bestBid, ask: e.bestAsk, volume24h: e.volume24h, openInterest: e.openInterest });
  }
  // A Kalshi N+ contract has ONE yes price. The bridge labels some contracts'
  // rows `under`, but their bid/ask are still the yes side — measured on
  // Derrick Henry's rushing ladder 2026-09-25: the `under` 60+ row read
  // 77–78¢ between the `over` 50+ at 84–86¢ and 70+ at 68–69¢. So an
  // under-labelled contract is read as it is stored, never inverted.
  for (const e of ex.filter(e => e.side !== 'over' && !byPoint.has(e.point!))) {
    byPoint.set(e.point!, { contract: `${Math.ceil(e.point!)}+`, point: e.point!, bid: e.bestBid, ask: e.bestAsk, volume24h: e.volume24h, openInterest: e.openInterest });
  }
  return { sleeper, kalshi: [...byPoint.values()].sort((a, b) => a.point - b.point) };
}

/**
 * The Market hub's "Where the money is": every game with a DraftKings
 * split on the home moneyline, sorted by the gap between its money % and
 * bets %, the 15-point ones flagged.
 */
export function slateMoneyGaps(games: SlateOddsGame[]): { gameId: string; money: number; bets: number; gap: number; split: boolean }[] {
  return games.filter(g => g.dk?.money != null && g.dk?.bets != null)
    .map(g => ({ gameId: g.gameId, money: g.dk!.money!, bets: g.dk!.bets!, gap: Math.round(g.dk!.money! - g.dk!.bets!) }))
    .map(r => ({ ...r, split: Math.abs(r.gap) >= SPLIT_GAP }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}
