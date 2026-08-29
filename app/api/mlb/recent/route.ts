/**
 * Recent results and head-to-head for two specific teams.
 *
 * GET /api/mlb/recent?teamA=110&teamB=142&days=25
 *
 * Split out of the slate snapshot for the same reason `/api/mlb/injuries` is:
 * Scan never shows this, so it has no business costing the critical path of
 * every refresh. Game Detail asks for exactly the two teams it's displaying.
 * One schedule-window fetch serves both team's recent form *and* their
 * head-to-head this season, since head-to-head is just each team's results
 * filtered to games against the other.
 */

import { NextResponse } from 'next/server';
import { BadRequest, boundedInt, knownId } from '@/lib/apiValidation';
import { MLB_TEAM_IDS } from '@/lib/sports/mlb/teamAliases';
import { easternDate, getScheduleRange, shiftDate, extractTeamResults } from '@/lib/sports/mlb/statsapi';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// getScheduleRange already has its own 30-min in-process TTL cache
// (statsapi.ts, same one /api/mlb/team-form relies on) — reset on every
// server restart. TTL here matches it so this layer never serves data
// staler than what the underlying source promises.
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Task 3.5 — all three reach the cache key, so all three are bounded.
  // `days` was already clamped, which is why it is not the problem here; the
  // two team ids were not.
  let teamA: number, teamB: number, days: number;
  try {
    teamA = knownId(url.searchParams.get('teamA'), MLB_TEAM_IDS, 'teamA');
    teamB = knownId(url.searchParams.get('teamB'), MLB_TEAM_IDS, 'teamB');
    days = boundedInt(url.searchParams.get('days'), 5, 60, 25, 'days');
  } catch (error) {
    if (error instanceof BadRequest) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const today = easternDate();

  return cachedRoute({
    cacheKey: `mlb:recent:${teamA}:${teamB}:${days}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const games = await getScheduleRange(shiftDate(today, -days), today);
      const resultsA = extractTeamResults(games, teamA);
      const resultsB = extractTeamResults(games, teamB);

      return {
        [teamA]: {
          recent: resultsA.slice(0, 10),
          h2h: resultsA.filter((r) => r.opponentId === teamB),
        },
        [teamB]: {
          recent: resultsB.slice(0, 10),
          h2h: resultsB.filter((r) => r.opponentId === teamA),
        },
        windowDays: days,
        fetchedAt: new Date().toISOString(),
      };
    },
    errorMessage: 'Recent-results lookup failed',
    request,
  });
}
