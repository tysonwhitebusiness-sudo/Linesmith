import { NextResponse } from 'next/server';
import { fetchGameSummary } from '@/lib/sports/nba/espn';
import { recordEspnPregameLine } from '@/lib/odds/espnBookLines';

export const dynamic = 'force-dynamic';

/** Not run through `cachedRoute()` — real-time contract, same reasoning as soccer's/CFB's game routes. */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  try {
    const summary = await fetchGameSummary(gameId);
    if (!summary.game) {
      return NextResponse.json({ error: `No NBA game with id ${gameId}` }, { status: 404 });
    }
    void recordEspnPregameLine('nba', gameId, summary.pregameLine);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json({ error: 'NBA game detail failed', detail: String(error) }, { status: 500 });
  }
}
