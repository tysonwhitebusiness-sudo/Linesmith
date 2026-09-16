/**
 * One NBA shooter's every field-goal attempt, for the player page's "Shot
 * profile" section (R6.5).
 *
 * The pure half (zones, families, the section) is `playerShotShapes.ts`, which
 * client code imports; this file value-imports `pgAll` and is server-only —
 * the split `pitchProfileShapes.ts` documents and
 * `tests/client-bundle-boundary.test.ts` enforces.
 *
 * This replaces `getNbaShotProfile` (the 3x3 grid), deleted in this phase:
 * these are the raw rows, which a 9-cell summary cannot give back.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { NbaShot, NbaShotsPayload } from './playerShotShapes';

/** The busiest shooter holds about 1,500 attempts a season; two seasons is the table's whole span. */
const MAX_ROWS = 6000;

export async function getNbaPlayerShots(shooterId: number): Promise<NbaShotsPayload | null> {
  const rows = await pgAll<{
    game_date: string;
    season: number;
    x_coord: string | number | null;
    y_coord: string | number | null;
    point_value: number | null;
    made: boolean;
    shot_type: string | null;
    fetched_at: string | null;
  }>(
    // No opponent: the table carries team ids, not names, and resolving one per
    // shot would cost a join per row for a tooltip line the date already covers.
    `SELECT s.game_date::text, s.season, s.x_coord, s.y_coord, s.point_value, s.made, s.shot_type, s.fetched_at::text
       FROM nba_shot_events s
      WHERE s.shooter_id = ?
      ORDER BY s.game_date, s.event_idx
      LIMIT ${MAX_ROWS}`,
    [shooterId],
  );
  if (rows.length === 0) return null;

  const num = (v: string | number | null) => (v == null ? null : Number(v));
  const shots: NbaShot[] = rows.map((r) => ({
    date: r.game_date.slice(0, 10),
    season: Number(r.season),
    x: num(r.x_coord),
    y: num(r.y_coord),
    pointValue: r.point_value == null ? null : Number(r.point_value),
    made: Boolean(r.made),
    shotType: r.shot_type,
    opponent: null,
  }));
  return {
    shooterId,
    seasons: [...new Set(shots.map((s) => s.season))].sort((a, b) => a - b),
    shots,
    asOf: rows[rows.length - 1]?.fetched_at ?? null,
  };
}
