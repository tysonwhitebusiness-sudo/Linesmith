/**
 * Team-level grades — Offense / Defense / Special Teams, plus six position-
 * group grades (Secondary, Linebackers, D-Line, Passing/Rushing/Receiving
 * offense). Same weighted-percentile-composite math as
 * `nflPlayerRankings.ts` (itself a port of `lib/sports/mlb/batterRankings.ts`'s
 * real methodology), just pooling 32 teams instead of N players — no MLB
 * precedent exists for a team-level composite, so this is new, but reuses
 * the identical percentile/weight/rank machinery rather than inventing a
 * different scoring language.
 *
 * Offense/Defense reuse the real per-team ranks `getNflverseTeamStatsWithRank`/
 * `getTeamDefenseAllowedWithRank` already compute — no re-derivation.
 * Secondary/Linebackers/D-Line and Special Teams are new: real per-player
 * stats (`getPlayerSeasonStatsByGsis`, the same file `nflPlayerRankings.ts`
 * reads) aggregated by team + position pool, then ranked the same way.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import {
  getPlayerSeasonStatsByGsis,
  getNflverseTeamStatsWithRank,
  getTeamDefenseAllowedWithRank,
  getPointsPerGame,
  MOST_RECENT_STATS_SEASON,
  type NflverseTeamStatLine,
} from './nflverse';
import { POOL_BY_POSITION, type PoolKey } from './nflPlayerRankings';

export interface TeamGrade {
  grade: string;
  composite: number;
  rank: number;
  poolSize: number;
}

export interface TeamGrades {
  offense: TeamGrade | null;
  defense: TeamGrade | null;
  specialTeams: TeamGrade | null;
  secondary: TeamGrade | null;
  linebackers: TeamGrade | null;
  dLine: TeamGrade | null;
  passingOffense: TeamGrade | null;
  rushingOffense: TeamGrade | null;
  receivingOffense: TeamGrade | null;
}

// ---------------------------------------------------------------------------
// Shared composite + letter-grade machinery
// ---------------------------------------------------------------------------

function percentileOfRank(rank: number, poolSize: number): number {
  if (poolSize <= 1) return 100;
  return 100 * (1 - (rank - 1) / (poolSize - 1));
}

/**
 * Percentile-of-32-teams -> letter grade. Disclosed, not hidden: 11 buckets
 * across 32 teams means several teams legitimately share a grade, same as
 * any percentile-bucketed scale (e.g. a school curve).
 */
function letterGrade(percentile: number): string {
  if (percentile >= 95) return 'A+';
  if (percentile >= 85) return 'A';
  if (percentile >= 75) return 'A-';
  if (percentile >= 65) return 'B+';
  if (percentile >= 55) return 'B';
  if (percentile >= 45) return 'B-';
  if (percentile >= 35) return 'C+';
  if (percentile >= 25) return 'C';
  if (percentile >= 15) return 'C-';
  if (percentile >= 5) return 'D';
  return 'F';
}

interface WeightedStatDef {
  key: string;
  weight: number;
}

/** Composite + grade for every team, from a `team -> {statKey: rank}` map. */
function gradeTeams(ranksByTeam: Map<string, Record<string, number>>, defs: WeightedStatDef[], poolSize: number): Map<string, TeamGrade> {
  const composites = new Map<string, number>();
  for (const [team, ranks] of ranksByTeam) {
    let weightedSum = 0;
    let weightUsed = 0;
    for (const def of defs) {
      const rank = ranks[def.key];
      if (rank == null) continue;
      weightedSum += percentileOfRank(rank, poolSize) * def.weight;
      weightUsed += def.weight;
    }
    if (weightUsed > 0) composites.set(team, weightedSum / weightUsed);
  }

  const sorted = [...composites.entries()].sort((a, b) => b[1] - a[1]);
  const result = new Map<string, TeamGrade>();
  sorted.forEach(([team, composite], i) => {
    const rank = i + 1;
    result.set(team, { grade: letterGrade(percentileOfRank(rank, sorted.length)), composite, rank, poolSize: sorted.length });
  });
  return result;
}

