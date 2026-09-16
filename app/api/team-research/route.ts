/**
 * GET /api/team-research?sport=mlb&teamId=118
 *
 * A team page's whole research payload — R7. One route with the sport as a
 * query param, for the reason `/api/season-ranks` gives: a dynamic
 * `/api/[sport]/` segment would sit beside the real static sport folders and
 * swallow every unrecognised path. Each sport's reader lives beside that
 * sport's other fetchers (`lib/sports/mlb/teamResearch.ts`); a sport without
 * one gets a 400, not an empty page.
 *
 * CACHING — pattern 1 (`cachedRoute`). The build is several upstream calls
 * (schedule, standings, both team stat groups, names) and two Postgres reads
 * for each of two seasons. TTL 30 minutes: the fastest-moving constituent is
 * the league's schedule and standings, which `statsapi.ts` itself caches for 30
 * minutes, so this never serves staler than its own sources promise.
 *
 * CACHE KEY — `team-research:route:{sport}:{teamId}`, grepped before it was
 * chosen: nothing in `lib/`, `app/` or `components/` used a `team-research`
 * prefix. The `route:` segment is there for the reason CLAUDE.md gives. The
 * team id is checked against the sport's known ids before it reaches the key
 * (task 3.5).
 */

import { NextResponse } from 'next/server';
import { BadRequest, knownId } from '@/lib/apiValidation';
import { cachedRoute } from '@/lib/cachedRoute';
import { MLB_TEAM_IDS } from '@/lib/sports/mlb/teamAliases';
import { readMlbTeamResearch } from '@/lib/sports/mlb/teamResearch';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000;

const READERS: Record<string, { ids: ReadonlySet<number>; read: (teamId: number) => Promise<unknown | null> }> = {
  mlb: { ids: MLB_TEAM_IDS, read: readMlbTeamResearch },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const reader = READERS[sport];
  if (!reader) {
    return NextResponse.json({ error: `No team page reader for "${sport}". Expected one of: ${Object.keys(READERS).join(', ')}` }, { status: 400 });
  }
  let teamId: number;
  try {
    teamId = knownId(url.searchParams.get('teamId'), reader.ids, 'teamId');
  } catch (error) {
    if (error instanceof BadRequest) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  return cachedRoute({
    cacheKey: `team-research:route:${sport}:${teamId}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'team-research',
    build: () => reader.read(teamId),
    notFoundMessage: `No team ${teamId} for ${sport}`,
    errorMessage: 'Team research lookup failed',
    request,
  });
}
