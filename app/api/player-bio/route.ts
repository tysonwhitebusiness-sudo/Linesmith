/**
 * GET /api/player-bio?sport=<history sport | golf>&athleteId=<bare id>
 *
 * The player page's identity — photo, team, jersey, position, age, injury —
 * from the league's own athlete endpoint (R6.1a). The page renders the player
 * from this whether or not a market exists (see `playerResearchShapes.ts`).
 *
 * `cachedRoute()`: a live external fetch. 30 minutes because the injury status
 * is the fastest-moving field on it — ESPN stamped a report at 15:39 UTC on a
 * Tuesday during this build — and a bio is otherwise static.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { fetchPlayerBio, type BioSport } from '@/lib/sports/shared/playerBioServer';
import { isHistorySport } from '@/lib/sports/shared/playerResearchShapes';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const athleteId = url.searchParams.get('athleteId') ?? '';
  if (!(isHistorySport(sport) || sport === 'golf')) return NextResponse.json({ error: 'Unknown sport' }, { status: 400 });
  if (!/^\d{1,12}$/.test(athleteId)) return NextResponse.json({ error: 'athleteId must be a numeric id' }, { status: 400 });

  return cachedRoute({
    // Namespaced ":route" so it cannot collide with an internal cache (CLAUDE.md).
    cacheKey: `player:bio:route:${sport}:${athleteId}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'player-bio',
    build: () => fetchPlayerBio(sport as BioSport, athleteId),
    notFoundMessage: 'No player with that id',
    errorMessage: 'Player bio unavailable',
    request,
  });
}
