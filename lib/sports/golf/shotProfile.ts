/**
 * One golfer's shot profile — the read path for Phase 6.13's golf roles.
 *
 * The pure half lives in `shotProfileShapes.ts` and is what client-reachable
 * code imports; this file value-imports `pgAll` and is server-only.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { GolfShotRow } from './shotProfileShapes';

export type { GolfShotRow } from './shotProfileShapes';

/**
 * Every shot on record for one player.
 *
 * NO SEASON FILTER, deliberately, unlike the NFL/NBA/NHL profiles. Those read
 * a live feed and a season is the natural window; this table is a STATIC
 * 2020-2023 seed, so filtering to the current season would return nothing for
 * every player. The caller says what span it is showing.
 */
export async function getGolfShotProfile(playerId: string): Promise<GolfShotRow[]> {
  const rows = await pgAll<{
    from_lie: string | null;
    left_yds: number | null;
    distance_yds: number | null;
    is_putt: boolean;
  }>(
    `SELECT from_lie, left_yds, distance_yds, is_putt
       FROM golf_shot_events
      WHERE player_id = ?`,
    [playerId],
  );
  return rows.map((r) => ({
    fromLie: r.from_lie,
    leftYds: r.left_yds == null ? null : Number(r.left_yds),
    distanceYds: r.distance_yds == null ? null : Number(r.distance_yds),
    isPutt: Boolean(r.is_putt),
  }));
}
