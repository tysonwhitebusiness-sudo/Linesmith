/**
 * A small, synthetic odds market for `/kit` and the odds UI tests (P8 O1): every
 * state the section must draw in one place — many books, a sharp two-sided
 * price, an exchange ladder, your book, a book off the selected line, a pulled
 * book, an outlier, a pick'em line-only row, a collapsed offshore group, and
 * best prices that cross (negative hold). Not real data, and never shown
 * outside `/kit` and tests.
 */
import type { OddsMarket, OddsQuote } from './types';

export const KIT_NOW = Date.parse('2026-09-24T17:18:00Z');
const t = (minAgo: number) => new Date(KIT_NOW - minAgo * 60e3).toISOString();

function q(book: string, side: string, line: number | null, price: number, o: Partial<OddsQuote> = {}): OddsQuote {
  return { book, side, line, price, since: t(40), checkedAt: t(1), source: `scraper:${book}`, main: true, extra: null, ...o };
}

/** Receiving yards at 65.5: 9 books, Pinnacle two-sided, a crossed best (+108 over at Polymarket). */
export function kitPropMarket(): OddsMarket {
  const L = 65.5;
  return {
    key: 'receiving-yards',
    cur: [
      q('pinnacle', 'over', L, -107, { extra: { limit: 2500 }, since: t(170) }), q('pinnacle', 'under', L, -113, { extra: { limit: 2500 }, since: t(170) }),
      q('circa', 'over', L, -110, { source: 'scraper:vsin' }), q('circa', 'under', L, -110, { source: 'scraper:vsin' }),
      q('kalshi', 'over', 69.5, 105, { extra: { ticker: 'KX-70', yes_bid: 0.47, yes_ask: 0.49, volume_24h: 9300, yes_bids: [[0.47, 120], [0.46, 300]], no_bids: [[0.51, 90], [0.5, 200]] } }),
      q('kalshi', 'under', 69.5, -126),
      q('polymarket', 'over', L, 108, { extra: { bid: 0.47, ask: 0.49, volume_24h: 1200 } }), q('polymarket', 'under', L, -128),
      q('fanduel', 'over', L, -113), q('fanduel', 'under', L, -113),
      q('draftkings', 'over', L, -114), q('draftkings', 'under', L, -110),
      q('betmgm', 'over', L, -115), q('betmgm', 'under', 65.5, -105),
      q('caesars', 'over', 66.5, -122), q('caesars', 'under', 66.5, -110),
      q('bet365', 'over', L, 900), q('bet365', 'under', L, -111),
      q('bovada', 'over', L, -114), q('bovada', 'under', L, -114),
      q('prizepicks', 'over', L, 100), q('prizepicks', 'under', L, 100),
    ],
    hist: {
      pinnacle: [[t(300), 64.5, -110, -110], [t(170), 65.5, -107, -113]],
      fanduel: [[t(300), 64.5, -112, -112], [t(120), 65.5, -113, -113]],
      draftkings: [[t(280), 63.5, -114, -110], [t(60), 65.5, -114, -110]],
      betrivers: [[t(250), 64.5, -117, -114]],
    },
    open: {
      pinnacle: { at: t(2000), line: 62.5, priceA: -114, priceB: -114, source: 'first_seen' },
      fanduel: { at: t(1990), line: 62.5, priceA: -114, priceB: -114, source: 'first_seen' },
      betmgm: { at: t(1980), line: 66.5, priceA: -115, priceB: -115, source: 'vsin_open', flagged: true, reason: 'line 66.5 vs peers median 62.5' },
    },
    steam: [{ t: t(170), dir: 1, books: ['pinnacle', 'fanduel', 'draftkings'], times: [t(170), t(120), t(60)], from: 64.5, to: [65.5, 65.5, 65.5] }],
    moves: [[t(170), 'pinnacle', 64.5, 65.5], [t(120), 'fanduel', 64.5, 65.5], [t(60), 'draftkings', 63.5, 65.5]],
    pulls: [{ book: 'betrivers', side: 'over', line: 64.5, lastPrice: -117, pulledAt: t(30), returnedAt: null }],
  };
}

/** One book only. */
export function kitOneBookMarket(): OddsMarket {
  return { key: 'receptions', cur: [q('draftkings', 'over', 5.5, -120), q('draftkings', 'under', 5.5, -105)], hist: {}, open: {} };
}
