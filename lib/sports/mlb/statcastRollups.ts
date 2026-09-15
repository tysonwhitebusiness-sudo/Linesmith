/**
 * Reads of the R5a Statcast rollup tables. Pattern 2 (CLAUDE.md): each is one
 * indexed row from a table the operator machine refreshes after every corpus
 * refresh, so there is nothing to cache. Shapes: `statcastRollupShapes.ts`.
 */

import { pgAll, pgGet } from '@/lib/db/pgClient';
import type {
  GamePregameStatcast,
  PlayerStatcastRow,
  StatcastRole,
  TeamStatcastRow,
} from './statcastRollupShapes';

/** `jsonb` may come back parsed or as text depending on the driver path. */
function json<T>(raw: unknown): T {
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}

function isoDate(raw: unknown): string {
  return raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
}

export async function readPlayerStatcast(playerId: number, season: number): Promise<PlayerStatcastRow[]> {
  const rows = await pgAll<{ role: StatcastRole; as_of: unknown; qualified: boolean; payload: unknown }>(
    `SELECT role, as_of, qualified, payload FROM mlb_statcast_player_season
      WHERE season = ? AND player_id = ? ORDER BY role`,
    [season, playerId],
  );
  return rows.map((r) => ({
    season,
    playerId,
    role: r.role,
    asOf: isoDate(r.as_of),
    qualified: r.qualified,
    payload: json(r.payload),
  }));
}

export async function readTeamStatcast(teamId: string, season: number): Promise<TeamStatcastRow[]> {
  const rows = await pgAll<{ side: StatcastRole; as_of: unknown; payload: unknown }>(
    `SELECT side, as_of, payload FROM mlb_statcast_team_season
      WHERE season = ? AND team_id = ? ORDER BY side`,
    [season, teamId],
  );
  return rows.map((r) => ({ season, teamId, side: r.side, asOf: isoDate(r.as_of), payload: json(r.payload) }));
}

export async function readGamePregameStatcast(gamePk: number): Promise<GamePregameStatcast | null> {
  const row = await pgGet<{ game_date: unknown; season: number; as_of: unknown; computed_at: Date | string; payload: unknown }>(
    `SELECT game_date, season, as_of, computed_at, payload FROM mlb_statcast_game_pregame WHERE game_pk = ?`,
    [gamePk],
  );
  if (!row) return null;
  return {
    gamePk,
    gameDate: isoDate(row.game_date),
    season: row.season,
    asOf: isoDate(row.as_of),
    computedAt: row.computed_at instanceof Date ? row.computed_at.toISOString() : String(row.computed_at),
    payload: json(row.payload),
  };
}
