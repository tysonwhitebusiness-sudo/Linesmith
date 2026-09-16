/**
 * Roster production for a team page — R7. Who played for a team in a season,
 * ordered by the R5b production score, with their season totals.
 *
 * The score and games come from `player_season_production` (written daily by
 * `teamProductionJob`). The totals are summed here from `player_game_history`
 * rather than read from that table's `stats`, because it rolls only the dozen
 * keys the matchup cards need: MLB's has no RBI, games started or hit-by-pitch,
 * all of which a roster table shows. The sum is restricted to the athletes the
 * rollup names, so it rides the `(sport, athlete_id, season)` index (250 ms for
 * the Royals' 53 players, measured 2026-09-16) instead of scanning a season.
 *
 * Server-only: value-imports `pgAll`.
 */

import { pgAll } from '@/lib/db/pgClient';

export interface RosterProductionRow {
  athleteId: string;
  games: number;
  score: number;
  position: string | null;
  stats: Record<string, number>;
}

export async function readRosterProduction(sport: string, season: number, teamId: string): Promise<{ rows: RosterProductionRow[]; computedAt: string | null }> {
  const players = await pgAll<{ athlete_id: string; games: number; score: number; position: string | null; computed_at: Date | string }>(
    `SELECT athlete_id, games, score, position, computed_at
       FROM player_season_production
      WHERE sport = ? AND season = ? AND team_id = ?
      ORDER BY score DESC, games DESC`,
    [sport, season, teamId],
  );
  if (!players.length) return { rows: [], computedAt: null };
  const ids = players.map((p) => String(p.athlete_id));
  // Numeric values only; MLB's innings arrive as 6.2 for six and two-thirds,
  // which is not a decimal (R2), so they are carried as outs instead.
  const sums = await pgAll<{ athlete_id: string; key: string; total: number }>(
    `SELECT h.athlete_id, e.key,
            sum(CASE WHEN e.key = 'pit_inningsPitched'
                     THEN floor(e.value::float) * 3 + round((e.value::float - floor(e.value::float)) * 10)
                     ELSE e.value::float END) AS total
       FROM player_game_history h, jsonb_each_text(h.stats) e
      WHERE h.sport = ? AND h.season = ? AND h.team_id = ? AND h.athlete_id = ANY(?)
        AND e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
      GROUP BY h.athlete_id, e.key`,
    [sport, season, teamId, ids],
  );
  const statsOf = new Map<string, Record<string, number>>();
  for (const s of sums) {
    const key = s.key === 'pit_inningsPitched' ? 'pit_outs' : s.key;
    (statsOf.get(String(s.athlete_id)) ?? statsOf.set(String(s.athlete_id), {}).get(String(s.athlete_id))!)[key] = Number(s.total);
  }
  const computed = players[0].computed_at;
  return {
    rows: players.map((p) => ({
      athleteId: String(p.athlete_id),
      games: Number(p.games),
      score: Number(p.score),
      position: p.position,
      stats: statsOf.get(String(p.athlete_id)) ?? {},
    })),
    computedAt: computed instanceof Date ? computed.toISOString() : computed ? String(computed) : null,
  };
}
