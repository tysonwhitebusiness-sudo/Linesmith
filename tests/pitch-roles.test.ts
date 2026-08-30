import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSpatialGridRole, toUsageMixRole } from '../lib/sports/mlb/adapters/pitchRoles';
import { ZONE_GRID, pitchTypeLabel } from '../lib/sports/mlb/pitchProfileShapes';
import type { PitchProfile } from '../lib/sports/mlb/pitchProfileShapes';

/**
 * Phase 6.6's read path, as the two roles it fills.
 *
 * These are behavioural, not source greps: every assertion runs the real
 * builder over a real-shaped profile. The numbers in the fixtures are the
 * MEASURED ratios from the 2024 data, not round invented ones, so a test that
 * passes here is a test that would have caught the actual defect.
 *
 * The two defects being guarded were both "renders cleanly, wrong number":
 *
 *  - Quoting `ballsInPlay` beside an xwOBA when only 22% of balls in play carry
 *    one (5,031 of 22,574). Fourfold sample inflation, invisible on the page.
 *  - Running the heat the same way for a pitcher and a batter. The same .367 is
 *    a good outcome for one and a bad one for the other.
 */

/** Shaped like a real pitcher season: sparse xwOBA, a dominant fastball, one zone empty. */
function pitcherProfile(): PitchProfile {
  return {
    season: 2026,
    role: 'pitcher',
    subjectId: 666200,
    totalPitches: 2000,
    zones: [
      // zone: xwoba, xwobaSample, ballsInPlay, pitches — note sample << bip.
      { zone: 1, xwoba: 0.367, xwobaSample: 11, ballsInPlay: 51, pitches: 180 },
      { zone: 2, xwoba: 0.412, xwobaSample: 18, ballsInPlay: 74, pitches: 240 },
      { zone: 3, xwoba: 0.298, xwobaSample: 9, ballsInPlay: 40, pitches: 160 },
      { zone: 4, xwoba: 0.331, xwobaSample: 14, ballsInPlay: 61, pitches: 210 },
      { zone: 5, xwoba: 0.455, xwobaSample: 22, ballsInPlay: 96, pitches: 300 },
      { zone: 6, xwoba: 0.305, xwobaSample: 12, ballsInPlay: 55, pitches: 190 },
      { zone: 7, xwoba: 0.276, xwobaSample: 8, ballsInPlay: 36, pitches: 150 },
      { zone: 8, xwoba: 0.318, xwobaSample: 15, ballsInPlay: 66, pitches: 220 },
      // Zone 9 genuinely produced nothing measurable.
      { zone: 9, xwoba: null, xwobaSample: 0, ballsInPlay: 3, pitches: 90 },
      // Savant's OUTSIDE quadrant — must never appear in the 3x3.
      { zone: 13, xwoba: 0.201, xwobaSample: 30, ballsInPlay: 120, pitches: 260 },
    ],
    pitchTypes: [
      { pitchType: 'FF', pitches: 880, share: 44, xwoba: 0.352, xwobaSample: 41, ballsInPlay: 186, avgVelocity: 95.4 },
      { pitchType: 'SL', pitches: 620, share: 31, xwoba: 0.289, xwobaSample: 27, ballsInPlay: 121, avgVelocity: 86.1 },
      { pitchType: 'CH', pitches: 500, share: 25, xwoba: null, xwobaSample: 0, ballsInPlay: 4, avgVelocity: 88.7 },
    ],
  };
}

test('usageMix quotes the xwOBA sample, never the balls in play', () => {
  const role = toUsageMixRole(pitcherProfile());
  assert.ok(role);
  const ff = role.slices.find((s) => s.key === 'FF');
  assert.ok(ff);
  // THE DEFECT: `ballsInPlay` is 186 and the real n is 41. Showing 186 beside
  // a .352 overstates the sample more than fourfold and looks entirely normal.
  assert.equal(ff.valueSample, 41, 'usageMix must carry `xwobaSample`, not `ballsInPlay` or `pitches`');
  assert.notEqual(ff.valueSample, 186, 'usageMix is quoting `ballsInPlay` — the 22% trap');
  assert.notEqual(ff.valueSample, 880, 'usageMix is quoting the pitch count');
});

test('usageMix leaves a slice with no measured outcome undefined, not zero', () => {
  const role = toUsageMixRole(pitcherProfile());
  const ch = role!.slices.find((s) => s.key === 'CH');
  // A changeup with four balls in play and no expected wOBA has no outcome.
  // Rendering it as 0 would claim the best result in baseball.
  assert.equal(ch!.value, undefined, 'a null xwOBA must stay absent — .000 reads as an extraordinary result');
  assert.equal(ch!.valueSample, 0);
});

test('usageMix labels pitch codes and reports the real total', () => {
  const role = toUsageMixRole(pitcherProfile())!;
  assert.equal(role.slices.find((s) => s.key === 'FF')!.label, 'Four-seam');
  assert.equal(role.sampleSize, 2000, 'sampleSize is the total pitches behind the mix');
  assert.equal(role.slices.reduce((s, x) => s + x.share, 0), 100, 'shares must already sum — the component does not renormalise');
});

test('usageMix titles the two sides differently — chosen vs shown', () => {
  const p = toUsageMixRole(pitcherProfile())!;
  const b = toUsageMixRole({ ...pitcherProfile(), role: 'batter' })!;
  assert.equal(p.title, 'Pitch mix');
  assert.equal(b.title, 'Pitch mix seen');
});

test('usageMix is null rather than an empty card when there is nothing', () => {
  assert.equal(toUsageMixRole(null), null);
  assert.equal(toUsageMixRole({ ...pitcherProfile(), pitchTypes: [] }), null);
});

