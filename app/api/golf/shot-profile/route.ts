/**
 * GET /api/golf/shot-profile?playerId=10140
 *
 * One golfer's shot-by-shot profile — the read path for Phase 6.13's golf
 * `usageMix` and `spatialGrid`.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. TTL is 24 HOURS, far
 * longer than the shot/target profiles' 30 minutes, and the reason is the
 * writer: `golf_shot_events` is a STATIC 2020-2023 seed loaded by an
 * operator-run script, not a feed. There is no cadence for a shorter TTL to
 * track — golfR's scraper reads a host that no longer resolves.
 *
 * CACHE KEY: `golf:shot-profile:{playerId}` — grepped before choosing.
 * Nothing else uses a `golf:shot-profile:` prefix, and `golf:schedule:` is
 * namespaced away from `golf:schedule:route:` for a collision that already
 * happened once (see CLAUDE.md).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getGolfShotProfile } from '@/lib/sports/golf/shotProfile';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ESPN athlete ids are numeric. Bounded by shape before reaching a cache key
 * (task 3.5: an unbounded id mints a permanent `snapshot_cache` row per value).
 */
const PLAYER_ID = /^[0-9]{1,12}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playerId = url.searchParams.get('playerId') ?? '';
  if (!PLAYER_ID.test(playerId)) {
    return NextResponse.json({ error: 'playerId must be a numeric athlete id' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `golf:shot-profile:${playerId}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'golf/shot-profile',
    build: async () => {
      const shots = await getGolfShotProfile(playerId);
      // An empty array is a legitimate answer -- this seed covers 244 players
      // across six events so far, so most golfers on a live leaderboard are
      // genuinely absent. Wrapped so `cachedRoute` sees an object rather than
      // treating `[]` as "nothing to cache".
      return { shots };
    },
    errorMessage: 'Golf shot profile lookup failed',
    request,
  });
}
