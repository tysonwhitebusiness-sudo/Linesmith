import { NextResponse } from 'next/server';
import { fetchGameSummary } from '@/lib/sports/cfb/espn';

export const dynamic = 'force-dynamic';

/**
 * Not run through `cachedRoute()` — real-time contract, same reasoning as
 * soccer's game route (app/api/soccer/[league]/game/[gameId]/route.ts):
 * this carries the current score for a game genuinely in progress.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  try {
    const summary = await fetchGameSummary(gameId);
    if (!summary.game) {
      return NextResponse.json({ error: `No CFB game with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json({ error: 'CFB game detail failed', detail: String(error) }, { status: 500 });
  }
}
