/**
 * One NBA shooter's shot profile — the read path for Phase 6.7.
 *
 * The pure half (types, distance, the bands) lives in `shotProfileShapes.ts`
 * and is what client-reachable code imports; this file value-imports `pgAll`
 * and is server-only.
 */

import { pgAll } from '@/lib/db/pgClient';
import { toNbaShotProfile, type NbaShotProfile } from './shotProfileShapes';

export type { NbaShotProfile } from './shotProfileShapes';

export async function getNbaShotProfile(shooterId: number, season: number): Promise<NbaShotProfile | null> {
  const rows = await pgAll<{ x_coord: number | null; y_coord: number | null; point_value: number | null; made: boolean }>(
    `SELECT x_coord, y_coord, point_value, made
       FROM nba_shot_events
      WHERE shooter_id = ? AND season = ?`,
    [shooterId, season],
  );
  return toNbaShotProfile(
    rows.map((r) => ({
      xCoord: r.x_coord == null ? null : Number(r.x_coord),
      yCoord: r.y_coord == null ? null : Number(r.y_coord),
      pointValue: r.point_value == null ? null : Number(r.point_value),
      made: Boolean(r.made),
    })),
  );
}
