/**
 * GET /api/soccer/understat?name=Erling%20Haaland
 *
 * One EPL player's Understat shots and matches, for the player page's "Chances
 * & finishing" section (R6.3). The snapshot build resolves the same data for a
 * player with a market today; the page starts from the player, so it needs its
 * own read.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. Six hours: Understat
 * publishes after matches, and the two fetchers behind this already cache their
 * own payloads, so the TTL only governs the reshaping.
 *
 * CACHE KEY: `soccer:understat:route:{name}`. The first version of this
 * comment said nothing else used a `soccer:understat:` prefix; the R6 audit
 * found `understat.ts` already writes `soccer:understat:league:{season}` and
 * `soccer:understat:player:v3:{id}` under it. The name check below forbids `:`,
 * so no name could actually reach those keys, but a route key that is only
 * safe because of an unrelated regex is the collision CLAUDE.md warns about —
 * hence the `route:` segment. The name is bounded in shape and length before it
 * reaches the key (task 3.5: an unbounded id mints a permanent `snapshot_cache`
 * row per value).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getSoccerUnderstat } from '@/lib/sports/soccer/playerUnderstat';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Letters (including accented), spaces, apostrophes, hyphens and dots — a player's name, nothing else. */
const NAME = /^[\p{L}][\p{L} .'’-]{1,47}$/u;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = (url.searchParams.get('name') ?? '').trim();
  if (!NAME.test(name)) {
    return NextResponse.json({ error: 'name must be a player name' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `soccer:understat:route:${name.toLowerCase()}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'soccer/understat',
    build: () => getSoccerUnderstat(name),
    errorMessage: 'Understat lookup failed',
    request,
  });
}
