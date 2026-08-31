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
import { rankPool } from './seasonAggregateShapes';
import type { SeasonAggregateSpec, SeasonAggregateResult } from './seasonAggregateShapes';

export * from './seasonAggregateShapes';

/**
 * A stat key is interpolated into SQL, so it is constrained to what a JSON key
 * can safely be. Every value comes from a constant in this file today; this
 * guards the case where a future spec is built from anything less fixed.
 *
 * A DOT IS ALLOWED BECAUSE FOOTBALL'S KEYS CONTAIN ONE. `player_game_history`
 * stores NFL and CFB stats under keys like `passing.passingYards` and
 * `defensive.sacks` -- ESPN's own category-qualified names, stored verbatim.
 * The dot is part of the key, not a path: `stats->>'passing.passingYards'`
 * looks up that exact string, which is why it works and why nothing here needs
 * a `#>>` path operator. Verified against real rows before widening this.
 *
 * Widening to `.` does not widen the injection surface -- a quote, a backslash
 * and whitespace are all still rejected, which is what the interpolation
 * actually needs to be safe from.
 */
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;

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

export async function computeSeasonAggregates(
  spec: SeasonAggregateSpec,
  season?: number,
): Promise<SeasonAggregateResult> {
  assertSafeKeys(spec);

  const latestSeason =
    season ??
    (
      await pgAll<{ season: number }>(
        `SELECT max(season) AS season FROM player_game_history WHERE sport = ?`,
        [spec.sport],
      )
    )[0]?.season;

  if (latestSeason == null) {
    return { sport: spec.sport, season: 0, poolSize: 0, byEntity: {}, throughDate: null, computedAt: new Date().toISOString() };
  }

  // WALK BACK ONLY ON AN EMPTY POOL, never speculatively. A sport in mid-season
  // (NBA, tennis) resolves on the first attempt and pays nothing extra; only a
  // sport whose newest season is a stub pays a second scan, and those are
  // exactly the ones that would otherwise render nothing. An explicitly
  // requested `season` is honoured as asked -- a caller naming a year wants
  // that year, empty or not.
  let result = await aggregateOneSeason(spec, latestSeason);
  if (season == null) {
    for (let back = 1; result.poolSize === 0 && back <= SEASON_FALLBACK_ATTEMPTS; back++) {
      result = await aggregateOneSeason(spec, latestSeason - back);
    }
  }
  return result;
}

/**
 * How many seasons back to look when the newest one has no pool yet.
 *
 * A SEASON THAT HAS JUST STARTED PRODUCES AN EMPTY RANKING, SILENTLY. Measured
 * 2026-08-30: `max(season)` is 2026 for cfb, soccer_epl and soccer_mls, and
 * that season holds 8, 10 and 15 events respectively -- so no entity clears
 * `minGames`, the pool is zero, and the block renders empty rather than
 * erroring. Each of those sports has a complete 2025 season right behind it.
 *
 * Two extra attempts covers a sport whose newest season is a stub AND whose
 * previous one was short (a lockout, or a partial backfill). Three attempts
 * total, then give up honestly.
 */
const SEASON_FALLBACK_ATTEMPTS = 2;

async function aggregateOneSeason(spec: SeasonAggregateSpec, resolvedSeason: number): Promise<SeasonAggregateResult> {
  // TWO GROUPING LEVELS, ONE SCAN. The inner level collapses a team's player
  // rows to one row per game, so a stat carrying a TEAM fact on every player
  // row (`perGameMax` -- see its doc comment) is taken once instead of once per
  // man in the lineup. An ordinary summed stat is unaffected: the sum of
  // per-game sums is the season sum, so NBA/NHL/tennis produce exactly what
  // they produced before this shape existed.
  //
  // Every cast is ::numeric -- see this file's header.
  const perGameExpr = spec.stats
    .map((s, i) => `${s.perGameMax ? 'MAX' : 'SUM'}((stats->>'${s.statKey}')::numeric) AS g${i}`)
    .join(',\n              ');
  const sums = spec.stats.map((_, i) => `COALESCE(SUM(g${i}), 0) AS s${i}`).join(',\n            ');

  const rows = await pgAll<RawRow>(
    `WITH per_game AS (
       SELECT ${spec.groupBy} AS entity_id,
              event_id,
              MAX(game_date) AS game_date,
              ${perGameExpr}
         FROM player_game_history
        WHERE sport = ? AND season = ? AND ${spec.groupBy} IS NOT NULL
              ${spec.excludeCompoundIds ? `AND ${spec.groupBy} NOT LIKE '%-%'` : ''}
        GROUP BY ${spec.groupBy}, event_id
     )
     SELECT entity_id,
            COUNT(*) AS games,
            MAX(game_date) AS through_date,
            ${sums}
       FROM per_game
      GROUP BY entity_id
     HAVING COUNT(*) >= ?`,
    [spec.sport, resolvedSeason, spec.minGames],
  );

  const entities = rows.map((r) => ({
    entityId: String(r.entity_id),
    games: Number(r.games),
    sums: spec.stats.map((_, i) => Number(r[`s${i}`] ?? 0)),
  }));
  const byEntity = rankPool(spec, entities);

  const throughDate = rows.reduce<string | null>((mx, r) => {
    const d = r.through_date instanceof Date ? r.through_date.toISOString().slice(0, 10) : (r.through_date ?? null);
    return d && (mx == null || d > mx) ? d : mx;
  }, null);

  return { sport: spec.sport, season: resolvedSeason, poolSize: entities.length, byEntity, throughDate, computedAt: new Date().toISOString() };
}

