import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotDistance, toNbaShotProfile } from '../lib/sports/nba/shotProfileShapes';

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

test('the basket is at (25, 0) and the units are feet', () => {
  assert.equal(shotDistance(25, 0), 0, 'a shot at the rim is zero feet from it');
  assert.equal(shotDistance(25, 10), 10);
  // A corner three: 22 feet from the basket along the baseline.
  assert.ok(Math.abs(shotDistance(3, 0) - 22) < 1e-9);
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
  const profile = toNbaShotProfile([shot(25, 2, true), shot(25, 2, false), shot(25, 25, true)])!;
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
