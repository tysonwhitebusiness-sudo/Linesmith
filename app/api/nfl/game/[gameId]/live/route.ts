/**
 * Live in-game detail for the player page's live tracker — quarter score, scoring
 * plays, top passers, team stats. Mirrors
 * `app/api/mlb/game/[gameId]/live/route.ts`'s contract: deliberately
 * uncached. (It once complemented `nfl/liveGameState.ts`, the old game
 * page's down/distance strip; both that and the page were deleted in R11a.)
 *
 * GET /api/nfl/game/401547417/live
 */

import { NextResponse } from 'next/server';
import { fetchFootballLiveGame } from '@/lib/sports/multiSport/footballLiveGame';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  try {
    const detail = await fetchFootballLiveGame('nfl', gameId);
    if (!detail) {
      return NextResponse.json({ error: `No NFL live game with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json({ ...detail, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'NFL live game lookup failed', detail: String(error) }, { status: 502 });
  }
}
