/**
 * A small, synthetic odds market for `/kit` and the odds UI tests (P8 O1): every
 * state the section must draw in one place — many books, a sharp two-sided
 * price, an exchange ladder, your book, a book off the selected line, a pulled
 * book, an outlier, a pick'em line-only row, a collapsed offshore group, and
 * best prices that cross (negative hold). Not real data, and never shown
 * outside `/kit` and tests.
 */
import type { EdgeView, MarketEdge } from './types';
import type { SlateOddsGame } from './slate';
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

/** Two Slate games for /kit (O4): one with a sharp price, steam, a pull and DK splits; one with none of them. */
export function kitSlateGames(): SlateOddsGame[] {
  return [
    {
      gameId: 'kit-1', books: 41, checkedAt: t(1),
      ml: { home: { book: 'fanduel', price: -118 }, away: { book: 'polymarket', price: 112 }, hold: -0.0015 },
      pinnacle: { home: -124, away: 113, fairHome: 0.5367, checkedAt: t(1) },
      total: { line: 8.5, open: 9 }, spread: { line: -1.5, open: -1.5 },
      moved: { book: 'pinnacle', open: -112, now: -124, openedAt: t(900) },
      dk: { money: 71, bets: 48 }, kalshi24h: 18420,
      board: { pinnacle: { home: -124, away: 113 }, draftkings: { home: -125, away: 105 }, fanduel: { home: -118, away: 100 }, polymarket: { home: -128, away: 112 } },
      totalLines: [{ line: 8.5, books: ['draftkings', 'fanduel', 'pinnacle'] }, { line: 9, books: ['caesars'] }],
      steam: [{ market: 'tot', t: t(95), dir: -1, books: ['pinnacle', 'circa', 'draftkings', 'fanduel'], times: [t(95), t(90), t(80), t(71)], from: 9, to: [8.5, 8.5, 8.5, 8.5] }],
      dropping: [{ market: 'ml', medianMove: 0.021, sameWay: 18, books: 22 }, { market: 'tot', medianMove: -0.012, sameWay: 9, books: 14 }],
      pulls: [{ book: 'betmgm', market: 'sp', side: 'home', pulledAt: t(12) }],
    },
    {
      gameId: 'kit-2', books: 3, checkedAt: t(20),
      ml: { home: { book: 'draftkings', price: 150 }, away: { book: 'fanduel', price: -170 }, hold: 0.03 },
      pinnacle: null, total: { line: 44.5, open: null }, spread: { line: 3.5, open: null },
      moved: null, dk: null, kalshi24h: null,
      board: { draftkings: { home: 150, away: -180 }, fanduel: { home: 145, away: -170 } },
      totalLines: [], steam: [], dropping: [], pulls: [],
    },
  ];
}

/**
 * P11: the two market edges the approved mockup found by hand, as the payload
 * carries them (GB -4.5 at BetMGM; Drake London receptions 5.5 over at
 * Underdog). Static numbers from the mockup, for /kit only.
 */
export function kitEdges(): MarketEdge[] {
  const at = (minAgo: number) => new Date(KIT_NOW - minAgo * 60e3).toISOString();
  const base = { sport: 'nfl', gameId: 'kit-2', singleSource: false, sharpCheckedAt: at(0.5), softCheckedAt: at(0.3) };
  return [
    { ...base, kind: 'prop', subjectId: 'london', subjectName: 'Drake London', marketKey: 'receiving-yards', side: 'over', line: 65.5,
      book: 'underdog', source: 'scraper:underdog', price: 110, fair: 0.485, fairPrice: 106, implied: 0.4762, edgePts: 0.0088, ev: 0.016,
      softSince: at(180), passingSince: at(7),
      reference: { book: 'pinnacle', prices: { over: -103, under: -117 }, limit: 500, priceTime: at(1.5), second: { book: 'novig', fair: 0.49 } } },
    { ...base, kind: 'game', subjectId: '', subjectName: null, marketKey: 'fg_sp', side: 'home', line: -4.5,
      book: 'betmgm', source: 'scraper:betmgm', price: -105, fair: 0.517, fairPrice: -107, implied: 0.5122, edgePts: 0.0051, ev: 0.0095,
      softSince: at(120), passingSince: at(12),
      reference: { book: 'pinnacle', prices: { home: -113, away: 102 }, limit: 2500, priceTime: at(1.5), second: null } },
  ];
}

/** P11 follow-up: the Edge card's NO EDGE state with numbers (Python's evaluation), for /kit. */
export function kitEdgeView(status: EdgeView['status'] = 'on'): EdgeView {
  const g = (fail: number) => ['g1_reference', 'g2_time', 'g3_corroboration', 'g4_settled', 'g5_pregame', 'g6_conservative',
    'g7_copies', 'g8_cap_outlier', 'g9_self_check'].map((gate, i) => ({ gate, ok: i + 1 !== fail, detail: i + 1 === fail ? 'min EV -2.40%' : '' }));
  return {
    status, reason: status === 'paused' ? '2 of 27 passing edges above 5% EV' : status === 'off' ? 'Edges are switched off.' : null,
    candidates: status === 'off' || status === 'stale' ? undefined : [{
      marketKey: 'receiving-yards', subjectId: 'london', line: 65.5, reason: null,
      sharp: { book: 'pinnacle', prices: { over: -118, under: -104 }, limit: 500 },
      best: { side: 'over', book: 'draftkings', price: -125, fair: 0.531, fairPrice: -113, implied: 0.5556, edgePts: -0.0246, ev: -0.024,
        passed: false, firstFailure: 'g6_conservative', gates: g(6) },
    }],
  };
}
