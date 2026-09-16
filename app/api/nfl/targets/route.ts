/**
 * GET /api/nfl/targets?athleteId=4241389&role=receiver
 *
 * One NFL player's located passes, for the player page's "Usage & depth" /
 * "Where he throws" section (R6.2). Replaces `/api/nfl/target-map`, which
 * served the 2x3 share grid the prop block drew and took a GSIS id only a
 * player with a market carried.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md, with the same 6-hour TTL
 * the target map used and for the same reason: `ingestNflPbpJob` runs DAILY
 * (nflverse republishes a whole season file rather than an increment), so a
 * shorter TTL just recomputes an identical answer.
 *
 * CACHE KEY: `nfl:targets:{role}:{athleteId}` — grepped before choosing;
 * nothing else uses an `nfl:targets:` prefix (`nfl:target-map:` was the
 * deleted route's).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getNflTargets } from '@/lib/sports/nfl/targets';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** ESPN athlete ids are numeric strings. Bounded before reaching a cache key (task 3.5). */
const ATHLETE_ID = /^[0-9]{1,10}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);

  const athleteId = url.searchParams.get('athleteId') ?? '';
  if (!ATHLETE_ID.test(athleteId)) {
    return NextResponse.json({ error: 'athleteId must be an ESPN athlete id' }, { status: 400 });
  }

  const role = url.searchParams.get('role') ?? 'receiver';
  if (role !== 'receiver' && role !== 'passer') {
    return NextResponse.json({ error: "role must be 'receiver' or 'passer'" }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `nfl:targets:${role}:${athleteId}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'nfl/targets',
    build: () => getNflTargets(athleteId, role),
    errorMessage: 'Target lookup failed',
    request,
  });
}
