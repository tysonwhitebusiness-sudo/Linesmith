/**
 * Team identity, record and active roster with season stats.
 *
 * GET /api/mlb/team/116
 *
 * Split out from the slate snapshot the same way injuries/recent are: this
 * costs a roster call plus a couple of batched people calls, none of which
 * Scan needs. The Teams page asks for exactly the one team it's showing, and
 * needs this regardless of whether that team has a game today — the slate
 * snapshot's per-game team context only exists for teams actually playing.
 */

import { NextResponse } from 'next/server';
import { BadRequest, knownId } from '@/lib/apiValidation';
import { MLB_TEAM_IDS } from '@/lib/sports/mlb/teamAliases';
import {
  easternDate,
  getTeamInfo,
  getActiveRoster,
  getStandings,
  getPeopleSeasonStats,
} from '@/lib/sports/mlb/statsapi';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// This route's own 4 external calls each already have an in-process TTL
// cache in statsapi.ts (team-info 12h, roster-active 1h, standings 30min,
// people-season-stats 1h) — but that cache is a plain in-memory Map, reset
// on every server restart, so the *first* request after a restart still
// pays the full external-call cost (measured 16.2s). This DB-persisted
// layer survives restarts the same way /api/mlb and /api/nfl already do.
// TTL matches the fastest-changing constituent (standings, 30min) so this
// layer never serves data staler than what the underlying source promises.
const CACHE_TTL_MS = 30 * 60 * 1000;

function mlbHeadshotUrl(personId: number): string {
  return (
    'https://img.mlbstatic.com/mlb-photos/image/upload/' +
    'w_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/' +
    `v1/people/${personId}/headshot/67/current`
  );
}

function mlbTeamLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

/** Null return means "team not found" — deliberately not cached (a bad teamId shouldn't get a 30-min-sticky 404). */
async function buildTeamPayload(teamId: number): Promise<Record<string, unknown> | null> {
  const season = Number(easternDate().slice(0, 4));

  const [info, roster, standings] = await Promise.all([
    getTeamInfo(teamId),
    getActiveRoster(teamId, season),
    getStandings(season),
  ]);

  if (!info) return null;

  const pitcherIds = roster.filter((p) => p.position === 'P').map((p) => p.id);
  const hitterIds = roster.filter((p) => p.position !== 'P').map((p) => p.id);

  const [pitchingStats, hittingStats] = await Promise.all([
    getPeopleSeasonStats(pitcherIds, 'pitching', season),
    getPeopleSeasonStats(hitterIds, 'hitting', season),
  ]);

  const record = standings.get(teamId) ?? null;

  return {
    teamId,
    teamName: info.name,
    abbreviation: info.abbreviation,
    logoUrl: mlbTeamLogoUrl(teamId),
    record: record
      ? { wins: record.wins, losses: record.losses, divisionRank: record.divisionRank }
      : null,
    roster: roster.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      position: p.position,
      headshotUrl: mlbHeadshotUrl(p.id),
      isPitcher: p.position === 'P',
      seasonLine: (p.position === 'P' ? pitchingStats.get(p.id) : hittingStats.get(p.id)) ?? null,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId: teamIdParam } = await params;

  // Task 3.5 — the id lands in a snapshot_cache key, so it is bounded before
  // it gets there. The previous `Number.isFinite(x) && x > 0` check rejected
  // nothing that mattered: 888801, 1e9 and 2.5 all passed it, and each minted
  // its own permanent snapshot_cache row plus its own upstream fetch.
  let teamId: number;
  try {
    teamId = knownId(teamIdParam, MLB_TEAM_IDS, 'teamId');
  } catch (error) {
    if (error instanceof BadRequest) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  return cachedRoute({
    cacheKey: `mlb:team:${teamId}`,
    ttlMs: CACHE_TTL_MS,
    build: () => buildTeamPayload(teamId),
    notFoundMessage: 'Team not found',
    errorMessage: 'Team lookup failed',
    request,
  });
}
