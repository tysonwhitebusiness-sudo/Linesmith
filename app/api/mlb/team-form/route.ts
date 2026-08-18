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
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { jsonPassthrough } from '@/lib/db/jsonPassthrough';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';

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

  const cacheKey = `mlb:team-form:${teamId}`;

  async function rebuild() {
    const today = easternDate();
    const season = today.slice(0, 4);
    const games = await getScheduleRange(`${season}-03-01`, today);
    const results = extractTeamResults(games, teamId);
    const payload = { teamId, results, fetchedAt: new Date().toISOString() };
    try { writeSnapshotCache(cacheKey, JSON.stringify(payload)); } catch { /* ok */ }
    return payload;
  }

  try {
    const cached = readSnapshotCache(cacheKey);
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

    if (cached && age < CACHE_TTL_MS) {
      return jsonPassthrough(cached.payload, 'hit');
    }
    if (cached) {
      triggerBackgroundRebuild(cacheKey, rebuild);
      return jsonPassthrough(cached.payload, 'stale');
    }

    const started = Date.now();
    const payload = await awaitRebuild(cacheKey, rebuild);
    return NextResponse.json(payload, {
      headers: { 'cache-control': 'no-store', 'x-cache': 'miss', 'x-elapsed-ms': String(Date.now() - started) },
    });
  } catch (error) {
    console.error('[api/mlb/team-form]', error);
    const stale = readSnapshotCache(cacheKey);
    if (stale) return jsonPassthrough(stale.payload, 'stale');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Team form lookup failed' },
      { status: 502 },
    );
  }
}
