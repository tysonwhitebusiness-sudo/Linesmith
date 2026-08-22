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

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { getPlayerSeasonStatsByGsis, MOST_RECENT_STATS_SEASON, type PlayerSeasonStats } from './nflverse';

export type PoolKey = 'QB' | 'RB' | 'WR_TE' | 'CB' | 'S' | 'LB' | 'DL' | 'K' | 'P';

export const SIDE_OF_BALL: Record<PoolKey, 'offense' | 'defense' | 'special-teams'> = {
  QB: 'offense',
  RB: 'offense',
  WR_TE: 'offense',
  CB: 'defense',
  S: 'defense',
  LB: 'defense',
  DL: 'defense',
  K: 'special-teams',
  P: 'special-teams',
};

/** Real ESPN position codes -> the pool they're ranked in. Unlisted positions (OL, ST non-K/P) aren't pooled — no per-player stat line exists to rank them on (see nflverse.ts's PlayerSeasonStats comment on the O-line gap). Exported so nflTeamGrades.ts groups team-level position-group aggregates the same way. */
export const POOL_BY_POSITION: Record<string, PoolKey> = {
  QB: 'QB',
  RB: 'RB',
  FB: 'RB',
  WR: 'WR_TE',
  TE: 'WR_TE',
  CB: 'CB',
  S: 'S',
  SS: 'S',
  FS: 'S',
  LB: 'LB',
  OLB: 'LB',
  ILB: 'LB',
  MLB: 'LB',
  DE: 'DL',
  DT: 'DL',
  NT: 'DL',
  K: 'K',
  P: 'P',
};

interface StatDef {
  key: string;
  label: string;
  weight: number;
  higherIsBetter: boolean;
  value: (s: PlayerSeasonStats) => number;
}

const perGame = (n: number, games: number) => (games > 0 ? n / games : 0);
const perPlay = (n: number, plays: number) => (plays > 0 ? n / plays : 0);
const pct = (made: number, att: number) => (att > 0 ? made / att : 0);

/**
 * v1 weights — hand-set and principled (each position's real headline
 * production stats), not yet fit against outcomes. Same disclosed-not-
 * hidden posture `batterRankings.ts`'s own `COMPOSITE_WEIGHTS` comment
 * takes. Every stat here is a real nflverse column; nothing is invented.
 */
