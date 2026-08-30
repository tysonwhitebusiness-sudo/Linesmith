/**
 * One NHL shooter's shot profile — the read path for Phase 6.7.
 *
 * The pure half (types, normalisation, the grid) lives in
 * `shotProfileShapes.ts` and is what client-reachable code imports; this file
 * value-imports `pgAll` and is server-only. See that file's header for the
 * coordinate trap and the blocked-shot attribution finding.
 */

import { pgAll } from '@/lib/db/pgClient';
import { toNhlShotProfile, type NhlShotProfile } from './shotProfileShapes';

export type { NhlShotProfile } from './shotProfileShapes';

/**
 * Every shot attempt by one player in one season, folded to a 3x3 grid.
 *
 * All four event types are included — blocked and missed shots are exactly
 * what separates a volume shooter from an efficient one, and `shooter_id` is
 * the shooter on all of them (unlike `team_id`, which on a blocked shot is the
 * BLOCKING team; see `shotProfileShapes.ts`).
 */
export async function getNhlShotProfile(shooterId: number, season: string): Promise<NhlShotProfile | null> {
  const rows = await pgAll<{ event_type: string; x_coord: number | null; y_coord: number | null }>(
    `SELECT event_type, x_coord, y_coord
       FROM nhl_shot_events
      WHERE shooter_id = ? AND season = ?`,
    [shooterId, season],
  );
  return toNhlShotProfile(
    rows.map((r) => ({
      eventType: r.event_type,
      xCoord: r.x_coord == null ? null : Number(r.x_coord),
      yCoord: r.y_coord == null ? null : Number(r.y_coord),
    })),
  );
}
