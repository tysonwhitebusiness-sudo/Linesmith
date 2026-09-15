import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toUsageMixRole } from '../lib/sports/mlb/adapters/pitchRoles';
import { pitchTypeLabel } from '../lib/sports/mlb/pitchProfileShapes';
import { fmt } from '../components/charts/tokens';
import type { PitchProfile } from '../lib/sports/mlb/pitchProfileShapes';

/**
 * Phase 6.6's read path, as the pitch-mix role (the zone grid and platoon split
 * it also filled moved to the player page's Statcast sections in R6.1b-c).
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
    platoon: [],
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

test('pitchTypeLabel falls through to the raw code rather than dropping it', () => {
  assert.equal(pitchTypeLabel('FF'), 'Four-seam');
  // Savant adds codes. An unknown one showing as "XX" is information; showing
  // as blank or being filtered out silently loses a real slice of the mix.
  assert.equal(pitchTypeLabel('XX'), 'XX');
});

test('the mix prints xwOBA the way the zone map does', () => {
  // One page, one number. The grid printed `.717` and the mix printed `0.796`
  // until the role carried its own formatter — the same defect family as the
  // "4.800" bug, where a component-side default outvoted the sport. Since
  // R6.1b-c the zone map is the Statcast section's, formatted with `fmt.rate3`.
  const mix = toUsageMixRole(pitcherProfile())!;
  assert.ok(mix.valueFormat, 'usageMix must carry a formatter, not lean on a toFixed default');
  assert.equal(mix.valueFormat!(0.796), '.796', 'baseball rate convention: .796, not 0.796');
  assert.equal(mix.valueFormat!(0.796), fmt.rate3(0.796), 'the mix and the zone map must agree');
});
