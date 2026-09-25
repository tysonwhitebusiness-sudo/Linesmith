/**
 * P8 O1: the odds section's arithmetic against the approved mockup's frozen
 * snapshot (`docs/design/odds-rebuild/om-data.js`, 2026-09-24 17:18 UTC).
 *
 * Each value was read off the mockup (`design-mockups` preview, :8125,
 * `odds-rebuild-mockup-2026-09-24.html`) on 2026-09-25 and/or computed by the
 * mockup's own functions on the same snapshot. Two readings of the spec's table
 * differ from the snapshot and are pinned to the snapshot, with the reason:
 *   - Receiving yards: the page (Player page, clock 1:18 PM ET) reads
 *     "18 lines priced"; the mockup's `allLines` on the snapshot gives 19 —
 *     BetMGM's alternate 75 (since 05:21) sits inside the 13.1 span. The
 *     test pins 19, the arithmetic, and the consensus/Pinnacle values the page
 *     shows (65.5 / 66.5).
 *   - Anytime TD: FanDuel's price at the snapshot is +470 (it changed at
 *     17:18); the round-4 reading +2500 predates that. Both books the spec
 *     names are flagged as outliers and neither is ever best.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { boardRows, bestPrice, consensusLine, pricedLines, pulledBooks, withinFiveCents } from '@/lib/odds/section/board';
import { holdSummary } from '@/lib/odds/section/hold';
import { devig, pinnacleAt, pinnacleMain, toAmerican } from '@/lib/odds/section/sharp';
import { marketSpec } from '@/lib/odds/section/types';
import { nflMarket, propMarket } from './fixtures/omData';

test('ATL@GB spread at GB -4.5 (Game page, Spread): best GB BetMGM -105, Pinnacle -113/+102, negative hold reported', () => {
  const m = nflMarket('fg_sp'), sp = marketSpec('sp');
  const rows = boardRows(m, sp, -4.5, 'fanduel');
  const b0 = bestPrice(rows, 0), b1 = bestPrice(rows, 1);
  assert.equal(b0?.book, 'betmgm');
  assert.equal(b0?.quote.price, -105);
  assert.equal(b1?.book, 'polymarket');
  assert.equal(b1?.quote.price, 108.33);
  const pin = pinnacleAt(m, sp, -4.5);
  assert.deepEqual([pin?.a.price, pin?.b.price], [-113, 102]);
  const h = holdSummary(rows, b0, b1);
  assert.ok(h.atBest !== null && h.atBest < 0, 'the best prices cross');
  assert.equal((h.atBest! * 100).toFixed(1), '-0.8');
});

test('London receptions 5.5 (Player page, Receptions): Pinnacle -103/-117, fair over 48.5%', () => {
  const m = propMarket('drake london', 'receptions'), sp = marketSpec('prop');
  const pin = pinnacleAt(m, sp, 5.5);
  assert.deepEqual([pin?.a.price, pin?.b.price], [-103, -117]);
  assert.ok(Math.abs(pin!.fairA * 100 - 48.5) < 0.1, `fair ${pin!.fairA}`);
  assert.equal(toAmerican(pin!.fairA), toAmerican(devig(-103, -117)));
});

test('London anytime TD: FanDuel and bet365 are flagged as outliers and never best (D19)', () => {
  const m = propMarket('drake london', 'anytime_td'), sp = marketSpec('prop');
  const rows = boardRows(m, sp, 0.5);
  const flagged = rows.filter(r => r.outlierA || r.outlierB).map(r => r.book).sort();
  assert.deepEqual(flagged, ['bet365', 'fanduel']);
  const b0 = bestPrice(rows, 0);
  assert.ok(b0 && !['bet365', 'fanduel'].includes(b0.book));
});

test('London receiving yards: consensus 65.5, Pinnacle 66.5, 19 lines priced in the span', () => {
  const m = propMarket('drake london', 'rec_yds'), sp = marketSpec('prop');
  const modal = consensusLine(m, sp).modal;
  assert.equal(modal, 65.5);
  assert.equal(pinnacleMain(m, sp), 66.5);
  assert.equal(pricedLines(m, sp, Math.max(4, Math.abs(modal!) * 0.2)).length, 19);
});

test('the board: groups in D18 order, your book first in its group, a book off the line kept (dimmed)', () => {
  const m = nflMarket('fg_sp'), sp = marketSpec('sp');
  const rows = boardRows(m, sp, -4.5, 'fanduel');
  const order = ['sharp', 'exchange', 'us', 'nevada', 'offshore', 'intl', 'pickem'];
  const ranks = rows.map(r => order.indexOf(r.group));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  const us = rows.filter(r => r.group === 'us');
  assert.equal(us[0].book, 'fanduel');
  const off = rows.filter(r => !r.at);
  for (const r of off) assert.ok(r.line !== -4.5);
  const b0 = bestPrice(rows, 0);
  assert.ok(withinFiveCents(rows, b0, 0) >= 1);
  assert.deepEqual(pulledBooks(m, rows).filter(k => rows.some(r => r.book === k)), []);
});
