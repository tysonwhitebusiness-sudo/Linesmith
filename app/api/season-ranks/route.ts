/**
 * Season aggregates with league-wide ranks, for one sport.
 *
 * GET /api/season-ranks?sport=nhl
 * GET /api/season-ranks?sport=tennis_atp&season=2026
 *
 * ONE ROUTE, SPORT AS A QUERY PARAM — deliberately not `/api/[sport]/...`.
 * `app/api/` already has real static segments for `mlb`, `nfl`, `nba`, `nhl`,
 * `cfb`, `soccer`, `tennis` and `golf`; a dynamic sibling at the same level
 * would sit alongside all of them and swallow every unrecognised path under
 * `/api/`. The query param keeps the route tree unambiguous, and the sport is
 * validated against the spec registry before it can reach a cache key.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md's API-route convention.
 * This genuinely needs it: `player_game_history` is indexed
 * `(sport, athlete_id, season, game_date)` with no index serving a
 * team-season rollup, so the build is a scan of the sport's rows — **measured
 * 11.7s for NHL, 3.0s for NBA** against real Postgres. Stale-while-revalidate
 * means one cold build pays that and every later request is served from
 * `snapshot_cache`.
 *
 * TTL is 6 hours, grounded in how fast the underlying data actually moves: a
 * season aggregate only changes when games finish and
 * `genericPlayerHistoryFreshnessJob` writes their box scores (itself on a
 * 30-minute cadence, `LOOKBACK_DAYS=3`). Six hours is also generous in the
 * other direction — NBA and NHL are out of season as of 2026-08-30 (last games
 * 2026-04-13 and 2025-04-17), so their aggregates are frozen and every rebuild
 * recomputes an identical answer.
 *
 * CACHE KEY: `season-ranks:{sport}:{season}` — grepped before choosing, per
 * CLAUDE.md's warning about the flat `snapshot_cache` namespace. Nothing else
 * in `lib/` or `app/` uses a `season-ranks:` prefix.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { computeSeasonAggregates } from '@/lib/sports/shared/seasonAggregates';
import { SEASON_AGGREGATE_SPECS, SEASON_AGGREGATE_SPORTS } from '@/lib/sports/shared/seasonAggregateSpecs';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Bounded before it reaches a cache key — task 3.5's lesson: an unbounded id mints a permanent cache row per value. */
function parseSeason(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return null;
  return n;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const spec = SEASON_AGGREGATE_SPECS[sport];
  if (!spec) {
    return NextResponse.json(
      { error: `Unknown sport. Expected one of: ${SEASON_AGGREGATE_SPORTS.join(', ')}` },
      { status: 400 },
    );
  }

  const rawSeason = url.searchParams.get('season');
  if (rawSeason != null && parseSeason(rawSeason) == null) {
    return NextResponse.json({ error: 'season must be a year between 2000 and 2100' }, { status: 400 });
  }
  const season = parseSeason(rawSeason);

  return cachedRoute({
    cacheKey: `season-ranks:${sport}:${season ?? 'latest'}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'season-ranks',
    build: () => computeSeasonAggregates(spec, season ?? undefined),
    errorMessage: 'Season rank computation failed',
    request,
  });
}
