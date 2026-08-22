import { NextResponse } from 'next/server';
import { fetchBoxscore, isNhlGameCompleted, isNhlGameLive } from '@/lib/sports/nhl/nhle';

export const dynamic = 'force-dynamic';

/**
 * Real hero/score/status data comes entirely from NHL's own boxscore
 * endpoint — no ESPN cross-reference (see nhle.ts's header on why NHL
 * has no real pregame-line source at all). Not run through `cachedRoute()`
 * for the same real-time reasoning as soccer's/CFB's/NBA's game routes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  try {
    const box = await fetchBoxscore(gameId);
    if (!box) {
      return NextResponse.json({ error: `No NHL game with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json({
      game: {
        gameId: box.gameId,
        date: box.gameDate,
        homeTeamId: box.homeTeamId,
        homeAbbr: box.homeAbbr,
        homeScore: box.homeScore,
        awayTeamId: box.awayTeamId,
        awayAbbr: box.awayAbbr,
        awayScore: box.awayScore,
        status: {
          completed: isNhlGameCompleted(box.gameState),
          state: isNhlGameLive(box.gameState) ? 'in' : isNhlGameCompleted(box.gameState) ? 'post' : 'pre',
          shortDetail: box.gameState,
        },
      },
      // No real pregame-line source for NHL — see nhle.ts's header.
      pregameLine: null,
    });
  } catch (error) {
    return NextResponse.json({ error: 'NHL game detail failed', detail: String(error) }, { status: 500 });
  }
}
