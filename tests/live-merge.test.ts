/**
 * Odds build P9 §4 — the game page's light refresh (`lib/odds/section/liveMerge.ts`).
 * The full payload's history is read once; a `?live=1` refresh carries current
 * prices and pulls only, and the merge must extend each book's history the way
 * the history reader would, keep openers, recompute moves, keep a market whose
 * books all left, and update a pull that has come back.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mergeLiveGame } from '../lib/odds/section/liveMerge';
import type { GameOddsPayload, OddsQuote } from '../lib/odds/section/types';

const q = (book: string, side: string, line: number | null, price: number, since: string): OddsQuote =>
  ({ book, side, line, price, since, checkedAt: since, source: `scraper:${book}`, main: true });
const T0 = '2026-09-25T16:00:00.000Z', T1 = '2026-09-25T17:00:00.000Z', T2 = '2026-09-25T17:30:00.000Z';

const full: GameOddsPayload = {
  sport: 'cfb', gameId: 'g', asOf: T1, latency: [], powerRatings: [{ subject: 'X', data: {} }],
  markets: [
    { key: 'fg_sp', cur: [q('pinnacle', 'home', -7, -110, T0), q('pinnacle', 'away', 7, -110, T0)],
      hist: { pinnacle: [[T0, -7, -110, -110]] }, open: { pinnacle: { at: T0, line: -6.5, priceA: -110, priceB: -110 } },
      pulls: [{ book: 'fanduel', side: 'home', line: -7, lastPrice: -112, pulledAt: T0, returnedAt: null }] },
    { key: '1h_tot', cur: [q('pinnacle', 'over', 24.5, -110, T0)], hist: { pinnacle: [[T0, 24.5, -110, null]] }, open: {} },
  ],
};

test('a moved main line becomes a history point at its change time; openers, power ratings and pulls carry', () => {
  const light: GameOddsPayload = { sport: 'cfb', gameId: 'g', asOf: T2, latency: [], powerRatings: [], markets: [
    { key: 'fg_sp', cur: [q('pinnacle', 'home', -7.5, -105, T1), q('pinnacle', 'away', 7.5, -115, T1)], hist: {}, open: {},
      pulls: [{ book: 'fanduel', side: 'home', line: -7, lastPrice: -112, pulledAt: T0, returnedAt: T1 }] },
  ] };
  const m = mergeLiveGame(full, light);
  const sp = m.markets.find(x => x.key === 'fg_sp')!;
  assert.deepEqual(sp.hist.pinnacle, [[T0, -7, -110, -110], [T1, -7.5, -105, -115]]);
  assert.equal(sp.open.pinnacle.line, -6.5);
  assert.deepEqual(sp.moves, [[T1, 'pinnacle', -7, -7.5]]);
  assert.equal(sp.pulls!.length, 1);
  assert.equal(sp.pulls![0].returnedAt, T1, 'the pull came back');
  assert.equal(m.asOf, T2);
  assert.equal(m.powerRatings.length, 1);
  // The 1st-half total left every book: kept, with its history, and no prices.
  const h = m.markets.find(x => x.key === '1h_tot')!;
  assert.deepEqual(h.cur, []);
  assert.equal(h.hist.pinnacle.length, 1);
});

test('an unchanged main pair adds no point; a "since" older than history lands at the refresh time', () => {
  const same = mergeLiveGame(full, { ...full, asOf: T2, markets: [{ ...full.markets[0], hist: {}, open: {} }] });
  assert.equal(same.markets[0].hist.pinnacle.length, 1);
  const stale: GameOddsPayload = { ...full, asOf: T2, markets: [{ key: 'fg_sp', hist: {}, open: {},
    cur: [q('pinnacle', 'home', -7, -120, '2026-09-25T15:00:00.000Z'), q('pinnacle', 'away', 7, -100, '2026-09-25T15:00:00.000Z')] }] };
  assert.deepEqual(mergeLiveGame(full, stale).markets[0].hist.pinnacle.at(-1), [T2, -7, -120, -100]);
});