const POOL_STAT_DEFS: Record<PoolKey, StatDef[]> = {
  QB: [
    { key: 'passYdsPerGm', label: 'Pass Yds/Gm', weight: 0.3, higherIsBetter: true, value: (s) => perGame(s.passingYards, s.games) },
    { key: 'passTdPerGm', label: 'Pass TD/Gm', weight: 0.3, higherIsBetter: true, value: (s) => perGame(s.passingTds, s.games) },
    { key: 'passEpaPerPlay', label: 'Pass EPA/Play', weight: 0.25, higherIsBetter: true, value: (s) => perPlay(s.passingEpa, s.passingAttempts) },
    { key: 'intPerGm', label: 'INT/Gm', weight: 0.15, higherIsBetter: false, value: (s) => perGame(s.passingInterceptions, s.games) },
  ],
  RB: [
    { key: 'rushYdsPerGm', label: 'Rush Yds/Gm', weight: 0.35, higherIsBetter: true, value: (s) => perGame(s.rushingYards, s.games) },
    { key: 'rushTdPerGm', label: 'Rush TD/Gm', weight: 0.25, higherIsBetter: true, value: (s) => perGame(s.rushingTds, s.games) },
    { key: 'rushEpaPerPlay', label: 'Rush EPA/Play', weight: 0.2, higherIsBetter: true, value: (s) => perPlay(s.rushingEpa, s.rushingAttempts) },
    { key: 'recPerGm', label: 'Rec/Gm', weight: 0.2, higherIsBetter: true, value: (s) => perGame(s.receptions, s.games) },
  ],
  WR_TE: [
    { key: 'recYdsPerGm', label: 'Rec Yds/Gm', weight: 0.35, higherIsBetter: true, value: (s) => perGame(s.receivingYards, s.games) },
    { key: 'recPerGm', label: 'Rec/Gm', weight: 0.3, higherIsBetter: true, value: (s) => perGame(s.receptions, s.games) },
    { key: 'recTdPerGm', label: 'Rec TD/Gm', weight: 0.25, higherIsBetter: true, value: (s) => perGame(s.receivingTds, s.games) },
    { key: 'targetsPerGm', label: 'Targets/Gm', weight: 0.1, higherIsBetter: true, value: (s) => perGame(s.targets, s.games) },
  ],
  CB: [
    { key: 'intPerGm', label: 'INT/Gm', weight: 0.4, higherIsBetter: true, value: (s) => perGame(s.defInterceptions, s.games) },
    { key: 'pdPerGm', label: 'Pass Def/Gm', weight: 0.4, higherIsBetter: true, value: (s) => perGame(s.defPassDefended, s.games) },
    { key: 'tklPerGm', label: 'Solo Tkl/Gm', weight: 0.2, higherIsBetter: true, value: (s) => perGame(s.defTacklesSolo, s.games) },
  ],
  S: [
    { key: 'intPerGm', label: 'INT/Gm', weight: 0.35, higherIsBetter: true, value: (s) => perGame(s.defInterceptions, s.games) },
    { key: 'tklPerGm', label: 'Solo Tkl/Gm', weight: 0.35, higherIsBetter: true, value: (s) => perGame(s.defTacklesSolo, s.games) },
    { key: 'pdPerGm', label: 'Pass Def/Gm', weight: 0.3, higherIsBetter: true, value: (s) => perGame(s.defPassDefended, s.games) },
  ],
  LB: [
    { key: 'tklPerGm', label: 'Tkl/Gm', weight: 0.35, higherIsBetter: true, value: (s) => perGame(s.defTacklesSolo + s.defTacklesAssist, s.games) },
    { key: 'sackPerGm', label: 'Sacks/Gm', weight: 0.25, higherIsBetter: true, value: (s) => perGame(s.defSacks, s.games) },
    { key: 'tflPerGm', label: 'TFL/Gm', weight: 0.25, higherIsBetter: true, value: (s) => perGame(s.defTacklesForLoss, s.games) },
    { key: 'qbHitPerGm', label: 'QB Hits/Gm', weight: 0.15, higherIsBetter: true, value: (s) => perGame(s.defQbHits, s.games) },
  ],
  DL: [
    { key: 'sackPerGm', label: 'Sacks/Gm', weight: 0.45, higherIsBetter: true, value: (s) => perGame(s.defSacks, s.games) },
    { key: 'qbHitPerGm', label: 'QB Hits/Gm', weight: 0.3, higherIsBetter: true, value: (s) => perGame(s.defQbHits, s.games) },
    { key: 'tflPerGm', label: 'TFL/Gm', weight: 0.25, higherIsBetter: true, value: (s) => perGame(s.defTacklesForLoss, s.games) },
  ],
  K: [
    { key: 'fgPct', label: 'FG%', weight: 0.6, higherIsBetter: true, value: (s) => (s.fgPct > 0 ? s.fgPct : pct(s.fgMade, s.fgAtt)) },
    { key: 'fgMade', label: 'FG Made', weight: 0.4, higherIsBetter: true, value: (s) => s.fgMade },
  ],
  P: [
    { key: 'netPuntAvg', label: 'Net Punt Avg', weight: 1, higherIsBetter: true, value: (s) => perPlay(s.puntNetYards, s.puntAttempts) },
  ],
};

/** Real-activity gate — a player who never recorded any of their pool's stats doesn't get a composite computed from zeros standing in for "didn't play." Same role MLB's batted-ball-trio requirement plays. */
function hasRealActivity(pool: PoolKey, s: PlayerSeasonStats): boolean {
  if (s.games === 0) return false;
  return POOL_STAT_DEFS[pool].some((def) => def.value(s) > 0);
}

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

function percentileOfRank(rank: number, poolSize: number): number {
  if (poolSize <= 1) return 100;
  return 100 * (1 - (rank - 1) / (poolSize - 1));
}

function compositeFor(pool: PoolKey, values: Record<string, number>, ranks: Record<string, number>, poolSize: number): number | null {
  let weightedSum = 0;
  let weightUsed = 0;
  for (const def of POOL_STAT_DEFS[pool]) {
    const rank = ranks[def.key];
    if (rank == null) continue;
    weightedSum += percentileOfRank(rank, poolSize) * def.weight;
    weightUsed += def.weight;
  }
  return weightUsed === 0 ? null : weightedSum / weightUsed;
}

export interface NflPlayerRankings {
  season: string;
  computedAt: string;
  byGsis: Map<string, RankedNflPlayer>;
}

