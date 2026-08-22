import { NextResponse } from 'next/server';
import { fetchGameSummary } from '@/lib/sports/soccer/espn';
import type { SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

/**
 * Not run through `cachedRoute()` — real-time contract, same reasoning as
 * `app/api/nfl/game/[gameId]/route.ts`: this carries the current score and
 * live period/clock for a game genuinely in progress, so serving a stale
 * cached copy would show a wrong live score, not just an out-of-date one.
 * `useSoccerGameDetail` (client) owns its own polling cadence.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ league: string; gameId: string }> }) {
  const { league, gameId } = await params;
  if (!isSoccerLeague(league)) {
    return NextResponse.json({ error: `Unknown league "${league}"` }, { status: 400 });
  }

  try {
    const summary = await fetchGameSummary(league, gameId);
    if (!summary.game) {
      return NextResponse.json({ error: `No ${league} game with id ${gameId}` }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json({ error: 'Soccer game detail failed', detail: String(error) }, { status: 500 });
  }
}
