/**
 * MLB's `usageMix` and `spatialGrid` — Phase 6.6's read path turned into two of
 * the six universal roles.
 *
 * Pure functions rather than inline blocks in `playerDetailAdapter.ts` for one
 * reason: **both encode a measured data trap that renders as a plausible number
 * when you get it wrong**, and a trap you cannot call directly is a trap you
 * cannot test. `tests/pitch-roles.test.ts` runs these against real-shaped
 * profiles and fails by name on each trap.
 *
 * The traps, both measured on 2024 data rather than inferred from field names:
 *
 * 1. **Only 22% of balls in play carry an `estimated_woba`** (5,031 of 22,574)
 *    — it needs exit velocity and launch angle, and those are not tracked on
 *    every batted ball. So every n shown beside an xwOBA is `xwobaSample`,
 *    never `ballsInPlay` and never `pitches`. Quoting the wrong one overstates
 *    the sample severalfold and reads as solid.
 *
 * 2. **`estimated_woba` is not null on pitches that were not put in play** —
 *    332 of 3,619 carried one and 218 of those were 0.0. That filter lives in
 *    `pitchProfile.ts`'s SQL (`description = 'hit_into_play'`), so these
 *    functions inherit it; the reason is repeated here because the number that
 *    arrives already looks fine either way.
 *
 * VALUE IMPORTS ONLY FROM `pitchProfileShapes`, never `pitchProfile` — the
 * latter value-imports `pgAll`, and this file is reached by a `'use client'`
 * component. That path bundled `pg` for the browser twice in Phase 6 and broke
 * every page; `tests/client-bundle-boundary.test.ts` enforces it now.
 */

import { fmt } from '@/components/charts/tokens';
import type { RoleStat, UsageMixRole } from '@/lib/sports/shared/playerRoles';
import { pitchTypeLabel } from '@/lib/sports/mlb/pitchProfileShapes';
import type { PitchProfile } from '@/lib/sports/mlb/pitchProfileShapes';

/**
 * The pitch mix, with each slice's outcome and that outcome's own sample.
 *
 * `null` when there is no profile or no pitch types — which is the correct
 * state for a subject with nothing on record, and renders nothing at all rather
 * than an empty card claiming a mix exists.
 *
 * The title reads differently for the two sides because they are different
 * facts: a pitcher's mix is what they CHOSE to throw, a batter's is what they
 * were SHOWN. Same shape, same component, and the component never learns which.
 */
/**
 * The opposing starter's card, DERIVED FROM PITCH EVENTS, for a starter the
 * ranked season rollup has nothing on.
 *
 * ============ TWO CARDS, TWO SOURCES, ONE CONTRADICTION ============
 *
 * `opponentUnit` reads `subjectMeta.opposingStarterStats`, which comes from
 * `starterStatCard` and returns UNDEFINED below `MIN_STARTS_FOR_PITCHER_RANK`
 * (three starts) or without a computed rank. That is a reasonable floor for a
 * RANKED stat -- a percentile off two starts is noise wearing a rank.
 *
 * But the pitch-mix card beside it reads `mlb_pitch_events` directly, and for
 * the same pitcher on the same page it was happily showing 498 real pitches
 * broken down by type. So the page said "No Statcast profile for this starter
 * yet" two cards above a full Statcast breakdown of that starter. Both
 * statements were true of their own source and the pair was nonsense to read.
 *
 * This fills the card from the profile the page has ALREADY FETCHED for the
 * mix -- no new query -- and carries NO RANK, because there genuinely is not
 * one. `OpponentUnitSection` already hides the rank column when nothing in the
 * table is ranked, so the absence renders as absence rather than as dashes.
 *
 * WEIGHTED BY `xwobaSample`, NOT BY PITCH COUNT. Only ~22% of balls in play
 * carry an expected wOBA, and the share of them differs by pitch type, so
 * weighting a mean xwOBA by pitches thrown would let a heavily-thrown pitch
 * with few measured outcomes dominate a number it barely contributed to.
 */
