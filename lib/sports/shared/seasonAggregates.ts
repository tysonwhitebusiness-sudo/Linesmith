/**
 * Season aggregates with league-wide ranks, computed from
 * `player_game_history` — Phase 6.1b / 6.2b.
 *
 * WHY THIS EXISTS. Three shared blocks were blank on the same sports for the
 * same reason, and it was never a layout problem:
 *
 * - `GameDetailData.statComparison` — blank on NBA, NHL and tennis. Phase 6.2
 *   collapsed its two shapes into ranked rows; ranked rows need ranks, and
 *   those three sports had none.
 * - `TeamDetailData.statGroups` — the NBA and NHL adapters emit `[]`, which is
 *   why their team pages are the thinnest in the app.
 * - `TeamDetailData.unitGrades` — Phase 6.1 made the type fillable by any
 *   sport, but a grade is a composite of ranks, so NBA and NHL still had
 *   nothing to grade from.
 *
 * All three want one thing: *this entity's season totals, ranked against every
 * other entity in its league.* `player_game_history` already holds the raw
 * material — 2.75M rows, per player per game, sport-generic JSONB — and no
 * vendor is involved. What was missing is the rollup.
 *
 * ONE COMPUTATION, PER-SPORT SPECS. Same principle as the Python worker's
 * `run_provider_specs` and the frontend's sport adapters, both of which
 * `CLAUDE.md` already argues for: a sport declares WHAT it wants aggregated
 * and HOW its units are composed, and gets ranking, grading and grouping for
 * free. Adding a sport is a `SeasonAggregateSpec` — no new SQL, no new
 * ranking code, no new route.
 *
 * TEAM SPORTS AND INDIVIDUAL SPORTS ARE THE SAME SHAPE. `groupBy` is the only
 * difference: NBA and NHL roll up to `team_id`, tennis to `athlete_id`. A
 * tennis match compares two players the way an NBA game compares two teams, so
 * the same ranked rows render on the same block for both. Tennis genuinely has
 * no team (all 271,964 rows carry a null `team_id`) and this is what lets its
 * game page fill the block anyway.
 *
 * COST, MEASURED — not estimated. `player_game_history` is indexed
 * `(sport, athlete_id, season, game_date)`, so there is no index for a
 * team-season rollup and this is a scan of the sport's rows: **NHL 11.7s, NBA
 * 3.0s** against real Postgres. That is fine and it is exactly what
 * `cachedRoute` is for — stale-while-revalidate means one cold build pays it
 * and every later request is served from `snapshot_cache`. It is NOT fine to
 * call from a render path directly, so don't.
 *
 * NUMBERS ARE STORED AS FLOAT TEXT. `stats->>'match_won'` is `"0.0"`, not
 * `"0"`, so `::int` throws `invalid input syntax for type integer`. Every cast
 * here is `::numeric`. Found by having it throw.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import { unitGradeFromRanked, type UnitGrade } from './unitGrades';
import type { SeasonAggregateSpec, EntitySeasonAggregate, SeasonAggregateResult } from './seasonAggregateShapes';

export * from './seasonAggregateShapes';

/**
 * A stat key is interpolated into SQL, so it is constrained to what a JSON key
 * can safely be. Every value comes from a constant in this file today; this
 * guards the case where a future spec is built from anything less fixed.
 */
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeKeys(spec: SeasonAggregateSpec): void {
  for (const s of spec.stats) {
    if (!SAFE_KEY.test(s.statKey)) {
      throw new Error(`seasonAggregates: unsafe statKey ${JSON.stringify(s.statKey)} in spec for ${spec.sport}`);
    }
  }
}

interface RawRow {
  entity_id: string | null;
  games: string;
  through_date: string | Date | null;
  [statSum: string]: unknown;
}

/**
 * Ranks 1..n, 1 = best. Entities without a value for a stat are left unranked
 * rather than sorted to the bottom — an unranked stat is dropped from the
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

export async function computeSeasonAggregates(
  spec: SeasonAggregateSpec,
  season?: number,
): Promise<SeasonAggregateResult> {
  assertSafeKeys(spec);

  const resolvedSeason =
    season ??
    (
      await pgAll<{ season: number }>(
        `SELECT max(season) AS season FROM player_game_history WHERE sport = ?`,
        [spec.sport],
      )
    )[0]?.season;

  if (resolvedSeason == null) {
    return { sport: spec.sport, season: 0, poolSize: 0, byEntity: {}, throughDate: null, computedAt: new Date().toISOString() };
  }

  // One query, one scan. Every cast is ::numeric — see this file's header.
  const sums = spec.stats
    .map((s, i) => `COALESCE(SUM((stats->>'${s.statKey}')::numeric), 0) AS s${i}`)
    .join(',\n         ');

  const rows = await pgAll<RawRow>(
    `SELECT ${spec.groupBy} AS entity_id,
            COUNT(DISTINCT event_id) AS games,
            MAX(game_date) AS through_date,
            ${sums}
       FROM player_game_history
      WHERE sport = ? AND season = ? AND ${spec.groupBy} IS NOT NULL
            ${spec.excludeCompoundIds ? `AND ${spec.groupBy} NOT LIKE '%-%'` : ''}
      GROUP BY ${spec.groupBy}
     HAVING COUNT(DISTINCT event_id) >= ?`,
    [spec.sport, resolvedSeason, spec.minGames],
  );

  const entities = rows.map((r) => ({
    entityId: String(r.entity_id),
    games: Number(r.games),
    sums: spec.stats.map((_, i) => Number(r[`s${i}`] ?? 0)),
  }));
  const poolSize = entities.length;

  // Rank each stat across the whole pool before building any one entity's
  // rows — a rank is a statement about the league, not about the entity.
  const ranksByStat = spec.stats.map((s, i) => {
    const values = entities
      .filter((e) => (s.perGame ? e.games > 0 : true))
      .map((e) => ({ entityId: e.entityId, value: s.perGame ? e.sums[i] / e.games : e.sums[i] }));
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

  const throughDate = rows.reduce<string | null>((mx, r) => {
    const d = r.through_date instanceof Date ? r.through_date.toISOString().slice(0, 10) : (r.through_date ?? null);
    return d && (mx == null || d > mx) ? d : mx;
  }, null);

  return { sport: spec.sport, season: resolvedSeason, poolSize, byEntity, throughDate, computedAt: new Date().toISOString() };
}

