/**
 * Live in-game detail for soccer's hero card Live tab — half score, the
 * real goal/card/substitution timeline, and team-level match stats. No
 * player box score — ESPN's soccer summary carries no `boxscore.players`
 * for this sport (verified live, see `lib/sports/soccer/liveGame.ts`'s
 * header comment), a real data-shape difference from NBA/NHL, not an
 * oversight. Mirrors `app/api/mlb/game/[gameId]/live/route.ts`'s contract:
 * deliberately uncached.
 *
 * GET /api/soccer/eng.1/game/401879322/live
 */

import { NextResponse } from 'next/server';
import { fetchSoccerLiveGame } from '@/lib/sports/soccer/liveGame';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ league: string; gameId: string }> }) {
  const { league, gameId } = await params;

  try {
    const detail = await fetchSoccerLiveGame(league, gameId);
    if (!detail) {
      return NextResponse.json({ error: `No soccer live game with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json({ ...detail, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'Soccer live game lookup failed', detail: String(error) }, { status: 502 });
  }
}
