/**
 * One NFL receiver's target map — the read path for Phase 6.8.
 *
 * The pure half lives in `targetMapShapes.ts` and is what client-reachable
 * code imports; this file value-imports `pgAll` and is server-only.
 */

import { pgAll } from '@/lib/db/pgClient';
import { toNflTargetMap, type NflTargetMap } from './targetMapShapes';

export type { NflTargetMap } from './targetMapShapes';

export async function getNflTargetMap(receiverId: string, season: number): Promise<NflTargetMap | null> {
  const rows = await pgAll<{
    pass_location: string | null;
    pass_length: string | null;
    air_yards: number | null;
    complete_pass: boolean | null;
  }>(
    `SELECT pass_location, pass_length, air_yards, complete_pass
       FROM nfl_target_events
      WHERE receiver_id = ? AND season = ?`,
    [receiverId, season],
  );
  return toNflTargetMap(
    rows.map((r) => ({
      passLocation: r.pass_location,
      passLength: r.pass_length,
      airYards: r.air_yards == null ? null : Number(r.air_yards),
      complete: r.complete_pass,
    })),
  );
}
