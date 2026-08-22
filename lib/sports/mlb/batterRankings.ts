/**
 * Position-aware batter rankings — the batter-side equivalent of
 * pitcherRankings.ts's role-classified pools, but split by primary position
 * (C/1B/2B/3B/SS/OF/DH) rather than starter/closer/reliever, since position
 * is what actually groups "who else should this hitter's contact quality be
 * compared against" the way a pitcher's role does. Same idea otherwise: every
 * batter gets ranked against the whole qualified pool (`overallRank`) and
 * against just their position group (`positionRank`), plus a composite
 * 0-100 score blending the four Statcast quality-of-contact metrics.
 *
 * Unlike pitcherRankings.ts, there's no traditional-stat merge here (no
 * AVG/OBP/SLG) — this is purely the Statcast side, the same four metrics
 * PlayerDetail's Quality of Contact card and the team-level rollup already
 * use. A composite blending traditional batting stats in too is a real
 * future extension, not part of this.
 */

import { readSnapshotCache, writeSnapshotCache } from '../../db/client';
import { getLeagueBatterSeasonRows, type RawBatterSeasonLine } from './statsapi';
import {
  getSeasonStatcastBatterRates,
  rankBatterStatcast,
  type BatterStatcastKey,
  type StatcastBatterRates,
} from './savant';

/** LF/CF/RF pool together — any one outfield spot alone is too small a pool to rank meaningfully against. Anything not listed here (a rare/legacy abbreviation) falls back to its own raw code rather than being silently dropped — see `positionGroupFor`. */
const POSITION_GROUP: Record<string, string> = {
  C: 'C',
  '1B': '1B',
  '2B': '2B',
  '3B': '3B',
  SS: 'SS',
  LF: 'OF',
  CF: 'OF',
  RF: 'OF',
  OF: 'OF',
  DH: 'DH',
};

function positionGroupFor(raw: string): string {
  return POSITION_GROUP[raw] ?? raw;
}

/**
 * Traditional season rates/counts — a separate, simpler ranker from the
 * Statcast composite above: no gating thresholds, no position split, all six
 * higher-is-better. Rides the same `getLeagueBatterSeasonRows` fetch and the
 * same 24h cache as the Statcast pool below rather than a new fetch/cache of
 * its own.
 */
export type BatterTraditionalKey = 'avg' | 'obp' | 'slg' | 'ops' | 'homeRuns' | 'rbi';

export const BATTER_TRADITIONAL_RANK_KEYS: ReadonlyArray<{ key: BatterTraditionalKey; label: string; decimals: number }> = [
  { key: 'avg', label: 'AVG', decimals: 3 },
  { key: 'obp', label: 'OBP', decimals: 3 },
  { key: 'slg', label: 'SLG', decimals: 3 },
  { key: 'ops', label: 'OPS', decimals: 3 },
  { key: 'homeRuns', label: 'HR', decimals: 0 },
  { key: 'rbi', label: 'RBI', decimals: 0 },
];

/** 1 = best, among every batter in `rows` that has a value for that stat. */
function rankBattersTraditional(rows: RawBatterSeasonLine[]): Map<number, Partial<Record<BatterTraditionalKey, number>>> {
  const ranks = new Map<number, Partial<Record<BatterTraditionalKey, number>>>(rows.map((r) => [r.personId, {}]));
  for (const { key } of BATTER_TRADITIONAL_RANK_KEYS) {
    const withValue = rows
      .filter((r) => r[key] != null)
      .sort((a, b) => (b[key] as number) - (a[key] as number));
    withValue.forEach((r, i) => {
      ranks.get(r.personId)![key] = i + 1;
    });
  }
  return ranks;
}

