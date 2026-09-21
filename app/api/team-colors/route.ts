/**
 * GET /api/team-colors?sport=nfl[&league=epl|mls]
 *
 * C0.2: a league's team colours (ESPN, with this app's hand tables on top),
 * for the player hero band, the team hero and the Slate's team stripes.
 *
 * CACHING — pattern 1 (`cachedRoute`). Team colours change about once a
 * decade; seven days is generous. Key `team-colors:route:{scope}`, grepped:
 * unused. IT READS; IT NEVER WRITES (the cache is the route's own).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { buildTeamColorIndex } from '@/lib/sports/shared/teamColorIndex';
import { ESPN_TEAM_LEAGUES } from '@/lib/sports/shared/teamColors';

export const dynamic = 'force-dynamic';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEAGUES = new Set(['epl', 'mls']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const league = url.searchParams.get('league');
  if (sport === 'soccer' && league != null && !LEAGUES.has(league)) return NextResponse.json({ error: 'Unknown league' }, { status: 400 });
  const scope = sport === 'soccer' ? `soccer_${league ?? 'epl'}` : sport;
  // Golf and tennis have no teams: an empty index, not an error.
  if (!ESPN_TEAM_LEAGUES[scope]) return NextResponse.json({ scope, index: null });

  return cachedRoute({
    cacheKey: `team-colors:route:${scope}`,
    ttlMs: TTL_MS,
    routeName: 'team-colors',
    errorMessage: 'Team colours read failed',
    request,
    build: async () => ({ scope, index: await buildTeamColorIndex(scope) }),
  });
}
