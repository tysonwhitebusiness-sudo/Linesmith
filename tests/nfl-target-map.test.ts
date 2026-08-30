import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TARGET_MAP_POSITIONS, toNflTargetMap, type NflTargetRow } from '../lib/sports/nfl/targetMapShapes';
import { MARKETS_BY_POSITION } from '../lib/sports/nfl/adapter';
import { toPlayerDetailData } from '../lib/sports/nfl/adapters/playerDetailAdapter';
import type { PickCandidate } from '../lib/core/types';

/**
 * Phase 6.8 — NFL's target map, the grid AND the wiring that puts it on the page.
 *
 * THE GRID IS THE SOURCE'S OWN SPLIT. `pass_length` (short/deep) and
 * `pass_location` (left/middle/right) come straight from nflverse; nothing here
 * picks a threshold. Measured over the 2025 season's 17,582 target events, the
 * deep bands averaged 24+ air yards and the short bands 3-6, which is why the
 * split is two different plays rather than one continuum cut in half.
 *
 * WHAT THE ADAPTER HALF IS FOR. `toNflTargetMap` was shipped and verified
 * through HTTP a session before anything rendered it. Testing only the pure
 * function would have passed for that entire stretch while the page showed
 * nothing — so the second half of this file exercises the adapter, which is
 * where the role is actually filled.
 */

const row = (
  passLength: string | null,
  passLocation: string | null,
  airYards: number | null = 8,
  complete = true,
): NflTargetRow => ({ passLength, passLocation, airYards, complete });

test('rows are deep-first so the grid reads like the field from the quarterback', () => {
  const map = toNflTargetMap([row('deep', 'left'), row('short', 'left')])!;
  assert.deepEqual(map.rowLabels, ['Deep', 'Short']);
  assert.deepEqual(map.columnLabels, ['Left', 'Middle', 'Right']);
  assert.equal(map.cells[0][0].targets, 1, 'row 0 is DEEP');
  assert.equal(map.cells[1][0].targets, 1, 'row 1 is SHORT');
});

test('an unlocatable target is counted but never placed in the busiest cell', () => {
  // Defaulting to short-middle would make every receiver look more of a
  // possession target than they are — the same defect shape as NBA's
  // unlocated attempt landing at the rim.
  const map = toNflTargetMap([
    row('short', 'right'),
    row(null, 'right'),
    row('short', null),
  ])!;
  assert.equal(map.unplaced, 2);
  assert.equal(map.totalTargets, 1, 'totalTargets is the PLACED count');
  assert.equal(map.cells[1][1].targets, 0, 'short-middle must not absorb them');
  assert.equal(
    map.cells.flat().reduce((s, c) => s + c.targets, 0),
    map.totalTargets,
    'the grid and its own total must agree',
  );
});

test('shares are of placed targets and sum to 100', () => {
  const map = toNflTargetMap([row('deep', 'left'), row('short', 'right'), row(null, null)])!;
  assert.ok(Math.abs(map.cells.flat().reduce((s, c) => s + c.share, 0) - 100) < 1e-9);
  assert.equal(map.cells[0][0].share, 50);
});

test('catch rate is per cell and null where the cell is empty, not zero', () => {
  const map = toNflTargetMap([
    row('short', 'left', 5, true),
    row('short', 'left', 5, false),
    row('deep', 'right', 30, true),
  ])!;
  assert.equal(map.cells[1][0].catchPct, 50);
  assert.equal(map.cells[0][0].catchPct, null, 'an untargeted cell has no catch rate');
  assert.equal(map.cells[0][2].catchPct, 100);
  assert.equal(map.totalCompletions, 2);
});

test('a screen is a real target and its negative air yards are not clamped', () => {
  // 3,192 of one season's targets carried negative air yards. A clamp at zero
  // would drag every check-down receiver's average depth upwards.
  const map = toNflTargetMap([row('short', 'left', -4), row('short', 'left', 10)])!;
  assert.equal(map.meanAirYards, 3, '(-4 + 10) / 2');
  assert.equal(map.cells[1][0].targets, 2, 'a screen belongs in SHORT, not off the grid');
});

test('mean air yards spans targets the grid could not place', () => {
  // The two denominators genuinely differ: an unlocated target still has a
  // depth. This is why the caption says "located targets" rather than
  // "targets" — measured on a real receiver, 170 rows, 169 located.
  const map = toNflTargetMap([row('short', 'left', 10), row(null, null, 20)])!;
  assert.equal(map.totalTargets, 1);
  assert.equal(map.meanAirYards, 15, 'the unplaced target still carries its air yards');
});

test('a target with no air-yard reading does not count as zero air yards', () => {
  // `Number('')` is 0 and finite — the sentinel-shaped bug that put soccer
  // shots on the goal line. A null must not drag the mean toward zero.
  const map = toNflTargetMap([row('short', 'left', 12), row('short', 'left', null)])!;
  assert.equal(map.meanAirYards, 12);
});

