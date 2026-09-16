/**
 * GET /api/game-research?sport=mlb&gameId=824711
 *
 * A game page's payload — R8. One route with the sport as a query param, for
 * the reason `/api/team-research` and `/api/season-ranks` give. Each sport's
 * reader lives beside its other fetchers (`lib/sports/mlb/gameResearch.ts`).
 *
 * CACHING — pattern 1 (`cachedRoute`), with the TTL set by the game's REAL
 * status, read first from a 20-second in-process status lookup:
 *   final      24 h   — a finished game's feed, box and closing lines do not change;
 *   live       15 s   — stale-while-revalidate, so a poll gets the last build at
 *                       once and the next one is fetched behind it;
 *   postponed  1 h;
 *   pre        5 min  — lineups, probables and prices move before the start.
 * A game that turns live mid-TTL is caught by the status lookup: the key carries
 * the state, so a new state is a new entry rather than a stale one.
 *
 * CACHE KEY — `game-research:route:v2:{sport}:{gameId}:{state}` (v2: R8.1b added the before-start research), grepped before it
 * was chosen: nothing in `lib/`, `app/` or `components/` used a `game-research`
 * prefix. The game id is bounded in shape before it reaches the key (task 3.5),
 * and a reader returns `null` for an id the source does not know, which
 * `cachedRoute` answers with an uncached 404.
 */

import { NextResponse } from 'next/server';
import { BadRequest, entityIdNum } from '@/lib/apiValidation';
import { cachedRoute } from '@/lib/cachedRoute';
import { getGameStatus } from '@/lib/sports/mlb/statsapi';
import { mlbGameState, readMlbGameResearch } from '@/lib/sports/mlb/gameResearch';
import type { GameState } from '@/lib/sports/shared/gameResearchShapes';

export const dynamic = 'force-dynamic';

const TTL: Record<GameState, number> = {
  final: 24 * 60 * 60 * 1000,
  live: 15 * 1000,
  postponed: 60 * 60 * 1000,
  pre: 5 * 60 * 1000,
};

const READERS: Record<string, { state: (gameId: number) => Promise<GameState | null>; read: (gameId: number) => Promise<unknown | null> }> = {
  mlb: {
    state: async (pk) => {
      const s = await getGameStatus(pk);
      return s ? mlbGameState(s.abstractState, s.detailedState) : null;
    },
    read: readMlbGameResearch,
  },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const reader = READERS[sport];
  if (!reader) {
    return NextResponse.json({ error: `No game page reader for "${sport}". Expected one of: ${Object.keys(READERS).join(', ')}` }, { status: 400 });
  }
  let gameId: number;
  try {
    gameId = entityIdNum(url.searchParams.get('gameId'), 'gameId');
  } catch (error) {
    if (error instanceof BadRequest) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const state = await reader.state(gameId).catch(() => null);
  if (!state) return NextResponse.json({ error: `No ${sport} game ${gameId}` }, { status: 404 });
  return cachedRoute({
    cacheKey: `game-research:route:v2:${sport}:${gameId}:${state}`,
    ttlMs: TTL[state],
    routeName: 'game-research',
    build: () => reader.read(gameId),
    notFoundMessage: `No ${sport} game ${gameId}`,
    errorMessage: 'Game research lookup failed',
    request,
  });
}
