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
  /**
   * Take the MAX within one entity-game instead of the sum, then sum those
   * per-game maxima across the season.
   *
   * SOME KEYS ARE A TEAM FACT COPIED ONTO EVERY PLAYER ROW, and summing them
   * multiplies the answer by the size of the lineup. Measured on `soccer_epl`
   * 2025: summing `goalsConceded` gave one team 385 conceded across 38 matches
   * (10.1 per game); the per-game max gave 35. The definitive check is against
   * the other side of the same match -- a team's conceded must equal its
   * opponent's scored -- and **the per-game max matches in 722 of 760 pairs
   * while the sum matches in 194**, those 194 being the goalless games where
   * the two agree anyway. The ~5% that still differ are own goals, which count
   * as conceded but are credited to `ownGoals` rather than the opponent's
   * `totalGoals`.
   *
   * `shotsFaced` is the same shape and more obviously so: exactly one distinct
   * value per team-game, on every row.
   *
   * This is the same trap NBA's spec already documents for `plusMinus` -- it
   * was solved there by leaving the stat out. This flag is the alternative for
   * a stat worth keeping, and it is opt-in: a genuine per-player counting stat
   * (shots, tackles, yards) must stay a SUM or a team's total collapses to its
   * best individual's.
   */
  perGameMax?: boolean;
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
  /**
   * Team sports roll up to `team_id`; individual sports to `athlete_id`.
   *
   * `opponent_id` IS THE SAME ROLLUP READ FROM THE OTHER SIDE. Grouping the
   * identical rows by who the player was PLAYING AGAINST yields what that team
   * allowed -- no new table, no new query, no vendor. Measured 2026-08-30:
   * `opponent_id` is non-null on 100% of rows in every sport (NBA, NHL, CFB and
   * both soccer leagues checked), and NBA's best defence comes out at 107.1
   * points allowed per game, which is a real number for a real team.
   *
   * Never set this directly -- use `toAllowedSpec`, which also inverts every
   * stat's polarity. Allowing few points is good; the produced spec says the
   * opposite.
   */
  groupBy: 'team_id' | 'athlete_id' | 'opponent_id';
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


/** One entity's season totals, in `spec.stats` order, before any ranking. */
export interface EntitySums {
  entityId: string;
  games: number;
  /** Season totals, positionally matched to `spec.stats`. */
  sums: number[];
}

/**
 * Ranks 1..n, 1 = best. Entities without a value for a stat are left unranked
 * rather than sorted to the bottom: an unranked stat is dropped from the
 * output, because `OpposingStarterStat` has no "unranked" state and a
 * fabricated rank reads as a real placing.
 */
function rankValues(
  values: Array<{ entityId: string; value: number }>,
  lowerIsBetter: boolean,
): Map<string, number> {
  const sorted = [...values].sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value));
  const out = new Map<string, number>();
  sorted.forEach((v, i) => out.set(v.entityId, i + 1));
  return out;
}

/**
 * Season totals -> ranked, graded entities. The pure half of
 * `computeSeasonAggregates`, which does nothing but the SQL and then calls
 * this.
 *
 * SPLIT OUT SO THE NO-VARIANCE GUARD BELOW CAN BE TESTED WITHOUT A DATABASE.
 * The guard exists because of a real defect and a test that needs a live
 * Postgres is a test that does not run.
 */
export function rankPool(spec: SeasonAggregateSpec, entities: readonly EntitySums[]): Record<string, EntitySeasonAggregate> {
  const poolSize = entities.length;

  // Rank each stat across the whole pool before building any one entity's
  // rows: a rank is a statement about the league, not about the entity.
  //
  // A STAT WITH NO VARIANCE ACROSS THE POOL IS DROPPED, NOT RANKED. If every
  // entity holds the same value the ordering is arbitrary, and "1st of 20" is
  // a claim the data does not support. This is not hypothetical: `shotsFaced`
  // was declared in the soccer spec and is 0.0 on all 11,492 EPL rows, so with
  // `lowerIsBetter` it ranked all twenty teams joint-first at 0.0 -- a wrong
  // number on the page, which is worse than a blank one. A dead feed, a key
  // renamed upstream and a genuinely constant stat all arrive looking exactly
  // like this, and `SUM(NULL)` coalesced to 0 makes none of them throw.
  //
  // `< 2` distinct values, not `=== 0`: zero is only the commonest constant.
  const ranksByStat = spec.stats.map((s, i) => {
    const values = entities
      .filter((e) => (s.perGame ? e.games > 0 : true))
      .map((e) => ({ entityId: e.entityId, value: s.perGame ? e.sums[i] / e.games : e.sums[i] }));
    const distinct = new Set(values.map((v) => v.value));
    if (distinct.size < 2) return { values: new Map<string, number>(), ranks: new Map<string, number>() };
    return { values: new Map(values.map((v) => [v.entityId, v.value])), ranks: rankValues(values, s.lowerIsBetter === true) };
  });

  const byEntity: Record<string, EntitySeasonAggregate> = {};
  for (const e of entities) {
    const stats: OpposingStarterStat[] = [];
    for (let i = 0; i < spec.stats.length; i++) {
      const def = spec.stats[i];
      const value = ranksByStat[i].values.get(e.entityId);
      const rank = ranksByStat[i].ranks.get(e.entityId);
      if (value == null || rank == null || !Number.isFinite(value)) continue;
      stats.push({ key: def.key, label: def.label, value, decimals: def.decimals, rank, poolSize });
    }

    const statByKey = new Map(stats.map((s) => [s.key, s]));
    const units = spec.units
      .map((u) =>
        unitGradeFromRanked(
          { key: u.key, label: u.label, ...(u.short ? { short: u.short } : {}) },
          u.statKeys.map((k) => statByKey.get(k)).filter((s): s is OpposingStarterStat => s != null),
        ),
      )
      .filter((u): u is UnitGrade => u != null);

    byEntity[e.entityId] = { entityId: e.entityId, games: e.games, stats, units };
  }
  return byEntity;
}

/**
 * The "what this team ALLOWED" mirror of a produced spec.
 *
 * Two changes and nothing else:
 *
 * 1. `groupBy: 'opponent_id'` -- the same rows, grouped by who was played
 *    against rather than who was played for.
 * 2. **Every stat's polarity inverts.** This is the part that is easy to get
 *    wrong. On the produced side more points is better and more turnovers is
 *    worse; on the allowed side both flip -- a defence that gives up few points
 *    is good, and one that forces many turnovers is good too. A blanket
 *    inversion is therefore correct, not a shortcut, because `lowerIsBetter`
 *    already encodes the produced-side direction for every stat.
 *
 * LABELS ARE LEFT ALONE ON PURPOSE. The card that renders this names the
 * direction itself -- `subjectRoleLabel: 'Produces'` against
 * `opponentRoleLabel: 'Allows'` -- so rewriting "Points/game" into "Points
 * allowed/game" would say it twice and read worse in the one place it appears.
 * Keeping the keys identical also lets a card pair a produced row with its
 * allowed counterpart.
 */
export function toAllowedSpec(spec: SeasonAggregateSpec): SeasonAggregateSpec {
  return {
    ...spec,
    groupBy: 'opponent_id',
    stats: spec.stats.map((st) => ({ ...st, lowerIsBetter: st.lowerIsBetter !== true })),
  };
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
