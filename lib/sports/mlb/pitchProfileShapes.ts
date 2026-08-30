/**
 * The database-free half of `pitchProfile.ts` — Phase 6.6's shapes and lookups.
 *
 * ================== WHY THIS FILE EXISTS AS A SEPARATE FILE =================
 *
 * `pitchProfile.ts` value-imports `pgAll`. **Anything a `'use client'`
 * component reaches must not**, or Next bundles `pg` for the browser and every
 * page importing it dies with `Module not found: Can't resolve 'dns'`. That
 * happened twice in Phase 6 and survived six commits: `tsc --noEmit` passes it
 * and so did all 103 unit tests, because it is a bundling boundary, not a type
 * error.
 *
 * `mlb/adapters/playerDetailAdapter.ts` needs `ZONE_GRID` and `pitchTypeLabel`
 * as REAL RUNTIME VALUES to build the `usageMix` and `spatialGrid` roles — an
 * `import type` would not do, since it is erased. So the pure half lives here,
 * with no database import, exactly as `seasonAggregateShapes.ts` and
 * `nflUnitGrades.ts` were split out for the same reason.
 *
 * `tests/client-bundle-boundary.test.ts` fails if this file ever grows one.
 * ===========================================================================
 *
 * SAVANT'S ZONE CODES ARE NOT A ROW/COLUMN PAIR. 1-9 are the strike zone as a
 * 3x3 grid read from the CATCHER's view; 11-14 are the four outside quadrants.
 * `ZONE_GRID` does that mapping in one place so no caller re-derives it, and
 * the outside quadrants are deliberately excluded from the 3x3 rather than
 * folded into the edges, which would misplace real pitches.
 */

/**
 * Savant zones 1-9 as a 3x3 grid, row-major, top row first.
 *
 * Catcher's view: zone 1 is up-and-away from the catcher's perspective, which
 * is up-and-IN to a right-handed batter. The caption a page renders must say
 * "catcher view" or the grid is mirrored from what the reader assumes — that
 * caption being hardcoded into the primitive was half of the "4.800" bug, so
 * it now travels as data on the role.
 */
export const ZONE_GRID: ReadonlyArray<ReadonlyArray<number>> = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
];

export interface ZoneCell {
  zone: number;
  /** Mean xwOBA. `null` when nothing in this zone carried one. */
  xwoba: number | null;
  /**
   * Rows that actually contributed to `xwoba` — **this is the number to show
   * beside it**, not `ballsInPlay`.
   *
   * Measured on the 2024 data: only **5,031 of 22,574 balls in play carry an
   * `estimated_woba`** (22%), because it needs exit velocity and launch angle
   * and those are not tracked on every batted ball. Labelling a zone
   * ".367 (n=51)" off `ballsInPlay` when eleven rows produced it overstates the
   * sample fourfold — the sort of thing that reads as solid and is not.
   */
  xwobaSample: number;
  /** Balls in play, whether or not they carried an expected wOBA. */
  ballsInPlay: number;
  /** Every pitch thrown to the zone, in play or not. */
  pitches: number;
}

export interface PitchTypeShare {
  pitchType: string;
  pitches: number;
  /** 0-100, of this subject's total pitches. */
  share: number;
  /** Mean xwOBA against this pitch type. */
  xwoba: number | null;
  /** Rows behind `xwoba` — show this, not `ballsInPlay`. See `ZoneCell.xwobaSample`. */
  xwobaSample: number;
  ballsInPlay: number;
  avgVelocity: number | null;
}

/**
 * One side of the platoon split — MLB's `binarySplit`.
 *
 * THE OPPOSITE HAND IS THE ONE THAT MATTERS. For a BATTER the split is by
 * `p_throws` (vs LHP / vs RHP); for a PITCHER it is by `stand` (vs LHB / vs
 * RHB). Splitting a batter by his own stance would produce one bar and an
 * empty one, which is why the column is chosen from the role rather than
 * hardcoded.
 *
 * `xwobaSample` is carried for the same reason it is on `ZoneCell`: only ~22%
 * of balls in play have an `estimated_woba`, so the n beside an xwOBA is never
 * the pitch count.
 */
export interface PlatoonSide {
  /** 'L' or 'R' — the OPPOSING hand. */
  hand: string;
  pitches: number;
  ballsInPlay: number;
  xwoba: number | null;
  xwobaSample: number;
}

export interface PitchProfile {
  season: number;
  /** Which side of the matchup this profile is for. */
  role: 'pitcher' | 'batter';
  subjectId: number;
  totalPitches: number;
  zones: ZoneCell[];
  pitchTypes: PitchTypeShare[];
  /** vs LHP/RHP for a batter, vs LHB/RHB for a pitcher. Empty when nothing is on record. */
  platoon: PlatoonSide[];
}


/** Full pitch-type names, for a mix a reader can parse without knowing Savant's codes. */
export const PITCH_TYPE_LABELS: Record<string, string> = {
  FF: 'Four-seam',
  SI: 'Sinker',
  FC: 'Cutter',
  SL: 'Slider',
  ST: 'Sweeper',
  SV: 'Slurve',
  CU: 'Curveball',
  KC: 'Knuckle curve',
  CH: 'Changeup',
  FS: 'Splitter',
  FO: 'Forkball',
  KN: 'Knuckleball',
  EP: 'Eephus',
  SC: 'Screwball',
  PO: 'Pitchout',
};

export function pitchTypeLabel(code: string): string {
  return PITCH_TYPE_LABELS[code] ?? code;
}
