/**
 * Every player a sport HAS, not the ones it happens to play today — R10.5.
 *
 * WHY THIS EXISTS. The Players tab built its whole list from
 * `snapshot.subjects`, which is the day's slate, so on a day with no games the
 * page said "No players on today's slate" and its search box had nothing to
 * search. The operator has asked three times for players and teams to load
 * regardless of the slate; team pages already do (`/nfl/teams` lists all 32
 * with no games on), and player DETAIL pages were freed from the slate in R6.1a.
 * The index was simply never converted.
 *
 * WHERE THE LIST COMES FROM. `player_season_production` for the seven rollup
 * sports (who actually played, with a production score to order by) and
 * `player_game_history` for tennis, which has no rollup. Names are the hard
 * part and are resolved the way R10.2's peer picker does it — the crosswalk
 * first, each league's team rosters for the rest — because the history tables
 * hold ids only. **A player nobody can name is left out** rather than listed as
 * an id.
 *
 * GOLF IS NOT HERE. It has no `player_game_history` at all; its field comes
 * from the tournament, and its own tables are the R6.6 path. The panel keeps
 * the slate list for golf, which is what a golf "field" honestly is.
 *
 * Server-only: reads Postgres.
 */

import { pgAll } from '@/lib/db/pgClient';
import { resolveAthleteNames } from './compareServer';
import { isTeamProductionSport, type TeamProductionSport } from './teamProductionShapes';
import type { HistorySport } from './playerResearchShapes';

/** One row of the Players tab's own list. */
export interface PlayerIndexEntry {
  athleteId: string;
  name: string;
  teamId: string | null;
  position: string | null;
  games: number;
}

export interface PlayerIndexPayload {
  sport: HistorySport;
  season: number | null;
  players: PlayerIndexEntry[];
  fetchedAt: string;
}

/**
 * How many the index carries. A sport's real roster of players who took the
 * field last season is in the hundreds; this is a search list, not a scroll,
 * and the search runs over the whole of it.
 */
const LIMIT = 600;

async function rollupPlayers(sport: TeamProductionSport, season: number): Promise<PlayerIndexEntry[]> {
  // The rollup holds one row per player PER TEAM, so a player traded
  // mid-season is two rows (measured: Cam Thomas, Jaden Ivey and ten more NBA
  // players listed twice). One row per player here: his games and score summed
  // across his stints, his team the one he played for last.
  const rows = await pgAll<{ athlete_id: string; team_id: string | null; games: number; position: string | null }>(
    `SELECT athlete_id, team_id, games, position FROM (
       SELECT DISTINCT ON (athlete_id) athlete_id, team_id, position,
              sum(games) OVER (PARTITION BY athlete_id) AS games,
              sum(score) OVER (PARTITION BY athlete_id) AS score
         FROM player_season_production
        WHERE sport = ? AND season = ? AND games >= 1
        ORDER BY athlete_id, last_game_date DESC NULLS LAST
     ) one
      ORDER BY score DESC, games DESC
      LIMIT ${LIMIT}`,
    [sport, season],
  );
  const named = await resolveAthleteNames(sport, rows);
  return rows
    .map((r) => ({
      athleteId: String(r.athlete_id),
      name: named.get(String(r.athlete_id)) ?? '',
      teamId: r.team_id ? String(r.team_id) : null,
      position: r.position,
      games: Number(r.games),
    }))
    .filter((p) => p.name);
}

/** Tennis has no rollup, so the list is who has match rows, most first. */
async function tennisPlayers(sport: 'tennis_atp' | 'tennis_wta', season: number): Promise<PlayerIndexEntry[]> {
  const rows = await pgAll<{ athlete_id: string; games: number; athlete_name: string | null }>(
    `SELECT h.athlete_id, count(*)::int AS games, max(x.athlete_name) AS athlete_name
       FROM player_game_history h
       LEFT JOIN athlete_crosswalk x ON x.sport = h.sport AND x.athlete_id = h.athlete_id
      WHERE h.sport = ? AND h.season = ?
      GROUP BY h.athlete_id
      ORDER BY count(*) DESC
      LIMIT ${LIMIT}`,
    [sport, season],
  );
  return rows
    .filter((r) => r.athlete_name)
    .map((r) => ({ athleteId: String(r.athlete_id), name: String(r.athlete_name), teamId: null, position: null, games: Number(r.games) }));
}

export async function readPlayerIndex(sport: HistorySport): Promise<PlayerIndexPayload> {
  const table = sport.startsWith('tennis') ? 'player_game_history' : 'player_season_production';
  const seasonRow = await pgAll<{ season: number | null }>(`SELECT max(season) AS season FROM ${table} WHERE sport = ?`, [sport]);
  const season = seasonRow[0]?.season != null ? Number(seasonRow[0].season) : null;
  if (season == null) return { sport, season: null, players: [], fetchedAt: new Date().toISOString() };

  // A season that has barely started holds a handful of players; last season is
  // the honest list to search in September, so the newer one is used only once
  // it has enough names to be a list.
  const primary = isTeamProductionSport(sport)
    ? await rollupPlayers(sport, season)
    : await tennisPlayers(sport as 'tennis_atp' | 'tennis_wta', season);
  const merged =
    primary.length >= 30
      ? primary
      : [
          ...primary,
          ...(isTeamProductionSport(sport)
            ? await rollupPlayers(sport, season - 1)
            : await tennisPlayers(sport as 'tennis_atp' | 'tennis_wta', season - 1)),
        ];
  // The season fallback can add a player the newer season already holds.
  const seen = new Set<string>();
  const players = merged.filter((p) => (seen.has(p.athleteId) ? false : (seen.add(p.athleteId), true)));

  return { sport, season, players, fetchedAt: new Date().toISOString() };
}
