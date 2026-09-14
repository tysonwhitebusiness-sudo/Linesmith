import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBeyondArc, shotDistance, shotValue, toNbaShotProfile } from '../lib/sports/nba/shotProfileShapes';

/**
 * Phase 6.7 — NBA's shot chart.
 *
 * THE GEOMETRY WAS MEASURED, NOT ASSUMED. On one real game's 195 attempts,
 * three-pointers averaged 26.6 feet from (25, 0) and two-pointers 12.9, against
 * a real three-point line of 22 feet in the corners and 23.75 at the top. An
 * origin or scale that was wrong would not produce those two numbers.
 */

const shot = (x: number | null, y: number | null, made = false, pointValue = 2) => ({
  xCoord: x,
  yCoord: y,
  made,
  pointValue,
});

test('the basket is at (25, 1) and the units are feet', () => {
  // R2: fitted in G2, 99.8% of makes classify to their stored value with this origin.
  assert.equal(shotDistance(25, 1), 0, 'a shot at the rim is zero feet from it');
  assert.equal(shotDistance(25, 11), 10);
  assert.ok(Math.abs(shotDistance(3, 1) - 22) < 1e-9, 'a corner three is 22 feet along the baseline');
});

test("a miss's value comes from the arc, because every miss is stored as 2", () => {
  assert.equal(shotValue({ xCoord: 25, yCoord: 26, made: false, pointValue: 2 }), 3, 'a missed three at the top');
  assert.equal(shotValue({ xCoord: 3, yCoord: 2, made: false, pointValue: 2 }), 3, 'a missed corner three');
  assert.equal(shotValue({ xCoord: 25, yCoord: 15, made: false, pointValue: 2 }), 2);
  assert.equal(shotValue({ xCoord: 25, yCoord: 24.5, made: true, pointValue: 2 }), 2, 'a make keeps its stored value');
});

test('an above-the-break long two is a two, not a three', () => {
  // 22.5 feet out at the top: inside the 23.25 arc. The old band was ">22 feet".
  assert.equal(isBeyondArc(25, 23.5), false);
  const profile = toNbaShotProfile([shot(25, 23.5)])!;
  assert.equal(profile.cells[3][0].attempts, 0);
  assert.equal(profile.cells[2][0].attempts, 1);
});

test('bands are anchored on real basketball distances', () => {
  const profile = toNbaShotProfile([
    shot(25, 2), // 2ft  -> at the rim
    shot(25, 10), // 10ft -> paint
    shot(25, 18), // 18ft -> mid-range
    shot(25, 25), // 25ft -> three
  ])!;
  assert.deepEqual(profile.rowLabels, ['At the rim', 'Paint', 'Mid-range', 'Three-point']);
  assert.deepEqual(profile.cells.map((r) => r[0].attempts), [1, 1, 1, 1]);
});

test('an unlocated attempt is counted but never placed at the rim', () => {
  // ESPN's missing-coordinate sentinel is rejected at ingest, so these arrive
  // NULL. Defaulting them to (25,0) would credit a player with rim attempts
  // they never took — and the rim band is the one that most changes a read.
  const profile = toNbaShotProfile([shot(25, 2, true), shot(null, null), shot(null, null)])!;
  assert.equal(profile.totalAttempts, 1, 'only placed attempts are in the bands');
  assert.equal(profile.unlocated, 2, 'but the real attempts are still reported');
  assert.equal(profile.cells[0][0].attempts, 1, 'the rim band must not absorb them');
  assert.equal(profile.cells[0][0].share, 100);
});

test('field-goal percentage is per band and null where empty', () => {
  const profile = toNbaShotProfile([shot(25, 2, true), shot(25, 2, false), shot(25, 26, true, 3)])!;
  assert.equal(profile.cells[0][0].fgPct, 50);
  assert.equal(profile.cells[1][0].fgPct, null, 'an empty band has no percentage, not zero');
  assert.equal(profile.cells[3][0].fgPct, 100);
  assert.equal(profile.totalMade, 2);
});

test('shares are of placed attempts and sum to 100', () => {
  const profile = toNbaShotProfile([shot(25, 2), shot(25, 25), shot(null, null)])!;
  assert.ok(Math.abs(profile.cells.flat().reduce((s, c) => s + c.share, 0) - 100) < 1e-9);
});

test('nothing placeable means no card', () => {
  assert.equal(toNbaShotProfile([]), null);
  assert.equal(toNbaShotProfile([shot(null, null)]), null, 'unlocated attempts alone cannot draw a chart');
});
