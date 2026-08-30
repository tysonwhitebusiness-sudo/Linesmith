/**
 * One team's rating trajectory — the read path for Phase 6.14's rating block.
 *
 * The pure half lives in `teamRatingShapes.ts` and is what client-reachable
 * code imports; this file value-imports `pgAll` and is server-only.
 *
 * THE SPORT FILTER IS LOAD-BEARING, not defensive tidiness — see the shapes
 * file's note on the 43 team ids shared across four sports.
 */

import { pgAll } from '@/lib/db/pgClient';
import { toTeamRatingHistory, type TeamRatingHistory } from './teamRatingShapes';

export type { TeamRatingHistory } from './teamRatingShapes';

/**
 * SEASONS ARE CAPPED. MLB has sixteen years of history per team (~2,600 rated
 * games), and every prior season is drawn as one more receded context line.
 * Past a handful they stop being context and become hatching. Six is the most
 * recent six, so a sport with one season is unaffected and MLB shows a real
 * multi-year picture without the frame turning grey.
 */
const MAX_SEASONS = 6;

export async function getTeamRatingHistory(sportKey: string, teamId: number): Promise<TeamRatingHistory | null> {
  const rows = await pgAll<{
    season: number;
    game_date: string | Date;
    elo: number;
    games_played: number;
  }>(
    `SELECT season, game_date, elo, games_played
       FROM team_elo_history
      WHERE sport = ? AND team_id = ?
        AND season >= (
          SELECT COALESCE(MIN(s), 0) FROM (
            SELECT DISTINCT season AS s
              FROM team_elo_history
             WHERE sport = ? AND team_id = ?
             ORDER BY s DESC
             LIMIT ?
          ) recent
        )
      ORDER BY season, games_played, game_date`,
    [sportKey, teamId, sportKey, teamId, MAX_SEASONS],
  );

  return toTeamRatingHistory(
    rows.map((r) => ({
      season: Number(r.season),
      // `game_date` is a DATE column and comes back as a Date through pg.
      gameDate: String(r.game_date instanceof Date ? r.game_date.toISOString().slice(0, 10) : r.game_date).slice(0, 10),
      elo: Number(r.elo),
      gamesPlayed: Number(r.games_played),
    })),
  );
}