async function computeRankings(season: string): Promise<NflPlayerRankings> {
  const statsByGsis = await getPlayerSeasonStatsByGsis(season);

  const byPool = new Map<PoolKey, Array<{ gsisId: string; stats: PlayerSeasonStats }>>();
  for (const [gsisId, stats] of statsByGsis) {
    const pool = POOL_BY_POSITION[stats.position];
    if (!pool || !hasRealActivity(pool, stats)) continue;
    const bucket = byPool.get(pool) ?? [];
    bucket.push({ gsisId, stats });
    byPool.set(pool, bucket);
  }

  const byGsis = new Map<string, RankedNflPlayer>();

  for (const [pool, entries] of byPool) {
    const values = new Map(entries.map((e) => [e.gsisId, Object.fromEntries(POOL_STAT_DEFS[pool].map((def) => [def.key, def.value(e.stats)]))]));

    const ranksByGsis = new Map<string, Record<string, number>>(entries.map((e) => [e.gsisId, {}]));
    for (const def of POOL_STAT_DEFS[pool]) {
      const sorted = [...entries].sort((a, b) => {
        const av = values.get(a.gsisId)![def.key];
        const bv = values.get(b.gsisId)![def.key];
        return def.higherIsBetter ? bv - av : av - bv;
      });
      sorted.forEach((e, i) => { ranksByGsis.get(e.gsisId)![def.key] = i + 1; });
    }

    const poolSize = entries.length;
    const ranked = entries.map((e) => ({
      gsisId: e.gsisId,
      position: e.stats.position,
      pool,
      games: e.stats.games,
      values: values.get(e.gsisId)!,
      positionComposite: compositeFor(pool, values.get(e.gsisId)!, ranksByGsis.get(e.gsisId)!, poolSize),
      positionRank: null as number | null,
      positionPoolSize: poolSize,
      sideOfBallRank: null as number | null,
      sideOfBallPoolSize: 0,
    }));

    // Ties on composite (real, common at the tails of a small pool) break
    // on games played — the closest playing-time proxy this data has,
    // same reasoning as MLB's pitches-seen/innings-pitched tiebreak.
    ranked.sort((a, b) => {
      const c = (b.positionComposite ?? -1) - (a.positionComposite ?? -1);
      if (c !== 0) return c;
      return b.games - a.games;
    });
    ranked.forEach((r, i) => { r.positionRank = r.positionComposite != null ? i + 1 : null; });

    for (const r of ranked) byGsis.set(r.gsisId, r);
  }

  // Side-of-ball pass — pools each player's own positionComposite (already
  // a normalized 0-100 within their exact position) across every position
  // on the same side of the ball, so a CB and an LB land in one ranked
  // list without ever comparing their raw stats directly.
  const sideGroups = new Map<'offense' | 'defense' | 'special-teams', RankedNflPlayer[]>();
  for (const r of byGsis.values()) {
    if (r.positionComposite == null) continue;
    const side = SIDE_OF_BALL[r.pool];
    const bucket = sideGroups.get(side) ?? [];
    bucket.push(r);
    sideGroups.set(side, bucket);
  }
  for (const group of sideGroups.values()) {
    group.sort((a, b) => (b.positionComposite! - a.positionComposite!) || (b.games - a.games));
    group.forEach((r, i) => {
      r.sideOfBallRank = i + 1;
      r.sideOfBallPoolSize = group.length;
    });
  }

  return { season, computedAt: new Date().toISOString(), byGsis };
}

const CACHE_TTL_MS = 24 * 60 * 60_000;

function cacheKey(season: string): string {
  return `nfl:player-rankings:${season}`;
}

interface SerializedRankings { season: string; computedAt: string; players: RankedNflPlayer[] }

/** 24h-cached position-pooled composites — a normal page load never pays for a recompute across the full player pool. */
export async function getNflPlayerRankings(season: string = MOST_RECENT_STATS_SEASON, forceRefresh = false): Promise<NflPlayerRankings> {
  if (!forceRefresh) {
    const cached = await readSnapshotCache(cacheKey(season));
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
      const parsed = JSON.parse(cached.payload) as SerializedRankings;
      return { season: parsed.season, computedAt: parsed.computedAt, byGsis: new Map(parsed.players.map((p) => [p.gsisId, p])) };
    }
  }
  const result = await computeRankings(season);
  const serialized: SerializedRankings = { season: result.season, computedAt: result.computedAt, players: [...result.byGsis.values()] };
  await writeSnapshotCache(cacheKey(season), JSON.stringify(serialized));
  return result;
}

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
