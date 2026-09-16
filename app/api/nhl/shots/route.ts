/**
 * GET /api/nhl/shots?playerId=8477492
 *
 * One NHL player's every attempt — a skater's own, or the ones a goalie faced —
 * for the player page's shot map (R6.5). It replaces `/api/nhl/shot-profile`,
 * whose 3x3 grid stood in for this map and whose only caller was this same
 * page; that route is deleted in this phase.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. Thirty minutes, matching
 * `/api/nhl/shot-profile` beside it and grounded in the same writer: the shot
 * ingest runs hourly, so a shorter TTL recomputes an identical answer.
 *
 * CACHE KEY: `nhl:player-shots:{playerId}` — grepped before choosing, per the
 * warning that `snapshot_cache` is one flat namespace. The existing NHL keys
 * are `nhl:shot-profile:{id}:{season}` and the snapshot's; nothing uses
 * `nhl:player-shots:`. The id is bounded before it reaches the key (task 3.5).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getNhlPlayerShotMap } from '@/lib/sports/nhl/playerShotMap';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const n = Number(url.searchParams.get('playerId'));
  if (!Number.isInteger(n) || n <= 0 || n > 99_999_999) {
    return NextResponse.json({ error: 'playerId must be a positive integer' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `nhl:player-shots:${n}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'nhl/shots',
    build: () => getNhlPlayerShotMap(n),
    errorMessage: 'NHL shot lookup failed',
    request,
  });
}
