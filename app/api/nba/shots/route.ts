/**
 * GET /api/nba/shots?shooterId=4278073
 *
 * One NBA shooter's every field-goal attempt, for the player page's "Shot
 * profile" section (R6.5). It replaces `/api/nba/shot-profile`, whose 3x3 grid
 * stood in for this chart and whose only caller was this same page; that route
 * is deleted in this phase.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. Thirty minutes, the same
 * number and the same reasoning as `/api/nba/shot-profile` beside it: the
 * writer (`ingestNbaShotsJob`) runs hourly, so anything shorter recomputes an
 * identical answer.
 *
 * CACHE KEY: `nba:player-shots:{shooterId}` — grepped before choosing, per the
 * warning that `snapshot_cache` is one flat namespace. The existing NBA keys
 * are `nba:shot-profile:{id}:{season}` and the snapshot's own; nothing uses
 * `nba:player-shots:`. The id is bounded before it reaches the key (task 3.5).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getNbaPlayerShots } from '@/lib/sports/nba/playerShots';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const n = Number(url.searchParams.get('shooterId'));
  if (!Number.isInteger(n) || n <= 0 || n > 99_999_999) {
    return NextResponse.json({ error: 'shooterId must be a positive integer' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `nba:player-shots:${n}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'nba/shots',
    build: () => getNbaPlayerShots(n),
    errorMessage: 'NBA shot lookup failed',
    request,
  });
}
