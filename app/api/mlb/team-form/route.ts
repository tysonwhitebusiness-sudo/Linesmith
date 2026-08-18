/**
 * One team's season-to-date results.
 *
 * GET /api/mlb/team-form?teamId=116
 *
 * Split out the same way injuries/recent are — Scan never needs this, only
 * the Teams page's Moneyline/Total markets do. Reads the season from
 * opening day rather than a rolling N-day window (unlike /api/mlb/recent)
 * because these feed real L5/L10/L15/SZN tiles the same way a player's
 * gamelog does, and a player's SZN tile is genuinely season-to-date.
 * `getScheduleRange` caches by exact date range, so switching between teams
 * on the same page only pays for the schedule fetch once.
 */

import { NextResponse } from 'next/server';
import { easternDate, getScheduleRange, extractTeamResults } from '@/lib/sports/mlb/statsapi';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// getScheduleRange already has its own 30-min in-process TTL cache
// (statsapi.ts), but that's a plain in-memory Map — reset on every server
// restart, so the first request after a restart still pays the full
// opening-day-to-today schedule fetch (measured 10.5s). This DB-persisted
// layer survives restarts; TTL matches getScheduleRange's own 30-min TTL so
// it never serves data staler than the underlying source promises.
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));
  if (!Number.isFinite(teamId) || teamId <= 0) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `mlb:team-form:${teamId}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const today = easternDate();
      const season = today.slice(0, 4);
      const games = await getScheduleRange(`${season}-03-01`, today);
      const results = extractTeamResults(games, teamId);
      return { teamId, results, fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'Team form lookup failed',
  });
}
