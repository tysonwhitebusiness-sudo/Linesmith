/**
 * Read of `team_target_profile` (R5d). Pattern 2 (CLAUDE.md): written daily by
 * `teamProductionJob`, read directly. Shapes: `teamTargetShapes.ts`.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { NflTeamTargets, TeamTargetSide } from './teamTargetShapes';

export async function readNflTeamTargets(season: number, teamId: string): Promise<NflTeamTargets | null> {
  const rows = await pgAll<{ team_id: string; side: 'offense' | 'defense'; pos_group: string; games: number; payload: unknown }>(
    `SELECT team_id, side, pos_group, games, payload FROM team_target_profile
      WHERE season = ? AND (team_id = ? OR team_id = 'league')`,
    [season, teamId],
  );
  if (!rows.some((r) => r.team_id === teamId)) return null;
  const out: NflTeamTargets = { season, teamId, offense: null, defense: null, defenseByPosition: {}, league: null };
  for (const r of rows) {
    const payload = (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as Omit<TeamTargetSide, 'games'>;
    const side: TeamTargetSide = { games: Number(r.games), cells: payload.cells };
    if (r.team_id === 'league') out.league = side;
    else if (r.pos_group !== 'all') out.defenseByPosition[r.pos_group] = side;
    else out[r.side] = side;
  }
  return out;
}
