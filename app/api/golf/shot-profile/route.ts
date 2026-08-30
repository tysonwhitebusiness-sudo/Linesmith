/**
 * GET /api/golf/shot-profile?name=Xander%20Schauffele
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
 * KEYED BY NAME, not id: `golf_shot_events.player_id` is PGA Tour's id and the
 * app's golf `subjectId` is ESPN's. Both are five-digit numbers, so an
 * id-keyed lookup returns zero rows and looks like a player with no data. See
 * `shotProfile.ts` for the measurement.
 *
 * CACHE KEY: `golf:shot-profile:{name}` — grepped before choosing.
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
 * Bounded by shape before reaching a cache key (task 3.5: an unbounded value
 * mints a permanent `snapshot_cache` row per request). Letters, spaces and the
 * punctuation real golfer names carry -- "J.J. Spaun", "Ludvig Aberg",
 * "Jose Maria Olazabal" -- and nothing else.
 */
const PLAYER_NAME = /^[\p{L}][\p{L} .'`-]{1,60}$/u;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = (url.searchParams.get('name') ?? '').trim();
  if (!PLAYER_NAME.test(name)) {
    return NextResponse.json({ error: 'name must be a player name' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `golf:shot-profile:${name.toLowerCase()}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'golf/shot-profile',
    build: async () => {
      const shots = await getGolfShotProfile(name);
      // An empty array is a legitimate answer. The seed covers 486 players
      // across 40 tournaments; 21 of 30 on a live slate match, and the nine
      // that do not reached the Tour after 2023. Wrapped so `cachedRoute` sees an object rather than
      // treating `[]` as "nothing to cache".
      return { shots };
    },
    errorMessage: 'Golf shot profile lookup failed',
    request,
  });
}
