/**
 * All 30 teams, grouped by league/division, with current standings.
 *
 * GET /api/mlb/teams
 *
 * The destination for the Teams top-nav tab and its index page. Split out
 * from the slate snapshot the same way injuries/recent/team are: Scan never
 * needs all 30 teams' identities, only the day's games.
 */

import { NextResponse } from 'next/server';
import { easternDate, getAllTeams, getStandings } from '@/lib/sports/mlb/statsapi';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { jsonPassthrough } from '@/lib/db/jsonPassthrough';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';

export const dynamic = 'force-dynamic';

function mlbTeamLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

const CACHE_KEY = 'mlb:teams';
// getAllTeams/getStandings already carry their own in-process TTL caches
// (12h / 30min, statsapi.ts), but that's a plain in-memory Map reset on every
// server restart — the first request after each restart still pays the full
// external-call cost (measured 8.8s cold vs 284ms warm-in-process). This
// DB-persisted layer survives restarts, same as the per-team route fix.
// TTL matches the fastest-changing constituent (standings, 30min) so this
// layer never serves data staler than what the underlying source promises.
const CACHE_TTL_MS = 30 * 60 * 1000;

async function buildTeamsPayload() {
  const season = Number(easternDate().slice(0, 4));
  const [teams, standings] = await Promise.all([getAllTeams(), getStandings(season)]);

  const rows = teams.map((t) => {
    const record = standings.get(t.id);
    return {
      teamId: t.id,
      name: t.name,
      abbreviation: t.abbreviation,
      logoUrl: mlbTeamLogoUrl(t.id),
      leagueName: record?.leagueName || t.leagueName,
      divisionName: record?.divisionName || t.divisionName,
      divisionShortName: record?.divisionShortName || t.divisionShortName,
      wins: record?.wins ?? 0,
      losses: record?.losses ?? 0,
      divisionRank: record?.divisionRank ?? '',
      gamesBack: record?.gamesBack ?? '-',
      lastTen: record?.lastTen ?? null,
    };
  });

  return { teams: rows, fetchedAt: new Date().toISOString() };
}

export async function GET() {
  async function rebuild() {
    const payload = await buildTeamsPayload();
    try { writeSnapshotCache(CACHE_KEY, JSON.stringify(payload)); } catch { /* ok */ }
    return payload;
  }

  try {
    const cached = readSnapshotCache(CACHE_KEY);
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

    if (cached && age < CACHE_TTL_MS) {
      return jsonPassthrough(cached.payload, 'hit');
    }
    if (cached) {
      triggerBackgroundRebuild(CACHE_KEY, rebuild);
      return jsonPassthrough(cached.payload, 'stale');
    }

    const payload = await awaitRebuild(CACHE_KEY, rebuild);
    return NextResponse.json(payload, { headers: { 'cache-control': 'no-store', 'x-cache': 'miss' } });
  } catch (error) {
    const stale = readSnapshotCache(CACHE_KEY);
    if (stale) return jsonPassthrough(stale.payload, 'stale');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Teams lookup failed' },
      { status: 502 },
    );
  }
}
