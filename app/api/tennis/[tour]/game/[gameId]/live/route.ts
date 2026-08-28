/**
 * Live in-game detail for tennis's hero card Live tab — set-by-set score
 * ladder. Mirrors `app/api/mlb/game/[gameId]/live/route.ts`'s contract:
 * deliberately uncached.
 *
 * GET /api/tennis/atp/game/184414/live
 */

import { NextResponse } from 'next/server';
import { fetchTennisLiveGame } from '@/lib/sports/tennis/liveGame';
import type { TennisTour } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ tour: string; gameId: string }> }) {
  const { tour, gameId } = await params;

  try {
    const detail = await fetchTennisLiveGame(tour as TennisTour, gameId);
    if (!detail) {
      return NextResponse.json({ error: `No tennis live match with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json({ ...detail, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: 'Tennis live match lookup failed', detail: String(error) }, { status: 502 });
  }
}
