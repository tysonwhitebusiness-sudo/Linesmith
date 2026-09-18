/**
 * Position-pooled player composites — the NFL port of
 * `lib/sports/mlb/batterRankings.ts`'s real methodology (read in full
 * before writing this): rank each real headline stat within a pool,
 * convert each rank to a percentile, weighted-average the percentiles into
 * one 0-100 composite, sort the pool by composite to assign a 1-best rank.
 *
 * MLB's file computes an *overall* rank (whole batter pool) and a
 * *position* rank (just the position group) from the same stat line, since
 * every batter shares AVG/OBP/SLG. NFL positions don't share one stat line
 * — a CB's real production and a QB's aren't comparable numbers — so
 * "overall" isn't meaningful the way it is for MLB. What NFL gets instead:
 * `positionRank` (within the exact position pool, e.g. CB vs CB) and
 * `sideOfBallRank` (offense vs offense, defense vs defense), where the
 * side-of-ball ranking pools each player's own *positionComposite* score
 * (already a normalized 0-100, comparable across positions) rather than
 * raw stats.
 *
 * Data source: `getPlayerSeasonStatsByGsis` (nflverse.ts), the same
 * `stats_player_reg_{season}.csv` fetch already in place — this file reads
 * columns nothing else in this app uses yet (defense, kicking, punting,
 * returns), verified live with real rows before wiring in (Calais
 * Campbell, Cameron Jordan — see nflverse.ts's PlayerSeasonStats comment).
 */

import { readSnapshotCache } from '@/lib/db/client';
import { MOST_RECENT_STATS_SEASON } from './nflverse';

export type PoolKey = 'QB' | 'RB' | 'WR_TE' | 'CB' | 'S' | 'LB' | 'DL' | 'K' | 'P';

export interface RankedNflPlayer {
  gsisId: string;
  position: string;
  pool: PoolKey;
  games: number;
  values: Record<string, number>;
  /** 0-100, higher is better, against the exact position pool. Null when there isn't enough of a real profile to compute one. */
  positionComposite: number | null;
  /** 1 = best within the exact position pool (CB vs CB, not CB vs S). */
  positionRank: number | null;
  positionPoolSize: number;
  /** 1 = best against every player on the same side of the ball, ranked by positionComposite (each position's own normalized score, not raw stats — the only way a CB and an LB become comparable). */
  sideOfBallRank: number | null;
  sideOfBallPoolSize: number;
}

export interface NflPlayerRankings {
  season: string;
  computedAt: string;
  byGsis: Map<string, RankedNflPlayer>;
}

function cacheKey(season: string): string {
  return `nfl:player-rankings:${season}`;
}

interface SerializedRankings { season: string; computedAt: string; players: RankedNflPlayer[] }

/** Same bundle, but never recomputes — reads whatever's cached, however stale, null if nothing's been computed yet. Safe to call from the live snapshot-build path (mirrors `getCachedBatterRankings`'s exact reasoning: the live path can't afford a cold full-pool recompute). */
export async function getCachedNflPlayerRankings(season: string = MOST_RECENT_STATS_SEASON): Promise<NflPlayerRankings | null> {
  const cached = await readSnapshotCache(cacheKey(season));
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached.payload) as SerializedRankings;
    return { season: parsed.season, computedAt: parsed.computedAt, byGsis: new Map(parsed.players.map((p) => [p.gsisId, p])) };
  } catch {
    return null;
  }
}
