/**
 * Sharp prices (O-S), ported from the mockup's `pinAt` / `pinMain` / `devig` /
 * `sharpStrip`. Fair = Pinnacle with the vig removed, multiplicatively
 * (`devig_two_way`). Pure.
 */
import { atLine, implied } from './board';
import type { MarketSpec, OddsMarket, OddsQuote } from './types';

/** No-vig probability of side A from two American prices (multiplicative). */
export function devig(a: number, b: number): number {
  const pa = implied(a), pb = implied(b);
  return pa / (pa + pb);
}

/** A probability as an American price. */
export function toAmerican(p: number): number {
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

export interface TwoSided {
  a: OddsQuote;
  b: OddsQuote;
  fairA: number;
}

/** A book's two-sided price at line L (main line first), or null. */
export function twoSidedAt(m: OddsMarket, sp: MarketSpec, book: string, L: number | null): TwoSided | null {
  const find = (i: 0 | 1) => m.cur
    .filter(q => q.book === book && q.side === sp.sides[i] && atLine(sp, q, sp.sides[i], L))
    .sort((x, y) => (x.main ? -1 : 1) - (y.main ? -1 : 1))[0];
  const a = find(0), b = find(1);
  return a && b ? { a, b, fairA: devig(a.price, b.price) } : null;
}

/** Pinnacle two-sided at L. */
export const pinnacleAt = (m: OddsMarket, sp: MarketSpec, L: number | null) => twoSidedAt(m, sp, 'pinnacle', L);

/** Pinnacle's own main line on side A (where "go to X" sends the stepper). */
export function pinnacleMain(m: OddsMarket, sp: MarketSpec): number | null {
  const a = m.cur.find(q => q.book === 'pinnacle' && q.side === sp.sides[0] && q.main);
  return a ? a.line : null;
}

export interface ExchangeQuote {
  book: string;
  quote: OddsQuote;
  bid: number | null;
  ask: number | null;
  volume24h: number | null;
  liquidity: number | null;
}

const EXCHANGE_BOOKS = ['kalshi', 'novig', 'prophetx', 'polymarket'];
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);

/** The exchanges at line L on side A (the Sharp prices card's third tile). */
export function exchangesAt(m: OddsMarket, sp: MarketSpec, L: number | null): ExchangeQuote[] {
  const out: ExchangeQuote[] = [];
  for (const book of EXCHANGE_BOOKS) {
    const q = m.cur.filter(c => c.book === book && c.side === sp.sides[0] && atLine(sp, c, sp.sides[0], L))
      .sort((x, y) => (x.source === book ? -1 : 1) - (y.source === book ? -1 : 1))[0];
    if (!q) continue;
    const x = q.extra ?? {};
    const bid = num(x.yes_bid) ?? num(x.bid), ask = num(x.yes_ask) ?? num(x.ask);
    out.push({ book, quote: q, bid, ask, volume24h: num(x.volume_24h), liquidity: num(x.liquidity) });
  }
  return out;
}

/** Kalshi's nearest contracts when it has none at L (a prop's "no contract at 5.5 · nearest 5+ / 6+"). */
export function nearestKalshi(m: OddsMarket, sp: MarketSpec, L: number, n = 2): OddsQuote[] {
  if (sp.signed) return [];
  return m.cur.filter(q => q.book === 'kalshi' && q.side === sp.sides[0] && q.line != null && num(q.extra?.yes_bid) != null)
    .sort((x, y) => Math.abs(x.line! - L) - Math.abs(y.line! - L)).slice(0, n)
    .sort((x, y) => x.line! - y.line!);
}

/** A Pinnacle price older than 6 h reads "Unchanged for", not "Price since". */
export const SHARP_STALE_S = 6 * 3600;