function ranksFromStatLines(statLinesByTeam: Record<string, NflverseTeamStatLine[]>): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const [team, lines] of Object.entries(statLinesByTeam)) {
    out.set(team, Object.fromEntries(lines.map((l) => [l.key, l.rank])));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Offense / Defense — reuse the real per-team ranks already computed.
// ---------------------------------------------------------------------------

const OFFENSE_DEFS: WeightedStatDef[] = [
  { key: 'points-per-game', weight: 0.3 },
  { key: 'pass-yards', weight: 0.25 },
  { key: 'rush-yards', weight: 0.25 },
  { key: 'turnovers', weight: 0.2 },
];

const DEFENSE_DEFS: WeightedStatDef[] = [
  { key: 'points-allowed', weight: 0.3 },
  { key: 'pass-yards-allowed', weight: 0.25 },
  { key: 'rush-yards-allowed', weight: 0.25 },
  { key: 'takeaways', weight: 0.2 },
];

// ---------------------------------------------------------------------------
// Special teams — real per-player K/P/return stats, aggregated by team.
// ---------------------------------------------------------------------------

const ST_DEFS: WeightedStatDef[] = [
  { key: 'fg-pct', weight: 0.4 },
  { key: 'punt-net-avg', weight: 0.35 },
  { key: 'return-avg', weight: 0.25 },
];

async function computeSpecialTeamsRanks(season: string): Promise<Map<string, Record<string, number>>> {
  const statsByGsis = await getPlayerSeasonStatsByGsis(season);
  const byTeam = new Map<string, { fgMade: number; fgAtt: number; puntNetYards: number; puntAtt: number; returnYards: number; returns: number }>();
  for (const s of statsByGsis.values()) {
    const entry = byTeam.get(s.team) ?? { fgMade: 0, fgAtt: 0, puntNetYards: 0, puntAtt: 0, returnYards: 0, returns: 0 };
    entry.fgMade += s.fgMade;
    entry.fgAtt += s.fgAtt;
    entry.puntNetYards += s.puntNetYards;
    entry.puntAtt += s.puntAttempts;
    entry.returnYards += s.kickoffReturnYards + s.puntReturnYards;
    entry.returns += s.kickoffReturns + s.puntReturns;
    byTeam.set(s.team, entry);
  }

  const values = new Map<string, Record<string, number>>();
  for (const [team, e] of byTeam) {
    values.set(team, {
      'fg-pct': e.fgAtt > 0 ? e.fgMade / e.fgAtt : 0,
      'punt-net-avg': e.puntAtt > 0 ? e.puntNetYards / e.puntAtt : 0,
      'return-avg': e.returns > 0 ? e.returnYards / e.returns : 0,
    });
  }

  const ranksByTeam = new Map<string, Record<string, number>>([...values.keys()].map((t) => [t, {}]));
  for (const key of ['fg-pct', 'punt-net-avg', 'return-avg']) {
    const withValue = [...values.entries()].filter(([, v]) => v[key] > 0).sort((a, b) => b[1][key] - a[1][key]);
    withValue.forEach(([team], i) => { ranksByTeam.get(team)![key] = i + 1; });
  }
  return ranksByTeam;
}

// ---------------------------------------------------------------------------
// Secondary / Linebackers / D-Line — real per-player defensive stats,
// aggregated by team + position pool (same POOL_BY_POSITION grouping
// nflPlayerRankings.ts ranks individuals with).
// ---------------------------------------------------------------------------

const POSITION_GROUP_DEFS: Record<'CB' | 'S' | 'LB' | 'DL', WeightedStatDef[]> = {
  CB: [{ key: 'int-per-gm', weight: 0.35 }, { key: 'pd-per-gm', weight: 0.35 }, { key: 'tkl-per-gm', weight: 0.3 }],
  S: [{ key: 'int-per-gm', weight: 0.35 }, { key: 'tkl-per-gm', weight: 0.35 }, { key: 'pd-per-gm', weight: 0.3 }],
  LB: [{ key: 'tkl-per-gm', weight: 0.35 }, { key: 'sack-per-gm', weight: 0.25 }, { key: 'tfl-per-gm', weight: 0.25 }, { key: 'qbhit-per-gm', weight: 0.15 }],
  DL: [{ key: 'sack-per-gm', weight: 0.45 }, { key: 'qbhit-per-gm', weight: 0.3 }, { key: 'tfl-per-gm', weight: 0.25 }],
};

/** Secondary pools CB+S together for the team-level grade (a real defensive backfield is coached/evaluated as one unit); nflPlayerRankings.ts still ranks CB and S as separate individual pools — team and player groupings don't have to match 1:1. */
const TEAM_GROUP_BY_POOL: Partial<Record<PoolKey, 'CB' | 'S' | 'LB' | 'DL'>> = { CB: 'CB', S: 'S', LB: 'LB', DL: 'DL' };

async function computePositionGroupRanks(season: string, gamesByTeam: Map<string, number>): Promise<Record<'secondary' | 'linebackers' | 'dLine', Map<string, Record<string, number>>>> {
  const statsByGsis = await getPlayerSeasonStatsByGsis(season);

  const sums = new Map<string, { tkl: number; int: number; pd: number; sack: number; tfl: number; qbhit: number }>();
  const key = (team: string, group: string) => `${team}|${group}`;
  for (const s of statsByGsis.values()) {
    const pool = POOL_BY_POSITION[s.position];
    const group = pool ? TEAM_GROUP_BY_POOL[pool] : undefined;
    if (!group) continue;
    const k = key(s.team, group);
    const entry = sums.get(k) ?? { tkl: 0, int: 0, pd: 0, sack: 0, tfl: 0, qbhit: 0 };
    entry.tkl += s.defTacklesSolo + s.defTacklesAssist;
    entry.int += s.defInterceptions;
    entry.pd += s.defPassDefended;
    entry.sack += s.defSacks;
    entry.tfl += s.defTacklesForLoss;
    entry.qbhit += s.defQbHits;
    sums.set(k, entry);
  }

  function ranksFor(group: 'CB' | 'S' | 'LB' | 'DL'): Map<string, Record<string, number>> {
    const values = new Map<string, Record<string, number>>();
    for (const team of gamesByTeam.keys()) {
      const e = sums.get(key(team, group));
      const games = gamesByTeam.get(team) ?? 0;
      if (!e || games === 0) continue;
      values.set(team, {
        'tkl-per-gm': e.tkl / games,
        'int-per-gm': e.int / games,
        'pd-per-gm': e.pd / games,
        'sack-per-gm': e.sack / games,
        'tfl-per-gm': e.tfl / games,
        'qbhit-per-gm': e.qbhit / games,
      });
    }
    const ranksByTeam = new Map<string, Record<string, number>>([...values.keys()].map((t) => [t, {}]));
    for (const def of POSITION_GROUP_DEFS[group]) {
      const withValue = [...values.entries()].filter(([, v]) => v[def.key] > 0).sort((a, b) => b[1][def.key] - a[1][def.key]);
      withValue.forEach(([team], i) => { ranksByTeam.get(team)![def.key] = i + 1; });
    }
    return ranksByTeam;
  }

  return { secondary: ranksFor('CB'), linebackers: ranksFor('LB'), dLine: ranksFor('DL') };
}

// ---------------------------------------------------------------------------
// Passing / Rushing / Receiving offense — same real STAT_DEFS groups
// already shown as flat lists, turned into one composite grade each.
// ---------------------------------------------------------------------------

const PASSING_OFFENSE_DEFS: WeightedStatDef[] = [{ key: 'pass-yards', weight: 0.4 }, { key: 'pass-tds', weight: 0.35 }, { key: 'pass-epa', weight: 0.25 }];
const RUSHING_OFFENSE_DEFS: WeightedStatDef[] = [{ key: 'rush-yards', weight: 0.4 }, { key: 'rush-tds', weight: 0.35 }, { key: 'rush-epa', weight: 0.25 }];
const RECEIVING_OFFENSE_DEFS: WeightedStatDef[] = [{ key: 'receptions', weight: 1 }];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

async function computeAllTeamGrades(season: string): Promise<Record<string, TeamGrades>> {
  const [offenseLines, defenseLines, pointsByTeam] = await Promise.all([
    getNflverseTeamStatsWithRank(season),
    getTeamDefenseAllowedWithRank(season),
    getPointsPerGame(season),
  ]);

  const gamesByTeam = new Map<string, number>([...pointsByTeam.entries()].map(([team, p]) => [team, p.games]));

  // Points-allowed and takeaways aren't in the existing DEFENSE_STAT_DEFS/
  // STAT_DEFS shape (per-stat, not the whole-league rank this needs) — rank
  // them here from the same real per-team sources.
  const pointsAllowedRanks = new Map<string, Record<string, number>>();
  {
    const sorted = [...pointsByTeam.entries()].filter(([, p]) => p.games > 0).sort((a, b) => a[1].pa / a[1].games - b[1].pa / b[1].games);
    sorted.forEach(([team], i) => pointsAllowedRanks.set(team, { 'points-allowed': i + 1 }));
  }
  const takeawaysRanks = ranksFromStatLines(offenseLines); // 'def-interceptions' rank already computed there, reused as the takeaways proxy

  const offenseRanks = ranksFromStatLines(offenseLines);
  const defenseAllowedRanks = ranksFromStatLines(defenseLines);
  const combinedDefenseRanks = new Map<string, Record<string, number>>();
  for (const team of gamesByTeam.keys()) {
    combinedDefenseRanks.set(team, {
      'points-allowed': pointsAllowedRanks.get(team)?.['points-allowed'] as number,
      'pass-yards-allowed': defenseAllowedRanks.get(team)?.['pass-yards-allowed'] as number,
      'rush-yards-allowed': defenseAllowedRanks.get(team)?.['rush-yards-allowed'] as number,
      takeaways: takeawaysRanks.get(team)?.['def-interceptions'] as number,
    });
  }

  const positionGroups = await computePositionGroupRanks(season, gamesByTeam);
  const stRanks = await computeSpecialTeamsRanks(season);

  const poolSize = gamesByTeam.size;
  const offenseGrades = gradeTeams(offenseRanks, OFFENSE_DEFS, poolSize);
  const defenseGrades = gradeTeams(combinedDefenseRanks, DEFENSE_DEFS, poolSize);
  const stGrades = gradeTeams(stRanks, ST_DEFS, poolSize);
  const secondaryGrades = gradeTeams(positionGroups.secondary, POSITION_GROUP_DEFS.CB, poolSize);
  const lbGrades = gradeTeams(positionGroups.linebackers, POSITION_GROUP_DEFS.LB, poolSize);
  const dLineGrades = gradeTeams(positionGroups.dLine, POSITION_GROUP_DEFS.DL, poolSize);
  const passingGrades = gradeTeams(offenseRanks, PASSING_OFFENSE_DEFS, poolSize);
  const rushingGrades = gradeTeams(offenseRanks, RUSHING_OFFENSE_DEFS, poolSize);
  const receivingGrades = gradeTeams(offenseRanks, RECEIVING_OFFENSE_DEFS, poolSize);

  const result: Record<string, TeamGrades> = {};
  for (const team of gamesByTeam.keys()) {
    result[team] = {
      offense: offenseGrades.get(team) ?? null,
      defense: defenseGrades.get(team) ?? null,
      specialTeams: stGrades.get(team) ?? null,
      secondary: secondaryGrades.get(team) ?? null,
      linebackers: lbGrades.get(team) ?? null,
      dLine: dLineGrades.get(team) ?? null,
      passingOffense: passingGrades.get(team) ?? null,
      rushingOffense: rushingGrades.get(team) ?? null,
      receivingOffense: receivingGrades.get(team) ?? null,
    };
  }
  return result;
}

const CACHE_TTL_MS = 24 * 60 * 60_000;

function cacheKey(season: string): string {
  return `nfl:team-grades:${season}`;
}

export async function getAllTeamGrades(season: string = MOST_RECENT_STATS_SEASON, forceRefresh = false): Promise<Record<string, TeamGrades>> {
  if (!forceRefresh) {
    const cached = readSnapshotCache(cacheKey(season));
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
      return JSON.parse(cached.payload) as Record<string, TeamGrades>;
    }
  }
  const result = await computeAllTeamGrades(season);
  writeSnapshotCache(cacheKey(season), JSON.stringify(result));
  return result;
}

export function getCachedAllTeamGrades(season: string = MOST_RECENT_STATS_SEASON): Record<string, TeamGrades> | null {
  const cached = readSnapshotCache(cacheKey(season));
  if (!cached) return null;
  try {
    return JSON.parse(cached.payload) as Record<string, TeamGrades>;
  } catch {
    return null;
  }
}
