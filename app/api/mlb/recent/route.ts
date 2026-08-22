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
  const teamA = Number(url.searchParams.get('teamA'));
  const teamB = Number(url.searchParams.get('teamB'));
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 25, 5), 60);

  if (!Number.isFinite(teamA) || !Number.isFinite(teamB) || teamA <= 0 || teamB <= 0) {
    return NextResponse.json({ error: 'teamA and teamB are required' }, { status: 400 });
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
