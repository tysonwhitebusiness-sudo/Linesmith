/**
 * Role-aware pitcher rankings — starters, closers, and relievers each ranked
 * within their own pool (see `classifyPitcherRole` in statsapi.ts for why
 * they can't share one pool), on traditional stats, FIP/K-BB%, and Statcast
 * quality metrics together. Where the original starters-only DVP system
 * (`adapter.ts`'s `starterStatCard`/`MatchupContext`) stays untouched and
 * keeps serving every live scan request, this is a separate, 24h-cached
 * pipeline — the "how are pitchers ranked" answer for the diagnostics view,
 * not (yet) wired into the live per-request matchup path.
 */

import { readSnapshotCache, writeSnapshotCache } from '../../db/client';
import {
  getLeaguePitcherRolePools,
  rankPitchers,
  type PitcherRankKey,
  type PitcherStatLine,
  type PitcherRole,
  type RawPitcherSeasonLine,
} from './statsapi';
import { getSeasonStatcastPitcherRates, type StatcastPitcherRates } from './savant';

export interface RankedPitcher {
  personId: number;
  fullName: string;
  role: PitcherRole;
  values: Partial<Record<PitcherRankKey, number>>;
  ranks: Partial<Record<PitcherRankKey, number>>;
  poolSize: number;
  /** 0-100, higher is better — null when there aren't enough ranked stats to compute one (e.g. a pool of 1). */
  composite: number | null;
  /** 1 = best in the pool, matching the "Nth of poolSize" convention the rest of the app's DVP/matchup ranks already use — a plain score alone doesn't slot into that convention, an ordinal does. Null alongside a null composite. */
  overallRank: number | null;
  raw: RawPitcherSeasonLine;
}

export interface PitcherRoleRankings {
  season: number;
  computedAt: string;
  starters: RankedPitcher[];
  closers: RankedPitcher[];
  relievers: RankedPitcher[];
}

/**
 * Hand-set v1 weights — same "principled, not yet fit against real outcomes"
 * posture as edgeModel.ts's own hyperparameters. Traditional/FIP/K-BB% carry
 * more weight than Statcast: Statcast rates need bigger samples to stabilize
 * and are already gated by their own per-pitcher minimums (savant.ts), so a
 * pitcher below those minimums simply contributes fewer weighted terms here
 * (see the renormalization below) rather than a fabricated zero.
 */
const COMPOSITE_WEIGHTS: Partial<Record<PitcherRankKey, number>> = {
  era: 0.2,
  fip: 0.2,
  kbbPct: 0.15,
  whip: 0.1,
  hardHitPct: 0.1,
  barrelPct: 0.1,
  exitVelo: 0.075,
  whiffPct: 0.075,
};

function compositeScore(ranks: Partial<Record<PitcherRankKey, number>>, poolSize: number): number | null {
  if (poolSize <= 1) return null;
  let weightedSum = 0;
  let weightUsed = 0;
  for (const [key, weight] of Object.entries(COMPOSITE_WEIGHTS) as [PitcherRankKey, number][]) {
    const rank = ranks[key];
    if (rank == null) continue;
    // rank 1 (best) -> 100th percentile; rank poolSize (worst) -> 0th.
    const percentile = 100 * (1 - (rank - 1) / (poolSize - 1));
    weightedSum += percentile * weight;
    weightUsed += weight;
  }
  if (weightUsed === 0) return null;
  return weightedSum / weightUsed;
}

function buildPool(
  role: PitcherRole,
  rows: Array<{ raw: RawPitcherSeasonLine; stat: PitcherStatLine }>,
  statcast: Map<number, StatcastPitcherRates>,
): RankedPitcher[] {
  const merged = rows.map((r) => {
    const sc = statcast.get(r.raw.personId);
    return {
      raw: r.raw,
      stat: {
        ...r.stat,
        values: {
          ...r.stat.values,
          ...(sc
            ? { whiffPct: sc.whiffPct, barrelPct: sc.barrelPct, exitVelo: sc.exitVelo, hardHitPct: sc.hardHitPct }
            : {}),
        },
      },
    };
  });

  const ranks = rankPitchers(merged.map((m) => m.stat));
  const poolSize = merged.length;

  const scored = merged.map((m) => {
    const pitcherRanks = ranks.get(m.raw.personId) ?? {};
    return {
      personId: m.raw.personId,
      fullName: m.raw.fullName,
      role,
      values: m.stat.values,
      ranks: pitcherRanks,
      poolSize,
      composite: compositeScore(pitcherRanks, poolSize),
      raw: m.raw,
    };
  });

  // Composite ties are common — several pitchers landing on the exact same
  // ordinal rank for most of their component stats produces identical
  // percentile blends. Breaking those ties on innings pitched (not just
  // leaving sort order arbitrary) means the more established arm — the one
  // with the bigger, more trustworthy sample behind those same numbers —
  // edges out a small-sample pitcher sitting at an identical score, rather
  // than the tie resolving on whatever order the API happened to return.
  scored.sort((a, b) => {
    const composite = (b.composite ?? -1) - (a.composite ?? -1);
    if (composite !== 0) return composite;
    return b.raw.inningsPitched - a.raw.inningsPitched;
  });

  return scored.map((p, i) => ({ ...p, overallRank: p.composite != null ? i + 1 : null }));
}

const CACHE_TTL_MS = 24 * 60 * 60_000;

function cacheKey(season: number): string {
  return `mlb:pitcher-role-rankings:${season}`;
}

/** Role-classified, ranked, composite-scored pitcher pools — 24h cached so a normal page load never pays for a Statcast refresh. `forceRefresh` bypasses the cache (used by a manual "refresh now" trigger). */
export async function getPitcherRoleRankings(season: number, forceRefresh = false): Promise<PitcherRoleRankings> {
  if (!forceRefresh) {
    const cached = readSnapshotCache(cacheKey(season));
    if (cached) {
      const age = Date.now() - Date.parse(cached.fetchedAt);
      if (age < CACHE_TTL_MS) {
        return JSON.parse(cached.payload) as PitcherRoleRankings;
      }
    }
  }

  const [pools, statcast] = await Promise.all([getLeaguePitcherRolePools(season), getSeasonStatcastPitcherRates(season)]);

  const result: PitcherRoleRankings = {
    season,
    computedAt: new Date().toISOString(),
    starters: buildPool('starter', pools.starters, statcast),
    closers: buildPool('closer', pools.closers, statcast),
    relievers: buildPool('reliever', pools.relievers, statcast),
  };

  writeSnapshotCache(cacheKey(season), JSON.stringify(result));
  return result;
}

/**
 * Same bundle, but never recomputes — reads whatever's cached, however
 * stale, and returns null if nothing's been computed yet this season. Safe
 * to call from the live snapshot-build path (see `getCachedStatcastPitcherRates`
 * in savant.ts for the same reasoning): `getPitcherRoleRankings` itself can
 * fall through to a live Statcast backfill on a stale/cold cache, which is
 * fine for a manually-triggered diagnostics refresh but not for a function
 * every scan request goes through.
 */
export function getCachedPitcherRoleRankings(season: number): PitcherRoleRankings | null {
  const cached = readSnapshotCache(cacheKey(season));
  if (!cached) return null;
  try {
    return JSON.parse(cached.payload) as PitcherRoleRankings;
  } catch {
    return null;
  }
}
