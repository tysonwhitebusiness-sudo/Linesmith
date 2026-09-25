/**
 * Depth, limits & order book (O-H), ported from the mockup's `depthCard`:
 * Pinnacle's limit, how many books price the market, and the nearest exchange
 * ladder (Kalshi yes bids / no bids as asks, or Polymarket bids / asks). Pure.
 */
import { pinnacleAt } from './sharp';
import type { MarketSpec, OddsMarket, OddsQuote } from './types';

type Level = [price: number, size: number];

export interface Depth {
  pinnacleLimit: number | null;
  books: number;
  ladder: {
    exchange: 'kalshi' | 'polymarket';
    quote: OddsQuote;
    bids: Level[];
    asks: Level[];
    spreadCents: number | null;
    volume24h: number | null;
    openInterest: number | null;
    liquidity: number | null;
  } | null;
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
const levels = (v: unknown): Level[] => (Array.isArray(v) ? v.filter(l => Array.isArray(l) && l.length >= 2) as Level[] : []);

export function depth(m: OddsMarket, sp: MarketSpec, L: number | null): Depth {
  const pin = pinnacleAt(m, sp, L);
  const limit = num(pin?.a.extra?.limit)
    ?? num(m.cur.find(q => q.book === 'pinnacle' && q.main && num(q.extra?.limit) != null)?.extra?.limit);
  const near = (q: OddsQuote) => Math.abs((q.line ?? 0) - (L ?? 0));
  const lad = m.cur.filter(q => q.extra?.yes_bids && q.side === sp.sides[0] && q.line != null).sort((a, b) => near(a) - near(b))[0]
    ?? m.cur.filter(q => q.extra?.bids && q.side === sp.sides[0]).sort((a, b) => near(a) - near(b))[0];
  let ladder: Depth['ladder'] = null;
  if (lad) {
    const x = lad.extra ?? {};
    const kal = !!x.yes_bids;
    const bids = kal ? levels(x.yes_bids) : levels(x.bids);
    const asks = kal ? levels(x.no_bids).map(([p, s]) => [+(1 - p).toFixed(2), s] as Level) : levels(x.asks);
    const bid = num(x.yes_bid) ?? num(x.bid), ask = num(x.yes_ask) ?? num(x.ask);
    ladder = {
      exchange: kal ? 'kalshi' : 'polymarket', quote: lad, bids, asks,
      spreadCents: bid != null && ask != null ? Math.round((ask - bid) * 100) : null,
      volume24h: num(x.volume_24h), openInterest: num(x.open_interest), liquidity: num(x.liquidity),
    };
  }
  return { pinnacleLimit: limit, books: new Set(m.cur.map(q => q.book)).size, ladder };
}
