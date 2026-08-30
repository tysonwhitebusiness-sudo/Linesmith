/**
 * Season-aggregate SHAPES and pure shaping helpers — Phase 6.1b/6.2b.
 *
 * SPLIT OUT OF `seasonAggregates.ts` BECAUSE THAT FILE REACHES THE DATABASE.
 * It imports `pgAll`, which pulls in `pg`, which needs `dns`/`fs`/`net`/`tls`.
 * The NBA, NHL and tennis adapters need `toStatComparisonGroups` and
 * `groupStats` — and those adapters are imported by `GameDetail.tsx` and
 * `TeamDetail.tsx`, both `'use client'`. A single VALUE import from a
 * db-touching module was therefore enough to drag `pg` into the browser
 * bundle, and the whole app 500ed with `Module not found: Can't resolve 'dns'`.
 *
 * `tsc --noEmit` passes that happily — it is a bundling boundary, not a type
 * error. Only a real build or a running dev server surfaces it.
 *
 * So: types and pure functions live here and are safe to import anywhere;
 * `computeSeasonAggregates` stays in `seasonAggregates.ts` and is server-only.
 */

import type { OpposingStarterStat } from '@/components/PlayerDetail';
import { unitGradeFromRanked, type UnitGrade } from './unitGrades';

/** One aggregated, rankable stat. */
export interface SeasonStatDef {
  /** Stable identifier used by `statComparison` rows and by a unit's `statKeys`. */
  key: string;
  label: string;
  /** The key inside `player_game_history.stats` to sum. */
  statKey: string;
  decimals: number;
  /**
   * Rank the season total divided by games played, not the raw total. Almost
   * always what you want: a team that has played 82 games is not "better" at
   * scoring than one that has played 71 because its total is larger.
   */
  perGame: boolean;
  /** A lower number is better (turnovers, penalty minutes, games lost). */
  lowerIsBetter?: boolean;
  /** Heading this stat renders under in `statComparison`. */
  group: string;
}

export interface SeasonUnitDef {
  key: string;
  label: string;
  /** Present = this unit appears in the compact header chip row. See `UnitGrade.short`. */
  short?: string;
  /** The `SeasonStatDef.key`s whose ranks composite into this unit's grade. */
  statKeys: string[];
}

export interface SeasonAggregateSpec {
  /** The `player_game_history.sport` value — note `soccer_epl`/`tennis_atp`, not `soccer`/`tennis`. */
  sport: string;
  /** Team sports roll up to `team_id`; individual sports to `athlete_id`. */
  groupBy: 'team_id' | 'athlete_id';
  /**
   * Minimum games before an entity enters the ranking pool. Keeps a player
   * with two matches from ranking first on a rate stat — which would be a
   * wrong number displayed, not just a noisy one.
   */
  minGames: number;
  stats: SeasonStatDef[];
  units: SeasonUnitDef[];
  /**
   * Drop entity ids containing a hyphen.
   *
   * TENNIS DOUBLES. `player_game_history` stores a doubles pairing as a single
   * compound `athlete_id` — `2725-2434`, two player ids joined — and **19% of
   * ATP rows are doubles**: 25,010 of 129,812, across 6,025 distinct pairings.
   * Left in, they enter the same ranking pool as singles players, where they
   * are not comparable at all: a doubles pair wins far more games per match
   * because the format is different. Measured, the ATP pool went from 412
   * entities to 349 once they were excluded — 63 of the "players" a singles
   * match was being ranked against were pairs.
   *
   * A wrong rank is worse than a missing one, which is why this is a filter
   * rather than something the caller is trusted to remember.
   */
  excludeCompoundIds?: boolean;
}

export interface EntitySeasonAggregate {
  entityId: string;
  games: number;
  /** Ranked rows, in spec order. Ready for `statComparison` and `statGroups`. */
  stats: OpposingStarterStat[];
  /** Composited unit grades, in spec order. Ready for `unitGrades`. */
  units: UnitGrade[];
}

export interface SeasonAggregateResult {
  sport: string;
  season: number;
  /** How many entities cleared `minGames` — the pool every rank below is against. */
  poolSize: number;
  byEntity: Record<string, EntitySeasonAggregate>;
  /** Newest `game_date` in the aggregated season, so a page can say how current this is. */
  throughDate: string | null;
  computedAt: string;
}


/** Rows for one entity, grouped by each stat's `group`, ready for `statGroups`/`statComparison`. */
export function groupStats(
  spec: SeasonAggregateSpec,
  stats: readonly OpposingStarterStat[],
): Array<{ label: string; stats: OpposingStarterStat[] }> {
  const groupOf = new Map(spec.stats.map((s) => [s.key, s.group]));
  const order: string[] = [];
  const bucket = new Map<string, OpposingStarterStat[]>();
  for (const s of stats) {
    const g = groupOf.get(s.key) ?? 'Season';
    if (!bucket.has(g)) {
      bucket.set(g, []);
      order.push(g);
    }
    bucket.get(g)!.push(s);
  }
  return order.map((label) => ({ label, stats: bucket.get(label)! }));
}

/**
 * Two entities' rows zipped into `StatComparisonData.ranked`.
 *
 * `home` is required and `away` optional, matching the field's own shape — a
 * stat only one side has ranked renders one-sided rather than dropping the row.
 */
export function toStatComparisonGroups(
  spec: SeasonAggregateSpec,
  away: EntitySeasonAggregate | null | undefined,
  home: EntitySeasonAggregate | null | undefined,
): Array<{ label: string; rows: Array<{ key: string; label: string; away?: OpposingStarterStat; home: OpposingStarterStat }> }> {
  if (!home) return [];
  const awayByKey = new Map((away?.stats ?? []).map((s) => [s.key, s]));
  return groupStats(spec, home.stats).map((g) => ({
    label: g.label,
    rows: g.stats.map((h) => ({ key: h.key, label: h.label, away: awayByKey.get(h.key), home: h })),
  }));
}