test('spatialGrid renders the 3x3 and excludes Savant zones 11-14', () => {
  const role = toSpatialGridRole(pitcherProfile());
  assert.ok(role);
  assert.equal(role.cells.length, 3, 'the strike zone is three rows');
  for (const row of role.cells) assert.equal(row.length, 3, 'every row is three cells');

  const keys = role.cells.flat().map((c) => c.key);
  assert.deepEqual(keys, ZONE_GRID.flat().map(String), 'the grid must follow ZONE_GRID, row-major');
  // Zone 13 is an OUTSIDE quadrant. Folding it into an edge cell would put real
  // pitches in the wrong place, and its .201 would drag that cell down.
  assert.ok(!keys.includes('13'), 'an outside quadrant leaked into the 3x3');
});

test('spatialGrid carries each cell its own xwOBA sample, and null where there is none', () => {
  const role = toSpatialGridRole(pitcherProfile())!;
  const cells = role.cells.flat();
  assert.equal(cells.find((c) => c.key === '1')!.sampleSize, 11);
  assert.equal(cells.find((c) => c.key === '1')!.value, 0.367);
  const empty = cells.find((c) => c.key === '9')!;
  assert.equal(empty.value, null, 'a zone with no measurable outcome is null, not 0');
  assert.equal(empty.sampleSize, 0);
});

test('the caption counts only the nine cells actually drawn', () => {
  const role = toSpatialGridRole(pitcherProfile())!;
  // 11+18+9+14+22+12+8+15+0 = 109 across zones 1-9. Zone 13's 30 rows are NOT
  // included: they are an outside quadrant and no cell on this card shows them.
  assert.match(role.caption, /n=109/, 'the caption must count the drawn cells, not every zone in the profile');
  assert.doesNotMatch(role.caption, /n=139/, 'the caption is counting the outside quadrants it does not draw');
  assert.match(role.caption, /catcher view/, 'without this the grid is mirrored from what a reader assumes');
  assert.match(role.caption, /balls in play/, 'the numbers are not over every pitch and must not look like they are');
});

test('a profile whose only outcomes are OUTSIDE the zone renders no card at all', () => {
  // THE DEFECT THIS PINS, found by opening the page and not by any test:
  // Jackson Merrill's real 2026 profile had all three of its expected-wOBA rows
  // in Savant's zones 11-14. The 3x3 correctly excluded them, so the card drew
  // nine cells reading "no data" — under a caption that said "n=3". Every
  // number was individually defensible and the card as a whole was false.
  const outsideOnly: PitchProfile = {
    ...pitcherProfile(),
    zones: [
      { zone: 1, xwoba: null, xwobaSample: 0, ballsInPlay: 0, pitches: 3 },
      { zone: 5, xwoba: null, xwobaSample: 0, ballsInPlay: 0, pitches: 4 },
      { zone: 13, xwoba: 0.21, xwobaSample: 2, ballsInPlay: 2, pitches: 12 },
      { zone: 14, xwoba: 0.119, xwobaSample: 1, ballsInPlay: 1, pitches: 17 },
    ],
  };
  assert.equal(
    toSpatialGridRole(outsideOnly),
    null,
    'nine empty cells under a caption quoting the outside quadrants is worse than no card',
  );
});

test('spatialGrid requires the three fields the "4.800" bug was made of', () => {
  const role = toSpatialGridRole(pitcherProfile())!;
  assert.equal(role.unit, 'xwOBA');
  assert.ok(role.caption.length > 0);
  // Baseball rate convention — .367, not 0.367. A generic two-decimal format is
  // what rendered NFL's 14.8 as "4.800" on the board.
  assert.equal(role.format(0.367), '.367');
});

test('the heat flips with the SUBJECT, not the sport', () => {
  // The single assertion that cannot be moved into the component: the component
  // does not know what a strike zone is, and .455 in zone 5 is a disaster for
  // the pitcher who allowed it and a triumph for the batter who produced it.
  assert.equal(toSpatialGridRole(pitcherProfile())!.lowerIsBetter, true, 'a pitcher wants LOW xwOBA allowed');
  assert.equal(
    toSpatialGridRole({ ...pitcherProfile(), role: 'batter' })!.lowerIsBetter,
    false,
    'a batter wants HIGH xwOBA — running the heat one way for both is the defect',
  );
});

test('spatialGrid is null when nothing in the grid carries an xwOBA', () => {
  assert.equal(toSpatialGridRole(null), null);
  const blank = {
    ...pitcherProfile(),
    zones: pitcherProfile().zones.map((z) => ({ ...z, xwoba: null, xwobaSample: 0 })),
  };
  assert.equal(toSpatialGridRole(blank), null, 'nine empty cells under a heading say less than no card');
});

test('pitchTypeLabel falls through to the raw code rather than dropping it', () => {
  assert.equal(pitchTypeLabel('FF'), 'Four-seam');
  // Savant adds codes. An unknown one showing as "XX" is information; showing
  // as blank or being filtered out silently loses a real slice of the mix.
  assert.equal(pitchTypeLabel('XX'), 'XX');
});

test('the mix and the grid print the same statistic the same way', () => {
  // One page, one number. The grid printed `.717` and the mix printed `0.796`
  // until the role carried its own formatter — the same defect family as the
  // "4.800" bug, where a component-side default outvoted the sport.
  const mix = toUsageMixRole(pitcherProfile())!;
  const grid = toSpatialGridRole(pitcherProfile())!;
  assert.ok(mix.valueFormat, 'usageMix must carry a formatter, not lean on a toFixed default');
  assert.equal(mix.valueFormat!(0.796), '.796', 'baseball rate convention: .796, not 0.796');
  assert.equal(mix.valueFormat!(0.796), grid.format(0.796), 'the two cards must agree');
});
