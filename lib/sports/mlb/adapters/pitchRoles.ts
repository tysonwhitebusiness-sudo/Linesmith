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

import { MIDDOT, fmt } from '@/components/charts/tokens';
import type { BinarySplitRole, SpatialGridRole, UsageMixRole } from '@/lib/sports/shared/playerRoles';
import { ZONE_GRID, pitchTypeLabel } from '@/lib/sports/mlb/pitchProfileShapes';
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
export function toUsageMixRole(
  profile: PitchProfile | null,
  /**
   * Tonight's opposing pitcher, when the subject is a batter and the starter
   * is known. Same `PitchProfile` shape from the same `getPitchProfile` call --
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

/**
 * The strike zone as a 3x3 heat grid of xwOBA on balls in play.
 *
 * WHICH WAY THE HEAT RUNS IS A PROPERTY OF THE SUBJECT, NOT OF THE SPORT. The
 * same .367 is a good outcome for the batter and a bad one for the pitcher who
 * allowed it, so `lowerIsBetter` follows `profile.role`. That is the one piece
 * of per-subject reasoning that cannot live in the component, which by design
 * does not know what a strike zone is.
 *
 * `null` when nothing in the grid carries an xwOBA at all — nine empty cells
 * under a "Strike zone" heading says less than no card.
 */
export function toSpatialGridRole(profile: PitchProfile | null): SpatialGridRole | null {
  if (!profile) return null;

  // `ZONE_GRID` owns the 1-9 layout so nothing re-derives it, and Savant's
  // 11-14 (the OUTSIDE quadrants) stay out of the 3x3 rather than being folded
  // into the edges, which would misplace real pitches.
  const cells = ZONE_GRID.map((row) =>
    row.map((zone) => {
      const cell = profile.zones.find((z) => z.zone === zone);
      return {
        key: String(zone),
        value: cell?.xwoba ?? null,
        sampleSize: cell?.xwobaSample ?? null,
      };
    }),
  );

  // TRAP 1 again, in aggregate — and TRAP 3, which only showed up on the page.
  //
  // Sum ONLY the nine cells actually drawn. Summing `profile.zones` instead
  // counts zones 11-14, which the grid excludes: Jackson Merrill's 2026 profile
  // had all three of its expected-wOBA rows in the outside quadrants, so the
  // card rendered nine cells reading "no data" under a caption saying "n=3".
  // Every number on it was defensible and the card as a whole was a lie.
  // `tsc` cannot see this, and neither could a test that summed the same wrong
  // set the builder did — it took opening the page.
  const xwobaSample = cells.flat().reduce((sum, c) => sum + (c.sampleSize ?? 0), 0);
  if (xwobaSample === 0) return null;

  return {
    title: 'Strike zone',
    cells,
    format: fmt.rate3,
    unit: 'xwOBA',
    // Three things a reader cannot infer and would otherwise get wrong: the
    // grid is mirrored unless it says "catcher view"; the numbers are balls in
    // play only, not every pitch; and the total n is the sparse one. A caption
    // hardcoded into the primitive was half of the "4.800" bug, so it travels
    // as data on the role.
    caption: `catcher view ${MIDDOT} xwOBA on balls in play ${MIDDOT} n=${xwobaSample.toLocaleString()}`,
    lowerIsBetter: profile.role === 'pitcher',
    emptyMessage: 'No batted-ball locations on record.',
  };
}

/**
 * MLB's `binarySplit` — the platoon split, vs LHP/RHP for a batter and vs
 * LHB/RHB for a pitcher.
 *
 * THIS FIELD WAS NULL WITH THE COMMENT "this app stores no platoon split".
 * That was true when it was written and 6.6 made it stale: `mlb_pitch_events`
 * carries `p_throws` and `stand` on all 2,140,525 rows. The stale claim is the
 * point — a `null` justified in prose outlives the reason for it, and nothing
 * type-checks a comment.
 *
 * `null` unless BOTH sides have a real sample, the same rule
 * `toVenueBinarySplit` enforces and for the same measured reason: a card
 * reading "vs LHP 0 (n=0) vs RHP .340 (n=812)" is a broken split rendered as a
 * real one. Every batter faces both hands, so a missing side means missing
 * DATA, never a real zero.
 *
 * XWOBA CARRIES ITS OWN n, NOT THE PITCH COUNT. Only ~22% of balls in play have
 * an `estimated_woba`; quoting pitches beside it overstates the sample by an
 * order of magnitude. Same trap as `toUsageMixRole`, third time in this file.
 */
export function toPlatoonBinarySplit(profile: PitchProfile | null): BinarySplitRole | null {
  if (!profile || profile.platoon.length === 0) return null;
  const versus = profile.role === 'batter' ? 'HP' : 'HB';
  const left = profile.platoon.find((p) => p.hand === 'L');
  const right = profile.platoon.find((p) => p.hand === 'R');
  if (!left || !right) return null;
  if (left.pitches === 0 || right.pitches === 0) return null;

  const rows: BinarySplitRole['rows'] = [
    {
      key: 'pitches',
      label: 'Pitches seen',
      a: left.pitches,
      b: right.pitches,
      decimals: 0,
      aSample: left.pitches,
      bSample: right.pitches,
    },
  ];

  // Only offered when BOTH sides have a real xwOBA behind them. One side with a
  // number and the other blank invites reading the gap as a split.
  if (left.xwoba != null && right.xwoba != null) {
    rows.push({
      key: 'xwoba',
      label: 'xwOBA',
      a: left.xwoba,
      b: right.xwoba,
      decimals: 3,
      aSample: left.xwobaSample,
      bSample: right.xwobaSample,
    });
  }

  return {
    title: 'Platoon split',
    aLabel: `vs L${versus}`,
    bLabel: `vs R${versus}`,
    rows,
    emptyMessage: 'No platoon split on record for this season.',
  };
}
