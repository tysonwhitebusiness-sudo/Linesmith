/**
 * Live in-game detail for NFL's hero card Live tab — quarter score, scoring
 * plays, top passers, team stats. Mirrors
 * `app/api/mlb/game/[gameId]/live/route.ts`'s contract: deliberately
 * uncached. Complements (doesn't replace) `lib/sports/nfl/liveGameState.ts`,
 * which feeds the hero card's inline down/distance strip — this route
 * powers the deeper, tabbed Live view.
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
