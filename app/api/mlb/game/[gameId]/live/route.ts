/**
 * Live in-game detail for the hero card's Live tab: inning/count/outs,
 * baserunners, current batter, by-inning line score, and both teams'
 * current pitching lines.
 *
 * GET /api/mlb/game/823508/live
 *
 * Deliberately uncached, matching `getLiveFeed`'s own contract — this is
 * the only place that data goes when a game is actually in progress.
 */

import { NextResponse } from 'next/server';
import { getLiveFeed } from '@/lib/sports/mlb/statsapi';
import { buildLiveGameDetail, livePlayerLine, liveMarketValues, subjectPlaysToday } from '@/lib/sports/mlb/liveGame';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId: gameIdParam } = await params;
  const gamePk = Number(gameIdParam);
  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: 'Invalid gameId' }, { status: 400 });
  }
  const subjectId = new URL(request.url).searchParams.get('subjectId');

  try {
    const feed = await getLiveFeed(gamePk);
    if (!feed) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const detail = buildLiveGameDetail(feed);
    if (!detail) {
      return NextResponse.json({ error: 'Game is not live' }, { status: 404 });
    }
    const player = subjectId ? livePlayerLine(feed, subjectId) : null;
    const liveValues = subjectId ? liveMarketValues(feed, subjectId) : undefined;
    const subjectPlays = subjectId ? subjectPlaysToday(feed, subjectId) : undefined;

    return NextResponse.json({ gamePk, ...detail, player, liveValues, subjectPlays, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Live feed lookup failed' },
      { status: 502 },
    );
  }
}
