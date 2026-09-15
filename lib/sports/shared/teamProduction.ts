/**
 * Reads of the R5b strength rollups (`team_game_production`,
 * `player_season_production`). Pattern 2 (CLAUDE.md): tables written daily by
 * `teamProductionJob`, read directly. Shapes: `teamProductionShapes.ts`.
 *
 * A date cutoff is a `game_date <` filter on per-game rows, which is why the
 * rollup is per game: "strength as of kickoff" sums a few hundred rows instead
 * of a season of box scores.
 */

import { pgAll } from '@/lib/db/pgClient';
import type {
  KeyPlayer,
  LeagueProduction,
  ShotCell,
  TeamProductionSport,
  TeamShotProfile,
  TeamShotSide,
  TeamTotals,
} from './teamProductionShapes';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function readLeagueProduction(
  sport: TeamProductionSport,
  season: number,
  before: string | null,
): Promise<LeagueProduction> {
  const cutoff = before ? ' AND game_date < ?' : '';
  const args: Array<string | number> = before ? [sport, season, before] : [sport, season];

  // Per-key sums, for (by team) and allowed (by opponent), every group at once.
  const sums = await pgAll<{ side: 'for' | 'allowed'; team: string; pos_group: string; key: string; total: number }>(
    `SELECT 'for' AS side, team_id AS team, pos_group, e.key, sum(e.value::float) AS total
       FROM team_game_production, jsonb_each_text(stats) e
      WHERE sport = ? AND season = ?${cutoff} AND pos_group = 'all'
      GROUP BY team_id, pos_group, e.key
     UNION ALL
     SELECT 'allowed', opponent_id, pos_group, e.key, sum(e.value::float)
       FROM team_game_production, jsonb_each_text(stats) e
      WHERE sport = ? AND season = ?${cutoff}
      GROUP BY opponent_id, pos_group, e.key`,
    [...args, ...args],
  );
  const games = await pgAll<{ side: 'for' | 'allowed'; team: string; g: number }>(
    `SELECT 'for' AS side, team_id AS team, count(*)::int AS g FROM team_game_production
      WHERE sport = ? AND season = ?${cutoff} AND pos_group = 'all' GROUP BY team_id
     UNION ALL
     SELECT 'allowed', opponent_id, count(*)::int FROM team_game_production
      WHERE sport = ? AND season = ?${cutoff} AND pos_group = 'all' GROUP BY opponent_id`,
    [...args, ...args],
  );

  const gamesOf = { for: new Map<string, number>(), allowed: new Map<string, number>() };
  for (const r of games) gamesOf[r.side].set(r.team, Number(r.g));

  const out: LeagueProduction = { sport, season, before, for: {}, allowed: {}, allowedPos: {} };
  const bucket = (side: 'for' | 'allowed', team: string, group: string): TeamTotals => {
    const target =
      group === 'all' ? out[side] : (out.allowedPos[group] ??= {});
    return (target[team] ??= { g: gamesOf[side].get(team) ?? 0, s: {} });
  };
  for (const r of sums) bucket(r.side, r.team, r.pos_group).s[r.key] = round2(Number(r.total));
  return out;
}

export async function readKeyPlayers(
  sport: TeamProductionSport,
  season: number,
  teamId: string,
  limit: number,
  minGames: number,
): Promise<KeyPlayer[]> {
  const rows = await pgAll<{
    athlete_id: string;
    team_id: string;
    games: number;
    score: number;
    score_per_game: number;
    team_share: number | null;
    position: string | null;
    position_group: string | null;
    stats: unknown;
    last_game_date: Date | string;
  }>(
    `SELECT athlete_id, team_id, games, score, score_per_game, team_share, position, position_group, stats, last_game_date
       FROM player_season_production
      WHERE sport = ? AND season = ? AND team_id = ? AND games >= ?
      ORDER BY score_per_game DESC
      LIMIT ?`,
    [sport, season, teamId, minGames, limit],
  );
  return rows.map((r) => ({
    athleteId: r.athlete_id,
    teamId: r.team_id,
    games: Number(r.games),
    score: Number(r.score),
    scorePerGame: Number(r.score_per_game),
    teamShare: r.team_share == null ? null : Number(r.team_share),
    position: r.position,
    positionGroup: r.position_group,
    stats: (typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats) as Record<string, number>,
    lastGameDate: r.last_game_date instanceof Date ? r.last_game_date.toISOString().slice(0, 10) : String(r.last_game_date).slice(0, 10),
  }));
}

/** League views compare teams with at least this many games (G2). */
export const SHOT_VIEW_MIN_GAMES = 40;

export async function readTeamShotProfile(sport: 'nba' | 'nhl', season: number, teamId: string): Promise<TeamShotProfile | null> {
  const own = await pgAll<{ side: 'for' | 'allowed'; pos_group: string; games: number; payload: unknown }>(
    `SELECT side, pos_group, games, payload FROM team_shot_profile WHERE sport = ? AND season = ? AND team_id = ?`,
    [sport, season, teamId],
  );
  if (!own.length) return null;
  const league = await pgAll<{ team_id: string; games: number; zones: unknown; attempts: number | null }>(
    `SELECT team_id, games, payload->'zones' AS zones, (payload->>'attempts')::int AS attempts
       FROM team_shot_profile
      WHERE sport = ? AND season = ? AND side = 'for' AND pos_group = 'all' AND games >= ?`,
    [sport, season, SHOT_VIEW_MIN_GAMES],
  );
  const parse = <T>(raw: unknown): T => (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
  const out: TeamShotProfile = { sport, season, teamId, for: null, allowed: null, allowedPos: {}, league: {} };
  for (const r of own) {
    const side: TeamShotSide = { games: Number(r.games), ...parse<Omit<TeamShotSide, 'games'>>(r.payload) };
    if (r.pos_group === 'all') out[r.side] = side;
    else out.allowedPos[r.pos_group] = side;
  }
  for (const r of league) {
    out.league[r.team_id] = {
      games: Number(r.games),
      ...(r.zones != null ? { zones: parse<Record<string, ShotCell>>(r.zones) } : {}),
      ...(r.attempts != null ? { attempts: Number(r.attempts) } : {}),
    };
  }
  return out;
}
