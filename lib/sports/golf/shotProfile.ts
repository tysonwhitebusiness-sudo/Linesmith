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
 * ============ KEYED BY NAME, NOT ID, AND THAT IS NOT LAZINESS ============
 *
 * `golf_shot_events.player_id` is PGA TOUR's own id (Brian Stuard is 31560).
 * The app's golf `subjectId` is ESPN's athlete id (Xander Schauffele is
 * 10140). **Both are five-digit numbers**, so an id-keyed lookup compiles,
 * runs, returns zero rows and looks like a player with no data — which is
 * exactly what it did on the first pass: 0 of 30 slate golfers matched.
 *
 * There is no offline crosswalk between them, and names are what both feeds
 * agree on. Measured: **21 of 30** live-slate golfers match by name. The nine
 * that do not (Ludvig Aberg, Tom Kim, Min Woo Lee, Ryan Fox...) are players
 * who reached the Tour after 2023 and are genuinely absent from this seed, not
 * matching failures — checked individually, including whether stripping
 * punctuation rescued any. It did not.
 *
 * ONE NAME IN THIS TABLE MAPS TO TWO PGA IDS. Aggregating across both is the
 * safer default: if it is one person with a reissued id the numbers are
 * right, and if it is two people the sample is visibly larger rather than
 * silently halved.
 *
 * NO SEASON FILTER, deliberately, unlike the NFL/NBA/NHL profiles. Those read
 * a live feed and a season is the natural window; this table is a STATIC
 * 2020-2023 seed, so filtering to the current season would return nothing for
 * everyone. The caller says what span it is showing.
 * =========================================================================
 */
export async function getGolfShotProfile(playerName: string): Promise<GolfShotRow[]> {
  const rows = await pgAll<{
    from_lie: string | null;
    left_yds: number | null;
    distance_yds: number | null;
    is_putt: boolean;
  }>(
    `SELECT from_lie, left_yds, distance_yds, is_putt
       FROM golf_shot_events
      WHERE lower(player_name) = lower(?)`,
    [playerName],
  );
  return rows.map((r) => ({
    fromLie: r.from_lie,
    leftYds: r.left_yds == null ? null : Number(r.left_yds),
    distanceYds: r.distance_yds == null ? null : Number(r.distance_yds),
    isPutt: Boolean(r.is_putt),
  }));
}
