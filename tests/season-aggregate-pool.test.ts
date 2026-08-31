import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankPool, type EntitySums } from '../lib/sports/shared/seasonAggregateShapes';
import type { SeasonAggregateSpec } from '../lib/sports/shared/seasonAggregateShapes';
import { SEASON_AGGREGATE_SPECS, CFB_SEASON_SPEC, SOCCER_EPL_SEASON_SPEC } from '../lib/sports/shared/seasonAggregateSpecs';

/**
 * The pool-ranking half of the season rollup — Phase 6.15.
 *
 * WHAT THESE GUARD, AND WHY EACH ONE EXISTS. The no-variance case is not
 * hypothetical: `shotsFaced` shipped in the soccer spec and is 0.0 on all
 * 11,492 EPL rows, which ranked all twenty teams JOINT-FIRST at 0.0 rather
 * than rendering nothing. `SUM` of a missing key is 0, not an error, so
 * nothing upstream throws — the only place this can be caught is here.
 */

const SPEC: SeasonAggregateSpec = {
  sport: 'test',
  groupBy: 'team_id',
  minGames: 1,
  stats: [
    { key: 'good', label: 'Good', statKey: 'good', decimals: 1, perGame: true, group: 'A' },
    { key: 'dead', label: 'Dead', statKey: 'dead', decimals: 1, perGame: true, lowerIsBetter: true, group: 'A' },
  ],
  units: [{ key: 'a', label: 'A', short: 'A', statKeys: ['good', 'dead'] }],
};

/** Three teams: `good` varies, `dead` is 0 for everyone — the real failure. */
const ENTITIES: EntitySums[] = [
  { entityId: 't1', games: 10, sums: [100, 0] },
  { entityId: 't2', games: 10, sums: [80, 0] },
  { entityId: 't3', games: 10, sums: [60, 0] },
];

test('a stat with no variance across the pool is dropped, not ranked', () => {
  const out = rankPool(SPEC, ENTITIES);
  for (const id of ['t1', 't2', 't3']) {
    const keys = out[id].stats.map((s) => s.key);
    assert.ok(keys.includes('good'), `${id} should keep the varying stat`);
    assert.ok(
      !keys.includes('dead'),
      `${id} ranked an all-zero stat — this is the shotsFaced defect, where every team read "1st"`,
    );
  }
});

test('a varying stat still ranks 1..n, best first, and honours lowerIsBetter', () => {
  const out = rankPool(SPEC, ENTITIES);
  const rankOf = (id: string) => out[id].stats.find((s) => s.key === 'good')!.rank;
  assert.equal(rankOf('t1'), 1);
  assert.equal(rankOf('t3'), 3);

  const lower = rankPool(
    { ...SPEC, stats: [{ ...SPEC.stats[0], lowerIsBetter: true }], units: [] },
    ENTITIES,
  );
  assert.equal(lower['t3'].stats[0].rank, 1, 'lowerIsBetter should make the smallest value best');
});

test('poolSize on every row is the number of entities ranked', () => {
  const out = rankPool(SPEC, ENTITIES);
  for (const id of ['t1', 't2', 't3']) {
    for (const s of out[id].stats) assert.equal(s.poolSize, 3);
  }
});

test('a unit whose every stat was dropped produces no grade rather than a blank one', () => {
  const deadOnly: SeasonAggregateSpec = {
    ...SPEC,
    stats: [SPEC.stats[1]],
    units: [{ key: 'a', label: 'A', short: 'A', statKeys: ['dead'] }],
  };
  const out = rankPool(deadOnly, ENTITIES.map((e) => ({ ...e, sums: [0] })));
  assert.deepEqual(out['t1'].stats, []);
  assert.deepEqual(out['t1'].units, [], 'a unit built from nothing must not be graded');
});

/**
 * Every stat key is interpolated into SQL by `computeSeasonAggregates`, so the
 * shape of a key is a safety property, not a style one. CFB's are dotted
 * (`passing.passingYards`); nothing may carry a quote, backslash or space.
 */
test('every registered spec declares SQL-safe stat keys', () => {
  for (const [sport, spec] of Object.entries(SEASON_AGGREGATE_SPECS)) {
    for (const s of spec.stats) {
      assert.match(s.statKey, /^[A-Za-z_][A-Za-z0-9_.]*$/, `${sport}.${s.key} has an unsafe statKey`);
    }
  }
});

/** A unit that names a stat the spec does not declare grades on fewer inputs than intended, silently. */
test('every unit references stat keys its own spec declares', () => {
  for (const [sport, spec] of Object.entries(SEASON_AGGREGATE_SPECS)) {
    const declared = new Set(spec.stats.map((s) => s.key));
    for (const u of spec.units) {
      for (const k of u.statKeys) {
        assert.ok(declared.has(k), `${sport} unit "${u.key}" references undeclared stat "${k}"`);
      }
    }
  }
});

/** The two specs added in 6.15, pinned against the keys measured in the live table. */
test('the CFB spec separates the quarterback’s interceptions from the defence’s', () => {
  const thrown = CFB_SEASON_SPEC.stats.find((s) => s.key === 'intsThrown')!;
  const caught = CFB_SEASON_SPEC.stats.find((s) => s.key === 'defInterceptions')!;
  assert.equal(thrown.statKey, 'passing.interceptions');
  assert.equal(caught.statKey, 'interceptions.interceptions');
  assert.equal(thrown.lowerIsBetter, true, 'a thrown interception is bad');
  assert.notEqual(caught.lowerIsBetter, true, 'a defensive interception is good');
});

test('soccer takes goals conceded as a per-game max, never a sum', () => {
  const conceded = SOCCER_EPL_SEASON_SPEC.stats.find((s) => s.key === 'goalsConceded')!;
  assert.equal(conceded.perGameMax, true, 'summing it multiplies conceded by the size of the lineup');
  assert.equal(conceded.lowerIsBetter, true);
  assert.ok(
    !SOCCER_EPL_SEASON_SPEC.stats.some((s) => s.statKey === 'shotsFaced'),
    'shotsFaced is 0.0 on every EPL row and was removed',
  );
});