export function toOpposingStarterFromProfile(
  profile: PitchProfile | null,
  /** The BATTER's side ('L'/'R'), so the platoon row shown is the one this matchup is actually about. */
  batterHand?: string | null,
): RoleStat[] {
  if (!profile || profile.role !== 'pitcher') return [];

  const measured = profile.pitchTypes.filter((p) => p.xwoba != null && p.xwobaSample > 0);
  const sample = measured.reduce((n, p) => n + p.xwobaSample, 0);
  const stats: RoleStat[] = [];

  if (sample > 0) {
    const weighted = measured.reduce((acc, p) => acc + p.xwoba! * p.xwobaSample, 0) / sample;
    stats.push({
      key: 'xwobaAllowed',
      label: 'xwOBA allowed',
      value: weighted,
      decimals: 3,
      // The SAME formatter the mix and the zone grid use. All three show xwOBA
      // on one page and a plain toFixed had this one printing `0.358` beside
      // their `.349`.
      format: fmt.rate3,
      lowerIsBetter: true,
      sub: `n=${sample}`,
    });
  }

  // The platoon side that matches this batter. A pitcher's `platoon` is grouped
  // by `stand`, so 'L' here means "versus left-handed batters" -- the row a
  // left-handed hitter's page should be showing.
  const hand = batterHand === 'L' || batterHand === 'R' ? batterHand : null;
  const side = hand ? profile.platoon.find((pl) => pl.hand === hand) : null;
  if (side && side.xwoba != null && side.xwobaSample > 0) {
    stats.push({
      key: 'xwobaVsHand',
      label: `xwOBA vs ${hand}HB`,
      value: side.xwoba,
      decimals: 3,
      format: fmt.rate3,
      lowerIsBetter: true,
      sub: `n=${side.xwobaSample}`,
    });
  }

  if (profile.totalPitches > 0) {
    stats.push({ key: 'pitches', label: 'Pitches thrown', value: profile.totalPitches, decimals: 0 });
  }
  return stats;
}

export function toUsageMixRole(
  profile: PitchProfile | null,
  /**
   * Tonight's opposing pitcher, when the subject is a batter and the starter
   * is known. Same `PitchProfile` shape from the same Statcast rollup row --
   * a pitcher's `pitchTypes[].xwoba` is what he ALLOWS on that pitch, exactly
   * as a batter's is what he HITS on it, so the two sides are directly
   * comparable without any per-role special casing.
   */
  opposing?: { profile: PitchProfile | null; name: string } | null,
  subjectName?: string,
): UsageMixRole | null {
  if (!profile || profile.pitchTypes.length === 0) return null;

  const opposingProfile = opposing?.profile ?? null;
  const compare =
    opposingProfile && opposingProfile.pitchTypes.length > 0
      ? {
          label: `${opposing!.name} throws`,
          subjectLabel: `${subjectName ?? 'Subject'} sees`,
          slices: opposingProfile.pitchTypes.map((p) => ({
            key: p.pitchType,
            share: p.share,
            value: p.xwoba ?? undefined,
            valueSample: p.xwobaSample,
          })),
          sampleSize: opposingProfile.totalPitches,
        }
      : null;

  return {
    compare,
    title: profile.role === 'pitcher' ? 'Pitch mix' : 'Pitch mix seen',
    slices: profile.pitchTypes.map((p) => ({
      key: p.pitchType,
      label: pitchTypeLabel(p.pitchType),
      share: p.share,
      // xwOBA against, not velocity: a 44% sinker is context, a 44% sinker they
      // get hit hard on is a reason. `undefined` (not 0) when the slice has no
      // measured outcome — a zero would render as an extraordinary result.
      value: p.xwoba ?? undefined,
      valueLabel: 'xwOBA',
      decimals: 3,
      // TRAP 1. Not `p.ballsInPlay`, not `p.pitches`.
      valueSample: p.xwobaSample,
    })),
    // The SAME formatter the strike-zone grid uses. Both cards sit on one page
    // showing one statistic, and a component-side `toFixed` default had them
    // printing `.717` and `0.796`.
    valueFormat: fmt.rate3,
    sampleSize: profile.totalPitches,
    emptyMessage: `No pitch-level Statcast for ${profile.season} yet.`,
  };
}

