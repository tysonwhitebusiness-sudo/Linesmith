/**
 * Pitch-level rollups from `mlb_pitch_events` — Phase 6.6's read path.
 *
 * Turns the per-pitch table into the two roles MLB could not fill before it
 * existed: `usageMix` (the pitch mix) and `spatialGrid` (the strike zone). This
 * ships alongside the ingester deliberately — a table with a writer and no
 * reader is the "dead consumer" shape this repo has been bitten by four times,
 * and it is much easier to notice a rollup is wrong while the data is fresh in
 * mind than six weeks later.
 *
 * ================= THE FILTER THAT MAKES THE ZONE GRID CORRECT =============
 *
 * `estimated_woba` is NOT reliably null on a pitch that was not put in play.
 * Measured against one real day: **332 of 3,619 non-in-play pitches carried a
 * value, and 218 of those were 0.0.** Averaging every row with a value drags
 * each zone down — zone 1 reads **.281 that way against a true .367**, zone 9
 * .235 against .318.
 *
 * So every xwOBA aggregate here filters on `description = 'hit_into_play'`,
 * NOT on `estimated_woba IS NOT NULL`. That is also what the column's own
 * comment in the migration says, in those words. Getting it wrong produces a
 * grid full of plausible numbers that are all quietly too low, which nothing
 * downstream can detect.
 * ===========================================================================
 *
 * SAVANT'S ZONE CODES ARE NOT A ROW/COLUMN PAIR. 1-9 are the strike zone as a
 * 3x3 grid read from the CATCHER's view; 11-14 are the four outside quadrants.
 * `ZONE_GRID` below does that mapping in one place so no caller re-derives it,
 * and the outside quadrants are deliberately excluded from the 3x3 rather than
 * folded into the edges, which would misplace real pitches.
 */

import { pgAll } from '@/lib/db/pgClient';

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

export interface PitchProfile {
  season: number;
  /** Which side of the matchup this profile is for. */
  role: 'pitcher' | 'batter';
  subjectId: number;
  totalPitches: number;
  zones: ZoneCell[];
  pitchTypes: PitchTypeShare[];
}

/** Guards the interpolated column name — `role` picks a real column, never user text. */
const ROLE_COLUMN = { pitcher: 'pitcher_id', batter: 'batter_id' } as const;

/**
 * One subject's pitch profile for one season.
 *
 * Two aggregates in two queries rather than one wide one: the zone rollup and
 * the pitch-type rollup group by different columns, and a single query doing
 * both would need a grouping set whose result is harder to read than the two
 * plain queries it replaces.
 */
export async function getPitchProfile(
  role: 'pitcher' | 'batter',
  subjectId: number,
  season: number,
): Promise<PitchProfile> {
  const column = ROLE_COLUMN[role];
  if (!column) throw new Error(`getPitchProfile: unknown role ${role}`);

  const zoneRows = await pgAll<{ zone: number; xwoba: string | null; xwoba_n: string; bip: string; pitches: string }>(
    `SELECT zone,
            AVG(estimated_woba) FILTER (WHERE description = 'hit_into_play') AS xwoba,
            COUNT(estimated_woba) FILTER (WHERE description = 'hit_into_play') AS xwoba_n,
            COUNT(*) FILTER (WHERE description = 'hit_into_play')            AS bip,
            COUNT(*)                                                         AS pitches
       FROM mlb_pitch_events
      WHERE ${column} = ? AND season = ? AND zone IS NOT NULL
      GROUP BY zone`,
    [subjectId, season],
  );

  const typeRows = await pgAll<{
    pitch_type: string;
    pitches: string;
    xwoba: string | null;
    xwoba_n: string;
    bip: string;
    velo: string | null;
  }>(
    `SELECT pitch_type,
            COUNT(*)                                                          AS pitches,
            AVG(estimated_woba) FILTER (WHERE description = 'hit_into_play')  AS xwoba,
            COUNT(estimated_woba) FILTER (WHERE description = 'hit_into_play') AS xwoba_n,
            COUNT(*) FILTER (WHERE description = 'hit_into_play')             AS bip,
            AVG(release_speed)                                                AS velo
       FROM mlb_pitch_events
      WHERE ${column} = ? AND season = ? AND pitch_type IS NOT NULL
      GROUP BY pitch_type
      ORDER BY 2 DESC`,
    [subjectId, season],
  );

  const totalPitches = typeRows.reduce((s, r) => s + Number(r.pitches), 0);

  return {
    season,
    role,
    subjectId,
    totalPitches,
    zones: zoneRows.map((r) => ({
      zone: Number(r.zone),
      xwoba: r.xwoba == null ? null : Number(r.xwoba),
      xwobaSample: Number(r.xwoba_n),
      ballsInPlay: Number(r.bip),
      pitches: Number(r.pitches),
    })),
    pitchTypes: typeRows.map((r) => ({
      pitchType: r.pitch_type,
      pitches: Number(r.pitches),
      // Shares are of TOTAL pitches, so they sum to 100 across the returned
      // types. The adapter does not renormalise — see `UsageMixRole`.
      share: totalPitches > 0 ? (Number(r.pitches) / totalPitches) * 100 : 0,
      xwoba: r.xwoba == null ? null : Number(r.xwoba),
      xwobaSample: Number(r.xwoba_n),
      ballsInPlay: Number(r.bip),
      avgVelocity: r.velo == null ? null : Number(r.velo),
    })),
  };
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
