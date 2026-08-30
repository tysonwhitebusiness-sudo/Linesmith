import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseShot, toNhlShotProfile } from '../lib/sports/nhl/shotProfileShapes';

/**
 * Phase 6.7 — NHL's shot map, and the coordinate trap at the centre of it.
 *
 * `x_coord` runs -100..100 with goals at +/-89, and its SIGN DEPENDS ON WHICH
 * END the shooting team is attacking. Both teams shoot every period toward
 * opposite ends, so a raw average lands near centre ice and a season's shot map
 * folds into a symmetric blur.
 *
 * Measured on a real ingested game: mean `x` by period ran -12, -10, +16, -3,
 * -32 — all meaningless — while mean `|x|` held steady at 53-70 and
 * offensive-zone shots averaged |x| = 59, about thirty feet out. The absolute
 * value is the signal.
 */

test('normalisation is a 180-degree rotation, not a left-right mirror', () => {
  // Switching ends mirrors BOTH axes. Negating only x would move a right-wing
  // shot to the left wing — a wrong map that still looks like a map.
  assert.deepEqual(normaliseShot(-73, 11), { x: 73, y: -11 });
  // A shot already at the positive end is untouched.
  assert.deepEqual(normaliseShot(73, 11), { x: 73, y: 11 });
});

test('a shot with no location is dropped, not placed at centre ice', () => {
  assert.equal(normaliseShot(null, 5), null);
  assert.equal(normaliseShot(62, null), null);
  assert.equal(normaliseShot(Number.NaN, 5), null);
});

test('both ends fold onto one attacking end', () => {
  // THE DEFECT THIS PINS: the same shot taken at each end must land in the same
  // cell. Without the fold they land in cells three columns apart and the map
  // reports a player shooting evenly from everywhere.
  const profile = toNhlShotProfile([
    { eventType: 'shot-on-goal', xCoord: 75, yCoord: -20 },
    { eventType: 'shot-on-goal', xCoord: -75, yCoord: 20 },
  ])!;
  const occupied = profile.cells.flat().filter((c) => c.shots > 0);
  assert.equal(occupied.length, 1, 'both shots belong in one cell');
  assert.equal(occupied[0].shots, 2);
});

test('distance bands are measured from the goal line, not from centre ice', () => {
  // The goal line is at |x| = 89. A shot at x=80 is nine feet out — the slot.
  // Measuring from centre would call it a point shot, which is the opposite.
  const profile = toNhlShotProfile([
    { eventType: 'shot-on-goal', xCoord: 80, yCoord: 0 }, // 9ft  -> slot
    { eventType: 'shot-on-goal', xCoord: 55, yCoord: 0 }, // 34ft -> high slot
    { eventType: 'shot-on-goal', xCoord: 20, yCoord: 0 }, // 69ft -> point
  ])!;
  assert.equal(profile.cells[0][1].shots, 1);
  assert.equal(profile.cells[1][1].shots, 1);
  assert.equal(profile.cells[2][1].shots, 1);
});

test('a goal counts as a shot on goal, because that is what shooting percentage means', () => {
  // Counting them separately would understate the on-goal rate by exactly the
  // number of goals — the one error nobody would question on sight.
  const profile = toNhlShotProfile([
    { eventType: 'goal', xCoord: 80, yCoord: 0 },
    { eventType: 'shot-on-goal', xCoord: 80, yCoord: 0 },
    { eventType: 'missed-shot', xCoord: 80, yCoord: 0 },
    { eventType: 'blocked-shot', xCoord: 80, yCoord: 0 },
  ])!;
  assert.equal(profile.totalShots, 4, 'blocked and missed are attempts too');
  assert.equal(profile.totalGoals, 1);
  assert.equal(profile.onGoal, 2, 'the goal and the save — not just the save');
});

test('shares are of all placed shots and sum to 100', () => {
  const profile = toNhlShotProfile([
    { eventType: 'shot-on-goal', xCoord: 80, yCoord: 0 },
    { eventType: 'shot-on-goal', xCoord: 20, yCoord: 30 },
  ])!;
  assert.ok(Math.abs(profile.cells.flat().reduce((s, c) => s + c.share, 0) - 100) < 1e-9);
});

test('nothing placeable means no card', () => {
  assert.equal(toNhlShotProfile([]), null);
  assert.equal(toNhlShotProfile([{ eventType: 'shot-on-goal', xCoord: null, yCoord: null }]), null);
});
