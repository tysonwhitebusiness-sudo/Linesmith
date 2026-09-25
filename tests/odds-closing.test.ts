/**
 * P8 O3: a finished game's closing-line research (`lib/odds/section/closing.ts`)
 * against the approved mockup's final surface (om-data's TOR @ BAL, Sep 23,
 * BAL 4–2; the "Game page · final" tab of odds-rebuild-mockup-2026-09-24.html).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { om, toMarket, iso } from './fixtures/omData';
import { closes, closingResearch } from '@/lib/odds/section/closing';
import { marketSpec, type OddsMarket } from '@/lib/odds/section/types';

const SPECS = { ml: marketSpec('ml'), sp: marketSpec('sp'), tot: marketSpec('tot') };
const g = om().mlb.find((x: { final?: boolean }) => x.final);
const markets = new Map<string, OddsMarket>([['fg_ml', toMarket('fg_ml', g.markets.ml)], ['fg_sp', toMarket('fg_sp', g.markets.sp)], ['fg_tot', toMarket('fg_tot', g.markets.tot)]]);
const start = iso(g.start);
const r = closingResearch(markets, start, { home: 4, away: 2 }, SPECS);

test('tiles: BAL won, Pinnacle -119 -> -117 moved away from the result; BAL -1.5 covered; under 7.5', () => {
  assert.equal(r.ml.winner, 'home');
  assert.equal(r.ml.pinOpen, -119);
  assert.equal(r.ml.pinClose, -117);
  assert.equal(r.ml.towardResult, false);
  assert.equal(r.spread.line, -1.5);
  assert.equal(r.spread.covered, 'home');
  assert.equal(r.spread.pinnacle?.a, 178);
  assert.equal(r.total.line, 7.5);
  assert.equal(r.total.went, 'under');
  assert.ok(Math.abs(r.fairClose! - 0.5286) < 0.0005);
});

test('the table holds sharp, exchange, US and Nevada books only, sharp first', () => {
  assert.ok(r.rows.length > 5);
  assert.equal(r.rows[0].group, 'sharp');
  assert.ok(r.rows.every(x => ['sharp', 'exchange', 'us', 'nevada'].includes(x.group)));
  const pin = r.rows.find(x => x.book === 'pinnacle')!;
  // Pinnacle against its own no-vig close: exactly its margin on BAL.
  assert.ok(pin.vsSharp! > 0 && pin.vsSharp! < 0.02);
});

test('a close is the last price at or before the start, never after', () => {
  const m = markets.get('fg_ml')!;
  const late: OddsMarket = { ...m, hist: { ...m.hist, pinnacle: [...m.hist.pinnacle, [new Date(Date.parse(start) + 600e3).toISOString(), null, -300, 250]] } };
  assert.equal(closes(late, SPECS.ml, start).get('pinnacle')!.a, -117);
  // A book with no history and a price changed after the start has no close.
  const after: OddsMarket = { key: 'fg_ml', hist: {}, open: {}, cur: [{ book: 'x', side: 'home', line: null, price: -110, since: new Date(Date.parse(start) + 60e3).toISOString(), checkedAt: null, source: 's', main: true }] };
  assert.equal(closes(after, SPECS.ml, start).size, 0);
});
