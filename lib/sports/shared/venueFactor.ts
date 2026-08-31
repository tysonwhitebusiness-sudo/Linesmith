/**
 * Reading the venue scoring factors the Python job writes — Phase 6.10.
 *
 * `venue_factors` is keyed `(sport, team_id, season, stat_key)` and holds the
 * home/road scoring ratio for the sports that are not baseball. MLB keeps
 * `park_factors`, which is keyed by a real venue id because MLB is the only
 * sport that stores one per game.
 *
 * WHAT THE NUMBER HONESTLY MEANS, and the label says it rather than implying
 * more: "how much more scoring happens when this team is at home". It cannot
 * separate a genuine building effect (altitude, a fast rink) from ordinary home
 * advantage — travel, rest and refereeing all sit inside it. Calling it a park
 * factor for football would be borrowing baseball's precision without
 * baseball's venue key.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { VenueFactor } from './venueFactorShapes';

// The type and the formatter live in `venueFactorShapes.ts` — this file
// value-imports `pgAll` and must not be reachable from a client component.
export type { VenueFactor } from './venueFactorShapes';

/**
 * The newest factor for one team, or `null`.
 *
 * NEWEST SEASON WINS, and the season is not a parameter: the job walks back to
 * the last season with enough games, so a caller asking for "this season" would
 * get nothing for every sport whose current season is a stub — the exact
 * failure the job itself had to be fixed for.
 */
export async function readVenueFactor(sport: string, teamId: string, statKey: string): Promise<VenueFactor | null> {
  const rows = await pgAll<{
    sport: string; team_id: string; season: number; stat_key: string;
    factor: number; home_games: number; away_games: number;
  }>(
    `SELECT sport, team_id, season, stat_key, factor, home_games, away_games
       FROM venue_factors
      WHERE sport = ? AND team_id = ? AND stat_key = ?
      ORDER BY season DESC
      LIMIT 1`,
    [sport, teamId, statKey],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    sport: r.sport,
    teamId: r.team_id,
    season: Number(r.season),
    statKey: r.stat_key,
    factor: Number(r.factor),
    homeGames: Number(r.home_games),
    awayGames: Number(r.away_games),
  };
}
