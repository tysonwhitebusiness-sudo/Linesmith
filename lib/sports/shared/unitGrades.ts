/**
 * The sport-neutral unit grade — Phase 6.1.
 *
 * WHAT THIS REPLACES. `TeamGrades` (lib/sports/nfl/nflTeamGrades.ts) is a
 * struct with **nine hardcoded NFL unit names** (`offense`, `defense`,
 * `specialTeams`, `secondary`, `linebackers`, `dLine`, `passingOffense`,
 * `rushingOffense`, `receivingOffense`). It was the type behind three fields
 * on two shared interfaces — `TeamDetailData.grades`,
 * `GameDetailData.unitGrades` and `GameDetailData.hero.awayGrades`/
 * `homeGrades` — which meant **no sport other than NFL could ever fill any of
 * them**, and all three sat permanently `null` on six sports' pages. MLB's own
 * adapter comment said so outright: "MLB has no grading model, always null."
 *
 * That was never true. MLB has league-wide *ranked* team Statcast metrics
 * (`teamStatcast.hitting`/`.pitching`, each tile carrying a real `rank` and
 * `poolSize`) — the exact input NFL's own grades are computed from. What MLB
 * lacked was a type that could say "Hitting" and "Pitching" instead of
 * "secondary" and "dLine".
 *
 * So a unit is now `{ key, label, grade, ... }` in an ordered array, and each
 * sport names its own units: NFL keeps its nine, MLB declares Hitting and
 * Pitching, NHL will declare offence/defence/power play/penalty kill once
 * 6.1b gives it a league-wide ranked aggregate to grade from. Nothing in the
 * shared components knows any of those names.
 *
 * WHY AN ARRAY AND NOT A WIDER STRUCT. A struct with every sport's units on it
 * is the same mistake one size larger — every sport would carry seven other
 * sports' `null`s, and adding a ninth sport would edit a type three sports
 * away from it. The array is ordered by the adapter, and order is the only
 * thing the renderers rely on.
 *
 * NOT FABRICATED. Per CLAUDE.md's sport-adapter §2, a sport emits only the
 * units it has real ranked data for. MLB emits two, not a padded four. A sport
 * with none emits `null`, and the section does not render — same contract as
 * before, just no longer NFL-shaped.
 */

export interface UnitGrade {
  /** Stable per-sport identifier ('offense', 'hitting', 'powerPlay'). Unique within one sport's array; never compared across sports. */
  key: string;
  /** Full display label, rendered as-is by the grades table ('Special teams', 'Pitching'). */
  label: string;
  /**
   * Compact form for the header chip row (NFL's `OFF`/`DEF`/`ST`, MLB's
   * `HIT`/`PIT`). **Presence is the switch**: a unit with a `short` appears in
   * that row, one without appears only in the full table. That replaces
   * `TeamDetail.tsx`'s three hardcoded `<GradeChip label="OFF" ...>` calls
   * with a data-driven filter, so the adapter — not the component — decides
   * which of a sport's units are headline-worthy.
   */
  short?: string;
  /** Letter grade off `letterFromPercentile`. Already bucketed; renderers never re-derive it. */
  grade: string;
  /** 0–100 percentile this grade was bucketed from. Kept so a consumer can sort or colour by strength without re-deriving from rank. */
  composite: number;
  /**
   * Rank within `poolSize`. For a unit composited from several ranked stats
   * this is the percentile converted back to a rank, not any one stat's own —
   * see `unitGradeFromRanked`. Honest as "this unit sits where the Nth of M
   * teams sits", which is what the chip's tooltip claims.
   */
  rank: number;
  poolSize: number;
}

/** Where a rank sits in its pool, as a 0–100 percentile (rank 1 = 100). */
export function percentileOfRank(rank: number, poolSize: number): number {
  if (poolSize <= 1) return 100;
  return 100 * (1 - (rank - 1) / (poolSize - 1));
}

/** Inverse of `percentileOfRank` — used to give a composited unit an honest rank to display. */
export function rankOfPercentile(percentile: number, poolSize: number): number {
  if (poolSize <= 1) return 1;
  return Math.round(1 + (1 - percentile / 100) * (poolSize - 1));
}

/**
 * Percentile -> letter grade. Moved here verbatim from `nflTeamGrades.ts` so
 * every sport buckets identically; that file now re-exports it rather than
 * keeping a second copy, since two scales drifting apart would make an MLB
 * "B+" and an NFL "B+" mean different things on the same game page.
 *
 * Disclosed, not hidden: 11 buckets across a 30-ish team pool means several
 * teams legitimately share a grade, same as any percentile-bucketed scale.
 */
export function letterFromPercentile(percentile: number): string {
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

/** A ranked stat row — the shape `OpposingStarterStat` and `TeamStatcastTile` already share. */
export interface RankedStatLike {
  rank?: number | null;
  poolSize?: number | null;
}

/**
 * Composite a unit grade from however many ranked stats measure it.
 *
 * Averages the stats' percentiles rather than their ranks, because ranks from
 * pools of different sizes are not on the same scale — MLB's 30-team Statcast
 * pool and a 32-team pool would otherwise weight differently for no reason.
 *
 * Returns `null` when no row carries a usable rank, which is the "don't
 * fabricate a unit" case: a sport calling this for a unit it has no data for
 * gets nothing back and simply omits it.
 */
export function unitGradeFromRanked(
  unit: { key: string; label: string; short?: string },
  rows: readonly RankedStatLike[],
): UnitGrade | null {
  const usable = rows.filter(
    (r): r is { rank: number; poolSize: number } =>
      typeof r.rank === 'number' && Number.isFinite(r.rank) && typeof r.poolSize === 'number' && r.poolSize > 1,
  );
  if (usable.length === 0) return null;

  const percentile = usable.reduce((sum, r) => sum + percentileOfRank(r.rank, r.poolSize), 0) / usable.length;
  // Largest pool of the contributing stats — the one a displayed rank should
  // be read against, and the only choice that can't understate the field.
  const poolSize = usable.reduce((mx, r) => Math.max(mx, r.poolSize), 0);

  return {
    key: unit.key,
    label: unit.label,
    ...(unit.short ? { short: unit.short } : {}),
    grade: letterFromPercentile(percentile),
    composite: percentile,
    rank: rankOfPercentile(percentile, poolSize),
    poolSize,
  };
}

/** Lookup by key. Adapters that map a stat group to the unit measuring it use this instead of struct field access. */
export function findUnit(units: readonly UnitGrade[] | null | undefined, key: string): UnitGrade | null {
  return units?.find((u) => u.key === key) ?? null;
}

/**
 * Every unit key present across two teams, in the order the away side
 * declares them, with anything only the home side has appended.
 *
 * The game page's grades table renders one row per unit across both teams, and
 * either side can be missing a unit the other has (a team with no ranked
 * bullpen data, say). Replaces `GameDetail.tsx`'s `GRADE_ROWS` constant, which
 * was a hardcoded list of NFL's nine.
 */
export function mergeUnitRows(
  away: readonly UnitGrade[] | null,
  home: readonly UnitGrade[] | null,
): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const u of [...(away ?? []), ...(home ?? [])]) {
    if (seen.has(u.key)) continue;
    seen.add(u.key);
    out.push({ key: u.key, label: u.label });
  }
  return out;
}
