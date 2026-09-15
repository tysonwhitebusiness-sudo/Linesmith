/**
 * One subject's pitch profile — MLB's `usageMix` (pitch mix), `spatialGrid`
 * (strike zone) and `binarySplit` (platoon) roles.
 *
 * ================ IT READS THE SEASON ROLLUP, NOT THE PITCH TABLE ===========
 *
 * This used to aggregate `mlb_pitch_events` in Postgres. Phase 5 then pruned
 * that table to a hot window of about five days, with every older pitch in the
 * Parquet corpus, and the aggregates kept running: from then on the page's
 * "season" pitch mix and strike zone were the last few days (found in R5,
 * 2026-09-14). The retention floor this file used to check only caught a whole
 * season being gone, not a season cut to its last five days.
 *
 * The numbers now come from `mlb_statcast_player_season.payload.profile`,
 * computed from the corpus plus the hot window by
 * `python-odds-service/build_statcast_rollups.py`, with the same aggregates
 * this file ran (`statcast_rollups.attach_pitch_profiles`). Regular season only.
 * ===========================================================================
 *
 * THE xwOBA FILTER STILL MATTERS. `estimated_woba` is NOT reliably null on a
 * pitch that was not put in play (332 of 3,619 non-in-play pitches on one day
 * carried a value, 218 of them 0.0), so every xwOBA in the profile is averaged
 * over `description = 'hit_into_play'` only. Averaging every row with a value
 * drags each zone down: zone 1 read .281 that way against a true .367.
 *
 * THE PURE HALF LIVES IN `pitchProfileShapes.ts` — the types, `ZONE_GRID` and
 * the pitch-type labels — because this file value-imports the database client
 * and the player-detail adapter needs those three as runtime values.
 */

import { readPlayerStatcast } from './statcastRollups';
import type { PitchProfile } from './pitchProfileShapes';

export type { ZoneCell, PitchTypeShare, PitchProfile } from './pitchProfileShapes';
export { ZONE_GRID, PITCH_TYPE_LABELS, pitchTypeLabel } from './pitchProfileShapes';

const ROLE = { pitcher: 'pit', batter: 'bat' } as const;

/**
 * One subject's pitch profile for one season, or `null` when the rollup holds
 * no row for them (never appeared that season, or a season the corpus does not
 * reach). `null`, not an empty profile: "no pitches on record" must not render
 * as a real zero.
 */
export async function getPitchProfile(
  role: 'pitcher' | 'batter',
  subjectId: number,
  season: number,
): Promise<(PitchProfile & { asOf: string }) | null> {
  const rows = await readPlayerStatcast(subjectId, season);
  const row = rows.find((r) => r.role === ROLE[role]);
  const profile = row?.payload.profile;
  if (!row || !profile) return null;
  return { season, role, subjectId, asOf: row.asOf, ...profile };
}
