/**
 * C2.1 — the pool a hero tile is ranked in, read from `player_season_production`.
 * Server-only. See `playerPool.ts` for how a tile is ranked from it.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { PlayerPool, PoolPlayer } from './playerPool';
import type { TeamProductionSport } from './teamProductionShapes';

/** How a rank line names a group ("34th of 142 RB", "12th of 204 guards"). */
const GROUP_LABEL: Record<string, string> = {
  hitter: 'hitters',
  pitcher: 'pitchers',
  all: 'players',
  G: 'guards',
  F: 'forwards',
  C: 'centers',
  D: 'defensemen',
  GK: 'keepers',
  DEF: 'defenders',
  MID: 'midfielders',
  FWD: 'forwards',
};

export function poolLabel(sport: TeamProductionSport, group: string): string {
  // Hockey's F and basketball's F are both forwards; hockey's G is a goalie.
  if (sport === 'nhl' && group === 'G') return 'goalies';
  return GROUP_LABEL[group] ?? group;
}

/**
 * One row per player per season: the rollup keeps a row per team, so a
 * player traded mid-season is summed across his stints, as the peer list does.
 */
export async function readPlayerPool(sport: TeamProductionSport, group: string): Promise<PlayerPool> {
  const seasons = await pgAll<{ season: number }>(
    `SELECT DISTINCT season FROM player_season_production WHERE sport = ? ORDER BY season DESC LIMIT 2`,
    [sport],
  );
  const wanted = seasons.map((s) => Number(s.season));
  // MLB has no position rows: a pitcher is a player whose history holds
  // pitching innings, the rule `compareServer.playerGroup` uses.
  const where =
    sport === 'mlb'
      ? `p.sport = 'mlb' AND p.season = ANY(?) AND (EXISTS (SELECT 1 FROM player_game_history h
            WHERE h.sport = 'mlb' AND h.athlete_id = p.athlete_id AND h.season = p.season
              AND (h.stats->>'pit_inningsPitched') IS NOT NULL)) = ?`
      : sport === 'cfb'
        ? `p.sport = 'cfb' AND p.season = ANY(?)`
        : `p.sport = ? AND p.season = ANY(?) AND p.position_group = ?`;
  const params = sport === 'mlb' ? [wanted, group === 'pitcher'] : sport === 'cfb' ? [wanted] : [sport, wanted, group];
  const rows = await pgAll<{ season: number; athlete_id: string; games: number; stats: Record<string, number> }>(
    `WITH p AS (SELECT * FROM player_season_production p WHERE ${where}),
          g AS (SELECT season, athlete_id, sum(games)::int AS games FROM p GROUP BY 1, 2),
          s AS (SELECT p.season, p.athlete_id, e.key, sum(e.value::numeric) AS total
                  FROM p, jsonb_each_text(p.stats) e
                 WHERE e.value ~ '^-?[0-9.]+$'
                 GROUP BY 1, 2, 3)
     SELECT g.season, g.athlete_id, g.games, jsonb_object_agg(s.key, s.total) AS stats
       FROM g JOIN s USING (season, athlete_id)
      GROUP BY 1, 2, 3`,
    params,
  );
  const bySeason: Record<number, PoolPlayer[]> = {};
  for (const r of rows) {
    const season = Number(r.season);
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.stats ?? {})) stats[k] = Number(v);
    (bySeason[season] ??= []).push({ athleteId: String(r.athlete_id), games: Number(r.games), stats });
  }
  return { group, label: poolLabel(sport, group), seasons: bySeason };
}
