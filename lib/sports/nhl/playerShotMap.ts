/**
 * One NHL player's every attempt, for the player page's shot map (R6.5) — a
 * skater's own attempts, or the ones a goalie faced.
 *
 * The pure half (rotation, sections, the official-totals table) is
 * `playerShotMapShapes.ts`, which client code imports; this file value-imports
 * `pgAll` and is server-only — the split `shotProfileShapes.ts` documents and
 * `tests/client-bundle-boundary.test.ts` enforces.
 *
 * This replaces `getNhlShotProfile` (the 3x3 grid), deleted in this phase:
 * these are the raw rows, which a 9-cell summary cannot give back.
 *
 * WHICH COLUMN TO KEY ON is decided by the data, not by a position string: a
 * goalie takes no shots (Hellebuyck has 0 rows as a shooter), so the read tries
 * `shooter_id` first and falls back to `goalie_id`. A player who is neither
 * returns null.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { NhlShot, NhlShotsPayload } from './playerShotMapShapes';

/** A heavy shooter takes ~350 attempts a season; a busy goalie faces ~2,500. Two seasons is the table's span. */
const MAX_ROWS = 7000;

interface Row {
  game_date: string;
  season: string | number;
  event_type: string;
  shot_type: string | null;
  x_coord: string | number | null;
  y_coord: string | number | null;
  zone_code: string | null;
  period: number | null;
  fetched_at: string | null;
}

const SELECT = `SELECT game_date::text, season, event_type, shot_type, x_coord, y_coord, zone_code, period, fetched_at::text
                  FROM nhl_shot_events`;

export async function getNhlPlayerShotMap(playerId: number): Promise<NhlShotsPayload | null> {
  const asShooter = await pgAll<Row>(`${SELECT} WHERE shooter_id = ? ORDER BY game_date, event_idx LIMIT ${MAX_ROWS}`, [playerId]);
  // A goalie's own shot count is 0 or a stray; anything below this is not a
  // skater's season and the goalie read is the right one.
  const role: 'skater' | 'goalie' = asShooter.length > 10 ? 'skater' : 'goalie';
  const rows =
    role === 'skater'
      ? asShooter
      : await pgAll<Row>(`${SELECT} WHERE goalie_id = ? ORDER BY game_date, event_idx LIMIT ${MAX_ROWS}`, [playerId]);
  if (rows.length === 0) return null;

  const num = (v: string | number | null) => (v == null ? null : Number(v));
  const shots: NhlShot[] = rows.map((r) => ({
    date: r.game_date.slice(0, 10),
    season: String(r.season),
    eventType: r.event_type,
    shotType: r.shot_type,
    x: num(r.x_coord),
    y: num(r.y_coord),
    zoneCode: r.zone_code,
    period: r.period == null ? null : Number(r.period),
  }));
  return {
    playerId,
    role,
    seasons: [...new Set(shots.map((s) => s.season))].sort(),
    shots,
    asOf: rows[rows.length - 1]?.fetched_at ?? null,
  };
}
