/**
 * Live in-game detail for NHL's hero card Live tab — period score, shots on
 * goal, scoring plays, penalties, and both teams' full skater/goalie box
 * score. Mirrors `app/api/mlb/game/[gameId]/live/route.ts`'s contract:
 * deliberately uncached, this is the one place live-in-progress data goes.
 *
 * GET /api/nhl/game/2025030413/live
 */

import { NextResponse } from 'next/server';
import { fetchNhlLiveGame } from '@/lib/sports/nhl/liveGame';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  try {
    const detail = await fetchNhlLiveGame(gameId);
    if (!detail) {
      return NextResponse.json({ error: `No NHL live game with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json({ ...detail, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'NHL live game lookup failed', detail: String(error) }, { status: 502 });
  }
}