test('nothing placeable yields null, not an empty grid under a heading', () => {
  assert.equal(toNflTargetMap([]), null);
  assert.equal(toNflTargetMap([row(null, null), row('sideways', 'up')]), null);
});

// ---------------------------------------------------------------------------
// The adapter half — the wiring 6.8 was missing.
// ---------------------------------------------------------------------------

function candidate(position: string): PickCandidate {
  return {
    sport: 'nfl',
    subjectId: 'espn:football:4426515',
    subjectName: 'Test Receiver',
    subjectMeta: { team: 'LAR', position, opponent: 'SF', gsisId: '00-0039075' },
    dimension: 'receiving-yards',
    dimensionLabel: 'Receiving Yards',
    category: 'over',
    categoryLabel: 'Over',
    line: 60.5,
    history: [
      { period: 1, result: '70', category: 'over', periodLabel: 'W1 vs SF', raw: { opponentAbbr: 'SF', season: '2025', week: '1' } },
    ],
    consistent: true,
    sampleSize: 1,
  } as unknown as PickCandidate;
}

const SCOPE = { lineOffset: 0, opponentOnly: false, lastN: 'all' as const, showAllGames: true, kpiScope: 'season' as const };

test('the adapter fills spatialGrid from the hook result', () => {
  const map = toNflTargetMap([
    row('short', 'left', 5),
    row('short', 'left', 5),
    row('deep', 'right', 30),
    row(null, null, 12),
  ])!;
  const data = toPlayerDetailData({
    candidates: [candidate('WR')],
    market: 'receiving-yards',
    snapshot: null,
    scope: SCOPE,
    targetMap: { map, loading: false },
  })!;
  const grid = data.spatialGrid!;
  assert.equal(grid.title, 'Target map');
  assert.equal(grid.unit, 'of targets');
  assert.deepEqual(grid.rowLabels, ['Deep', 'Short']);

  // Value is the SHARE; sampleSize is the count behind it. An empty cell is
  // null, not 0 — a 0 would be painted as a real "cold" reading rather than
  // an absence.
  assert.equal(grid.cells[1][0].value, (2 / 3) * 100);
  assert.equal(grid.cells[1][0].sampleSize, 2);
  assert.equal(grid.cells[0][0].value, null);
  assert.equal(grid.cells[0][0].sampleSize, 0);

  // The caption must name what the grid EXCLUDED. A caption whose total
  // exceeded the cells it drew is a defect this phase already shipped once.
  assert.match(grid.caption, /^3 located targets/);
  assert.match(grid.caption, /1 unplaced/);
  const drawn = grid.cells.flat().reduce((s, c) => s + (c.sampleSize ?? 0), 0);
  assert.equal(drawn, 3, 'the caption total is the number of targets actually drawn');
});


test('the caption drops the unplaced clause when there is nothing to disclose', () => {
  const map = toNflTargetMap([row('short', 'left', 5)])!;
  const data = toPlayerDetailData({
    candidates: [candidate('WR')],
    market: 'receiving-yards',
    snapshot: null,
    scope: SCOPE,
    targetMap: { map, loading: false },
  })!;
  assert.doesNotMatch(data.spatialGrid!.caption, /unplaced/);
});

test('no target map, no card -- the role is null rather than an empty grid', () => {
  for (const state of [undefined, { map: null, loading: true }, { map: null, loading: false }]) {
    const data = toPlayerDetailData({
      candidates: [candidate('WR')],
      market: 'receiving-yards',
      snapshot: null,
      scope: SCOPE,
      targetMap: state,
    })!;
    assert.equal(data.spatialGrid, null);
  }
});

test('the grid formats as whole percentages, not MLB rate convention', () => {
  // `zoneGrid` hardcoding MLB's `.717` convention is what rendered NFL's 14.8
  // as "4.800". `format` is required on the role for exactly this reason.
  const map = toNflTargetMap([row('short', 'left', 5), row('deep', 'right', 30)])!;
  const data = toPlayerDetailData({
    candidates: [candidate('WR')],
    market: 'receiving-yards',
    snapshot: null,
    scope: SCOPE,
    targetMap: { map, loading: false },
  })!;
  assert.equal(data.spatialGrid!.format(50), '50%');
});

test('the position gate agrees with who actually gets receiving markets', () => {
  // NOT a restatement of the gate. `MARKETS_BY_POSITION` is maintained
  // independently, in the server adapter, and is the reason a position appears
  // on the slate at all. If the two ever disagree — a receiving market added to
  // QB, or a position dropped from the gate — one of them is wrong, and this is
  // the only place that would notice.
  const receiving = Object.entries(MARKETS_BY_POSITION)
    .filter(([, markets]) => markets.some((m) => m.startsWith('receiving-') || m === 'receptions'))
    .map(([position]) => position)
    .sort();
  assert.deepEqual([...TARGET_MAP_POSITIONS].sort(), receiving);
  assert.ok(!receiving.includes('QB'), 'a quarterback must never get a target map');
});