export interface RankedBatter {
  personId: number;
  fullName: string;
  teamId?: number;
  /** Grouped position (see `POSITION_GROUP`), not the raw StatsAPI abbreviation. */
  position: string;
  values: Partial<Record<BatterStatcastKey, number>>;
  overallRanks: Partial<Record<BatterStatcastKey, number>>;
  positionRanks: Partial<Record<BatterStatcastKey, number>>;
  /** Size of the whole qualified-batter pool this season (not position-scoped). */
  poolSize: number;
  /** Size of just this batter's position group. */
  positionPoolSize: number;
  /** 0-100, higher is better, against the whole pool — null when there aren't enough ranked stats to compute one. */
  composite: number | null;
  /** 1 = best against the whole pool. Null alongside a null composite. */
  overallRank: number | null;
  /** Same composite math, but scored only against this batter's position group. */
  positionComposite: number | null;
  /** 1 = best within this batter's position group. */
  positionRank: number | null;
  /** Traditional AVG/OBP/SLG/OPS/HR/RBI — see `BATTER_TRADITIONAL_RANK_KEYS`. Not position-scoped, not part of the Statcast composite. */
  traditionalValues: Partial<Record<BatterTraditionalKey, number>>;
  traditionalRanks: Partial<Record<BatterTraditionalKey, number>>;
  traditionalPoolSize: number;
}

export interface BatterRankings {
  season: number;
  computedAt: string;
  batters: RankedBatter[];
}

/**
 * Hand-set v1 weights — same "principled, not yet fit against real outcomes"
 * posture as pitcherRankings.ts's own weights. Barrel%/hard-hit% (batted-ball
 * authority) carry the most weight since they're the most direct read on
 * contact quality; exit velo overlaps with both so gets less independent
 * weight; whiff% (contact skill, not quality-of-contact) rounds it out.
 */
const COMPOSITE_WEIGHTS: Record<BatterStatcastKey, number> = {
  barrelPct: 0.3,
  hardHitPct: 0.3,
  exitVelo: 0.2,
  whiffPct: 0.2,
};

