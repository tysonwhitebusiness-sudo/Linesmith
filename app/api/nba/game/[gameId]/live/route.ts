/**
 * Live in-game detail for NBA's hero card Live tab — quarter score, top
 * scorers, team shooting splits, full box score. Mirrors
 * `app/api/mlb/game/[gameId]/live/route.ts`'s contract: deliberately
 * uncached, this is the one place live-in-progress data goes.
 *
 * GET /api/nba/game/401859963/live
 */

import { NextResponse } from 'next/server';
import { fetchNbaLiveGame } from '@/lib/sports/nba/liveGame';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  try {
    const detail = await fetchNbaLiveGame(gameId);
    if (!detail) {
      return NextResponse.json({ error: `No NBA live game with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json({ ...detail, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'NBA live game lookup failed', detail: String(error) }, { status: 502 });
  }
}
