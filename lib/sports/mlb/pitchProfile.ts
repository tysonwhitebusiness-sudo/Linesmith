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
 * THE PURE HALF LIVES IN `pitchProfileShapes.ts` — the types, `ZONE_GRID` and
 * the pitch-type labels — because this file value-imports `pgAll` and the
 * player-detail adapter needs those three as runtime values. Re-exported below
 * so a server-side caller still has one import to reach for.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { PitchProfile } from './pitchProfileShapes';

export type { ZoneCell, PitchTypeShare, PitchProfile } from './pitchProfileShapes';
export { ZONE_GRID, PITCH_TYPE_LABELS, pitchTypeLabel } from './pitchProfileShapes';

/** Guards the interpolated column name — `role` picks a real column, never user text. */
const ROLE_COLUMN = { pitcher: 'pitcher_id', batter: 'batter_id' } as const;

/**
 * Where the pruner publishes the oldest season Postgres still holds.
 *
 * PHASE 5.S.5 TRIMS `mlb_pitch_events` TO A HOT WINDOW, with every older season
 * living in the Parquet corpus. That creates a distinction this route could not
 * previously make, and getting it wrong is worse than an error: a request for a
 * pruned season would aggregate zero rows and return a perfectly well-formed
 * profile saying the player threw nothing. The route's own comment already
 * names that failure — it is why the floor was hardcoded to 2024 in the first
 * place — but a hardcoded floor cannot track a window that moves every season.
 *
 * So the floor is DATA, not a constant: `prune_pitch_events.py` writes it here
 * after each prune, and this reader asks. A cross-language constant would have
 * to be kept in step by hand in two languages, which is the exact drift
 * `tests/config-drift.test.ts` exists to catch; a value published by the only
 * process that can change it cannot drift.
 *
 * Absent means "nothing has ever been pruned", so every season the table
 * declares is real — which is the correct reading for a database that has not
 * run 5.S.5 yet, including a fresh one.
 */
const FLOOR_CACHE_KEY = 'mlb:pitch-events:retained-floor';

export class SeasonNotRetained extends Error {
  constructor(
    readonly season: number,
    readonly floor: number,
  ) {
    super(
      `season ${season} is no longer held in Postgres (oldest retained: ${floor}). ` +
        `It is in the Parquet corpus — see python-odds-service/prune_pitch_events.py.`,
    );
    this.name = 'SeasonNotRetained';
  }
}

/** The oldest season Postgres still holds, or null if nothing was ever pruned. */
export async function retainedSeasonFloor(): Promise<number | null> {
  const rows = await pgAll<{ payload: unknown }>(
    `SELECT payload FROM snapshot_cache WHERE cache_key = ?`,
    [FLOOR_CACHE_KEY],
  );
  if (!rows.length) return null;
  // `payload` is jsonb; the driver may hand back an object or the raw text.
  const raw = rows[0].payload;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const floor = Number((parsed as { floor?: unknown })?.floor);
  return Number.isInteger(floor) ? floor : null;
}

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

  // Asked BEFORE the aggregates run, so a pruned season costs one indexed
  // lookup rather than three full rollups that were always going to be empty.
  const floor = await retainedSeasonFloor();
  if (floor != null && season < floor) throw new SeasonNotRetained(season, floor);

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

  // The platoon split (MLB's `binarySplit`). Grouped by the OPPOSING hand:
  // `p_throws` when the subject is a batter, `stand` when it is a pitcher.
  // Splitting a batter by his own stance would give one populated side and one
  // empty, which is why this column is derived from the role.
  const platoonColumn = role === 'batter' ? 'p_throws' : 'stand';
  const platoonRows = await pgAll<{ hand: string; pitches: string; bip: string; xwoba: string | null; xwoba_n: string }>(
    `SELECT ${platoonColumn} AS hand,
            COUNT(*)                                                          AS pitches,
            COUNT(*) FILTER (WHERE description = 'hit_into_play')             AS bip,
            AVG(estimated_woba) FILTER (WHERE description = 'hit_into_play')  AS xwoba,
            COUNT(estimated_woba) FILTER (WHERE description = 'hit_into_play') AS xwoba_n
       FROM mlb_pitch_events
      WHERE ${column} = ? AND season = ? AND ${platoonColumn} IS NOT NULL
      GROUP BY 1
      ORDER BY 1`,
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
    platoon: platoonRows.map((r) => ({
      hand: r.hand,
      pitches: Number(r.pitches),
      ballsInPlay: Number(r.bip),
      xwoba: r.xwoba == null ? null : Number(r.xwoba),
      xwobaSample: Number(r.xwoba_n),
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

