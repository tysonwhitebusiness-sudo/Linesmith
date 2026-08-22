/**
 * Bullpen strength for exactly two teams — closer + top setup relievers.
 *
 * GET /api/mlb/bullpen?teamA=147&teamB=136
 *
 * Split out of the slate snapshot for the same reason `/api/mlb/recent` is:
 * Scan never shows this, only Game Detail does, and only for the two teams
 * on screen — no reason to cost the critical path of every scan refresh.
 * Wraps the already-24h-cached `getPitcherRoleRankings` (built for
 * `/diagnostics`) and filters its full ~536-pitcher league payload down to
 * just these two teams before it ever leaves the server.
 */

import { NextResponse } from 'next/server';
import { getPitcherRoleRankings, type RankedPitcher } from '@/lib/sports/mlb/pitcherRankings';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const SETUP_COUNT = 3;

// getPitcherRoleRankings already carries its own 24h SQLite-persisted cache
// (pitcherRankings.ts, key `mlb:pitcher-role-rankings:${season}` — distinct
// from this route's own key below, see CLAUDE.md's note on avoiding key
// collisions), but that layer is *blocking* on a miss: the first request of
// the day pays the full league-wide rankings cost. This outer layer adds
// real stale-while-revalidate on top of the per-team-pair slice — a stale
// hit serves instantly while a background rebuild refreshes it. TTL matches
// the inner layer so this never serves data staler than it already promises.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function bullpenFor(teamId: number, closers: RankedPitcher[], relievers: RankedPitcher[]) {
  const closer = closers.find((p) => p.raw.teamId === teamId) ?? null;
  const setup = relievers
    .filter((p) => p.raw.teamId === teamId)
    .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))
    .slice(0, SETUP_COUNT);
  return { closer, setup };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamA = Number(url.searchParams.get('teamA'));
  const teamB = Number(url.searchParams.get('teamB'));

  if (!Number.isFinite(teamA) || !Number.isFinite(teamB) || teamA <= 0 || teamB <= 0) {
    return NextResponse.json({ error: 'teamA and teamB are required' }, { status: 400 });
  }

  const season = Number(easternDate().slice(0, 4));

  return cachedRoute({
    cacheKey: `mlb:bullpen:route:${teamA}:${teamB}:${season}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const rankings = await getPitcherRoleRankings(season);
      return {
        [teamA]: bullpenFor(teamA, rankings.closers, rankings.relievers),
        [teamB]: bullpenFor(teamB, rankings.closers, rankings.relievers),
        computedAt: rankings.computedAt,
        season,
      };
    },
    errorMessage: 'Bullpen lookup failed',
    request,
  });
}
