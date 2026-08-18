/**
 * Team-level Statcast quality-of-contact rollup — what a team's batters
 * produce (offense) and what its pitching staff allows, each ranked among
 * all 30 teams. New territory on TeamDetail: `getTeamSeasonStats`'s
 * AVG/OBP/ERA/WHIP already covers the traditional team comparison there, and
 * `StandingsTables` covers win/loss — this only adds the four Statcast
 * metrics (barrel%/exit velo/hard-hit%/whiff%) neither of those touch.
 *
 * Not wired into the hot scan path — same "Game/Team Detail only" split as
 * /api/mlb/bullpen, which is why this safely calls the refreshing (not
 * cache-only) Statcast rate getters: a normal scan never pays for it, only a
 * Team Detail page load does.
 */

import {
  getLeagueBatterSeasonRows,
  getLeaguePitcherRolePools,
  PITCHER_RANK_LOWER_IS_BETTER,
  type PitcherRankKey,
} from './statsapi';
import {
  getSeasonStatcastBatterRates,
  getSeasonStatcastPitcherRates,
  BATTER_STATCAST_RANK_KEYS,
  BATTER_STATCAST_LOWER_IS_BETTER,
  type BatterStatcastKey,
} from './savant';

/** Same tile shape as `OpposingStarterStat` (adapter.ts/PlayerDetail.tsx) — value + rank/poolSize, not a gradient-fill rate — so the UI can render both with one bit of JSX. */
export interface TeamStatcastTile {
  key: string;
  label: string;
  value: number;
  decimals: number;
  rank: number;
  poolSize: number;
}

/** Statcast metrics as something a pitching staff *allowed*, mirroring `pitcherStatPhrase`'s wording in adapter.ts (not exported from there, so restated here rather than reached across files for four short strings). */
const PITCHING_ALLOWED_KEYS: ReadonlyArray<{ key: PitcherRankKey; label: string; decimals: number }> = [
  { key: 'barrelPct', label: 'barrel% allowed', decimals: 1 },
  { key: 'exitVelo', label: 'avg exit velocity allowed', decimals: 1 },
  { key: 'hardHitPct', label: 'hard-hit% allowed', decimals: 1 },
  { key: 'whiffPct', label: 'whiff% induced', decimals: 1 },
];

/**
 * Unweighted mean of each qualifying player's own rate, grouped by team —
 * a simpler v1 than pooling raw barrel/battedBall counts (which would need
 * savant.ts to export its internal per-player counters, not just rates), in
 * the same "principled, not fit against outcomes" spirit as this codebase's
 * other hand-set approximations (see savant.ts's barrel-definition comment).
 */
function meanByTeam<Key extends string>(
  rates: Map<number, Partial<Record<Key, number>>>,
  teamIdByPerson: Map<number, number>,
  keys: readonly Key[],
): Map<number, Partial<Record<Key, number>>> {
  const sums = new Map<number, Map<Key, { total: number; count: number }>>();
  for (const [personId, rate] of rates) {
    const teamId = teamIdByPerson.get(personId);
    if (teamId == null) continue;
    let bucket = sums.get(teamId);
    if (!bucket) {
      bucket = new Map();
      sums.set(teamId, bucket);
    }
    for (const key of keys) {
      const value = rate[key];
      if (value == null) continue;
      const cell = bucket.get(key) ?? { total: 0, count: 0 };
      cell.total += value;
      cell.count += 1;
      bucket.set(key, cell);
    }
  }

  const out = new Map<number, Partial<Record<Key, number>>>();
  for (const [teamId, bucket] of sums) {
    const values: Partial<Record<Key, number>> = {};
    for (const [key, cell] of bucket) values[key] = cell.total / cell.count;
    out.set(teamId, values);
  }
  return out;
}

/** Ranks each team's rolled-up rate among every other team with a value for that stat, 1 = best — same ordinal mechanic as `rankTeams`/`rankPitchers`/`rankBatterStatcast`. */
function rankTeamsByKey<Key extends string>(
  meansByTeam: Map<number, Partial<Record<Key, number>>>,
  keys: readonly { key: Key; label: string; decimals: number }[],
  lowerIsBetter: ReadonlySet<Key>,
): Map<number, TeamStatcastTile[]> {
  const poolSize = meansByTeam.size;
  const ranksByKey = new Map<Key, Map<number, number>>();

  for (const { key } of keys) {
    const withValue = [...meansByTeam.entries()]
      .filter(([, v]) => v[key] != null)
      .sort((a, b) => {
        const av = a[1][key] as number;
        const bv = b[1][key] as number;
        return lowerIsBetter.has(key) ? av - bv : bv - av;
      });
    const rankMap = new Map<number, number>();
    withValue.forEach(([teamId], index) => rankMap.set(teamId, index + 1));
    ranksByKey.set(key, rankMap);
  }

  const out = new Map<number, TeamStatcastTile[]>();
  for (const [teamId, values] of meansByTeam) {
    const tiles = keys
      .map(({ key, label, decimals }): TeamStatcastTile | null => {
        const value = values[key];
        const rank = ranksByKey.get(key)?.get(teamId);
        if (value == null || rank == null) return null;
        return { key, label, value, decimals, rank, poolSize };
      })
      .filter((t): t is TeamStatcastTile => t != null);
    out.set(teamId, tiles);
  }
  return out;
}

export interface TeamStatcastRollup {
  season: number;
  computedAt: string;
  hittingByTeam: Map<number, TeamStatcastTile[]>;
  pitchingByTeam: Map<number, TeamStatcastTile[]>;
}

export async function getTeamStatcastRollup(season: number): Promise<TeamStatcastRollup> {
  const [batterRows, pitcherPools, batterRates, pitcherRates] = await Promise.all([
    getLeagueBatterSeasonRows(season),
    getLeaguePitcherRolePools(season),
    getSeasonStatcastBatterRates(season),
    getSeasonStatcastPitcherRates(season),
  ]);

  const batterTeamIds = new Map<number, number>();
  for (const b of batterRows) {
    if (b.teamId != null) batterTeamIds.set(b.personId, b.teamId);
  }

  const pitcherTeamIds = new Map<number, number>();
  for (const p of [...pitcherPools.starters, ...pitcherPools.closers, ...pitcherPools.relievers]) {
    if (p.raw.teamId != null) pitcherTeamIds.set(p.raw.personId, p.raw.teamId);
  }

  const hittingMeans = meanByTeam<BatterStatcastKey>(
    batterRates as Map<number, Partial<Record<BatterStatcastKey, number>>>,
    batterTeamIds,
    BATTER_STATCAST_RANK_KEYS.map((k) => k.key),
  );
  const pitchingMeans = meanByTeam<PitcherRankKey>(
    pitcherRates as Map<number, Partial<Record<PitcherRankKey, number>>>,
    pitcherTeamIds,
    PITCHING_ALLOWED_KEYS.map((k) => k.key),
  );

  const hittingByTeam = rankTeamsByKey(hittingMeans, BATTER_STATCAST_RANK_KEYS, BATTER_STATCAST_LOWER_IS_BETTER);
  const pitchingByTeam = rankTeamsByKey(pitchingMeans, PITCHING_ALLOWED_KEYS, PITCHER_RANK_LOWER_IS_BETTER);

  return { season, computedAt: new Date().toISOString(), hittingByTeam, pitchingByTeam };
}
