import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toShotGrid, type UnderstatShot } from '../lib/sports/soccer/understatShots';

/**
 * Phase 6.9 — soccer's shot map.
 *
 * The task describes integrating "Understat's match/shot endpoints". Measured:
 * `/getPlayerData/{id}`, which this app ALREADY fetches and caches for its
 * `matches` array, returns `shots` in the same payload — 1,296 of them for
 * Salah. So it is a parse, not an integration, and it costs no extra request.
 *
 * The band boundaries are real pitch geometry: the penalty box is 16.5m deep on
 * a 105m pitch (X >= 0.843) and 40.3m wide on a 68m one (Y 0.204..0.796, thirds
 * at 0.401 and 0.599). Arbitrary thirds would put the penalty spot on a
 * boundary.
 */

/** Understat delivers every numeric field as a string. Fixtures do too, deliberately. */
function shot(X: number, Y: number, result = 'MissedShots', xG = 0.1, season = '2025'): UnderstatShot {
  return { X: String(X), Y: String(Y), result, xG: String(xG), season };
}

test('the bands follow the penalty box, not round thirds', () => {
  const grid = toShotGrid([
    shot(0.95, 0.5), // deep in the box, central
    shot(0.85, 0.5), // still inside: 0.843 is the box line
    shot(0.8, 0.5), // box edge band
    shot(0.6, 0.5), // long range
  ])!;
  assert.equal(grid.cells[0][1].shots, 2, 'X >= 0.843 is inside the box — 0.85 counts');
  assert.equal(grid.cells[1][1].shots, 1);
  assert.equal(grid.cells[2][1].shots, 1);
});

test('left, central and right split on the box width', () => {
  const grid = toShotGrid([shot(0.9, 0.3), shot(0.9, 0.5), shot(0.9, 0.7)])!;
  assert.equal(grid.cells[0][0].shots, 1, 'Y < 0.401 is left');
  assert.equal(grid.cells[0][1].shots, 1);
  assert.equal(grid.cells[0][2].shots, 1, 'Y > 0.599 is right');
});

test('shares are of all placed shots and sum to 100', () => {
  const grid = toShotGrid([shot(0.95, 0.5), shot(0.95, 0.5), shot(0.6, 0.2), shot(0.6, 0.8)])!;
  const total = grid.cells.flat().reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(total - 100) < 1e-9, `shares summed to ${total}`);
  assert.equal(grid.cells[0][1].share, 50);
  assert.equal(grid.totalShots, 4);
});

test("only Understat's 'Goal' counts as a goal", () => {
  // The other results are MissedShots, SavedShot, BlockedShot, ShotOnPost. A
  // ShotOnPost is not a goal, and a substring or truthiness check would be a
  // very quiet way to inflate a scoring record.
  const grid = toShotGrid([
    shot(0.95, 0.5, 'Goal'),
    shot(0.95, 0.5, 'ShotOnPost'),
    shot(0.95, 0.5, 'SavedShot'),
    shot(0.95, 0.5, 'BlockedShot'),
    shot(0.95, 0.5, 'MissedShots'),
  ])!;
  assert.equal(grid.totalGoals, 1);
  assert.equal(grid.cells[0][1].goals, 1);
});

test('an unusable coordinate is dropped, never defaulted to centre', () => {
  // Defaulting would pile every bad row into one cell and read as a real
  // shooting tendency.
  const grid = toShotGrid([
    shot(0.95, 0.5),
    { X: '', Y: '0.5', result: 'Goal', xG: '0.5' },
    { X: 'NaN', Y: 'NaN', result: 'Goal', xG: '0.5' },
  ])!;
  assert.equal(grid.totalShots, 1, 'two unusable shots must not become two central shots');
  assert.equal(grid.totalGoals, 0, 'and their goals must not be counted either');
});

test('no shots means no card, which is exactly the MLS state', () => {
  // American Soccer Analysis carries no shot coordinates, so every MLS player
  // reaches this. An empty 3x3 under a "Shot location" heading says less than
  // nothing at all.
  assert.equal(toShotGrid([]), null);
  assert.equal(toShotGrid([{ X: 'x', Y: 'y', result: 'Goal', xG: '1' }]), null);
});

test('mean xG is reported per cell and overall, and is null where empty', () => {
  const grid = toShotGrid([shot(0.95, 0.5, 'Goal', 0.4), shot(0.95, 0.5, 'MissedShots', 0.2), shot(0.6, 0.2, 'MissedShots', 0.02)])!;
  assert.ok(Math.abs(grid.cells[0][1].meanXg! - 0.3) < 1e-9, 'central box cell averages its own shots');
  assert.equal(grid.cells[0][0].meanXg, null, 'an empty cell has no mean, not zero');
  assert.ok(Math.abs(grid.meanXg! - 0.20666666666666667) < 1e-9);
});

test('seasons come back sorted, for the caption span', () => {
  const grid = toShotGrid([shot(0.9, 0.5, 'Goal', 0.3, '2024'), shot(0.9, 0.5, 'Goal', 0.3, '2022')])!;
  assert.deepEqual(grid.seasons, ['2022', '2024']);
});
