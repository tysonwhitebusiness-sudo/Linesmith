/**
 * GET /api/golf/player-research?espnId=9478&name=Scottie%20Scheffler
 *
 * One golfer's recent rounds and holes, and the summary of the 2020-2022 shot
 * seed, for the player page's hero, "Scoring" and "Shot profile" (R6.6). It
 * replaces `/api/golf/shot-profile`, whose lie grid and mix stood in for the
 * shot section and whose only caller was this same page.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. Thirty minutes: the
 * round and hole tables are written while a tournament is on, and the shot
 * seed never changes, so the rounds set the pace.
 *
 * CACHE KEY: `golf:player-research:{espnId}:{name}` — grepped before choosing;
 * the golf keys in use are `golf:schedule:*`, `golf:schedule:route:*` and
 * `golf:shot-profile:*`. The name is in the key because the shots are found by
 * it, and both inputs are bounded before they reach the key (task 3.5).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getGolfPlayerResearch } from '@/lib/sports/golf/playerResearch';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000;

/** Letters (accented included), spaces, apostrophes, hyphens and dots. */
const NAME = /^[\p{L}][\p{L} .'’-]{1,47}$/u;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const espnId = url.searchParams.get('espnId') ?? '';
  if (!/^\d{1,12}$/.test(espnId)) {
    return NextResponse.json({ error: 'espnId must be a numeric id' }, { status: 400 });
  }
  const rawName = (url.searchParams.get('name') ?? '').trim();
  if (rawName && !NAME.test(rawName)) {
    return NextResponse.json({ error: 'name must be a player name' }, { status: 400 });
  }
  const name = rawName || null;

  return cachedRoute({
    cacheKey: `golf:player-research:v2:${espnId}:${(name ?? '').toLowerCase()}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'golf/player-research',
    build: () => getGolfPlayerResearch(espnId, name),
    errorMessage: 'Golf player research failed',
    request,
  });
}