function compositeScore(ranks: Partial<Record<BatterStatcastKey, number>>, poolSize: number): number | null {
  if (poolSize <= 1) return null;
  // barrelPct/exitVelo/hardHitPct are gated together by the same battedBalls
  // threshold (MIN_BATTED_BALLS_FOR_QUALITY_RATE, savant.ts) — a batter has
  // all three or none. whiffPct alone (real swings, too few batted balls) is
  // a real number but too thin a profile to stand in for "quality of
  // contact": naive renormalization would let a 60-pitch September call-up's
  // lone elite whiff% outrank a full-season elite hitter on 100% weight
  // instead of the 20% it's actually worth. Requiring at least one of the
  // batted-ball trio keeps a composite from being computed on that alone.
  if (ranks.barrelPct == null && ranks.exitVelo == null && ranks.hardHitPct == null) return null;
  let weightedSum = 0;
  let weightUsed = 0;
  for (const [key, weight] of Object.entries(COMPOSITE_WEIGHTS) as [BatterStatcastKey, number][]) {
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
  rows: RawBatterSeasonLine[],
  rates: Map<number, StatcastBatterRates>,
): { ranked: RankedBatter[]; ranksByPersonId: Map<number, Partial<Record<BatterStatcastKey, number>>>; poolSize: number } {
  const scopedRates = new Map<number, StatcastBatterRates>();
  for (const row of rows) {
    const rate = rates.get(row.personId);
    if (rate) scopedRates.set(row.personId, rate);
  }
  const ranks = rankBatterStatcast(scopedRates);
  const poolSize = scopedRates.size;

  const ranked = rows
    .filter((row) => scopedRates.has(row.personId))
    .map((row): RankedBatter => {
      const values = scopedRates.get(row.personId)!;
      const personRanks = ranks.get(row.personId) ?? {};
      const composite = compositeScore(personRanks, poolSize);
      return {
        personId: row.personId,
        fullName: row.fullName,
        teamId: row.teamId,
        position: positionGroupFor(row.position),
        values,
        overallRanks: personRanks,
        positionRanks: {},
        poolSize,
        positionPoolSize: 0,
        composite,
        overallRank: null,
        positionComposite: null,
        positionRank: null,
        traditionalValues: {},
        traditionalRanks: {},
        traditionalPoolSize: 0,
      };
    });

  return { ranked, ranksByPersonId: ranks, poolSize };
}

const CACHE_TTL_MS = 24 * 60 * 60_000;

function cacheKey(season: number): string {
  return `mlb:batter-rankings:${season}`;
}

/** Position-and-overall-ranked, composite-scored batter pool — 24h cached so a normal page load never pays for a Statcast/StatsAPI refresh. `forceRefresh` bypasses the cache (used by a manual "refresh now" trigger). */
export async function getBatterRankings(season: number, forceRefresh = false): Promise<BatterRankings> {
  if (!forceRefresh) {
    const cached = await readSnapshotCache(cacheKey(season));
    if (cached) {
      const age = Date.now() - Date.parse(cached.fetchedAt);
      if (age < CACHE_TTL_MS) {
        return JSON.parse(cached.payload) as BatterRankings;
      }
    }
  }

  const [rows, rates] = await Promise.all([getLeagueBatterSeasonRows(season), getSeasonStatcastBatterRates(season)]);

  // Overall pool first — every qualified batter, whatever their position.
  const overall = buildPool(rows, rates);
  const overallByPersonId = new Map(overall.ranked.map((b) => [b.personId, b]));

  // Traditional AVG/OBP/SLG/OPS/HR/RBI — ranked against every batter with a
  // season row (not gated to the Statcast-qualified pool above, so a batter
  // who's played enough to have real season totals but hasn't cleared the
  // Statcast batted-ball thresholds still gets these).
  const traditionalPoolSize = rows.length;
  const traditionalRanksByPersonId = rankBattersTraditional(rows);
  for (const row of rows) {
    const batter = overallByPersonId.get(row.personId);
    if (!batter) continue;
    batter.traditionalValues = {
      avg: row.avg,
      obp: row.obp,
      slg: row.slg,
      ops: row.ops,
      homeRuns: row.homeRuns,
      rbi: row.rbi,
    };
    batter.traditionalRanks = traditionalRanksByPersonId.get(row.personId) ?? {};
    batter.traditionalPoolSize = traditionalPoolSize;
  }

  // Composite ties (common — several batters landing on the exact same
  // ordinal rank for most of their four component stats) break on pitches
  // seen, the closest proxy for playing time this pipeline has — same
  // "bigger, more trustworthy sample wins an identical score" reasoning as
  // pitcherRankings.ts's innings-pitched tiebreak.
  const sampleSizeOf = (personId: number) => rates.get(personId)?.pitchSampleSize ?? 0;
  overall.ranked.sort((a, b) => {
    const composite = (b.composite ?? -1) - (a.composite ?? -1);
    if (composite !== 0) return composite;
    return sampleSizeOf(b.personId) - sampleSizeOf(a.personId);
  });
  overall.ranked.forEach((b, i) => {
    b.overallRank = b.composite != null ? i + 1 : null;
  });

  // Position pools — same rows/rates, grouped and re-ranked within each group.
  const rowsByPosition = new Map<string, RawBatterSeasonLine[]>();
  for (const row of rows) {
    const group = positionGroupFor(row.position);
    const bucket = rowsByPosition.get(group) ?? [];
    bucket.push(row);
    rowsByPosition.set(group, bucket);
  }

  for (const positionRows of rowsByPosition.values()) {
    const positionPool = buildPool(positionRows, rates);
    positionPool.ranked.sort((a, b) => {
      const composite = (b.composite ?? -1) - (a.composite ?? -1);
      if (composite !== 0) return composite;
      return sampleSizeOf(b.personId) - sampleSizeOf(a.personId);
    });
    positionPool.ranked.forEach((posBatter, i) => {
      const overallBatter = overallByPersonId.get(posBatter.personId);
      if (!overallBatter) return;
      overallBatter.positionRanks = posBatter.overallRanks;
      overallBatter.positionPoolSize = positionPool.poolSize;
      overallBatter.positionComposite = posBatter.composite;
      overallBatter.positionRank = posBatter.composite != null ? i + 1 : null;
    });
  }

  const result: BatterRankings = { season, computedAt: new Date().toISOString(), batters: overall.ranked };
  await writeSnapshotCache(cacheKey(season), JSON.stringify(result));
  return result;
}

/**
 * Same bundle, but never recomputes — reads whatever's cached, however
 * stale, and returns null if nothing's been computed yet this season. Safe
 * to call from the live snapshot-build path, same reasoning as
 * `getCachedPitcherRoleRankings` (pitcherRankings.ts): `getBatterRankings`
 * itself can fall through to a live Statcast/StatsAPI fetch on a stale/cold
 * cache, which is fine for a manually-triggered refresh but not for a
 * function every scan request goes through.
 */
export async function getCachedBatterRankings(season: number): Promise<BatterRankings | null> {
  const cached = await readSnapshotCache(cacheKey(season));
  if (!cached) return null;
  try {
    return JSON.parse(cached.payload) as BatterRankings;
  } catch {
    return null;
  }
}
