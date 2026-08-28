/**
 * Live in-game detail for CFB's hero card Live tab — quarter score, scoring
 * plays, top passers, team stats. Mirrors
 * `app/api/mlb/game/[gameId]/live/route.ts`'s contract: deliberately
 * uncached.
 *
 * GET /api/cfb/game/401769072/live
 */

import { NextResponse } from 'next/server';
import { fetchFootballLiveGame } from '@/lib/sports/multiSport/footballLiveGame';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  try {
    const detail = await fetchFootballLiveGame('college-football', gameId);
    if (!detail) {
      return NextResponse.json({ error: `No CFB live game with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json({ ...detail, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'CFB live game lookup failed', detail: String(error) }, { status: 502 });
  }
}
