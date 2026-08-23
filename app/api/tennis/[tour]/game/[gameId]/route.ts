import { NextResponse } from 'next/server';
import { fetchTennisMatchDetail } from '@/lib/sports/multiSport/espnTennis';
import { currentTennisSeason, loadTennisSeasonContext, matchTennisIndex, type TennisMatch } from '@/lib/sports/tennis/tennismylife';
import { normalizeName } from '@/lib/odds/screenshotImport';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

interface RecentResultRowWire {
  gameId: string;
  date: string;
  win: boolean;
  opponentAbbr: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
}

function toRecentRows(matches: TennisMatch[]): RecentResultRowWire[] {
  return [...matches]
    .reverse()
    .map((m) => ({ gameId: m.matchId, date: m.date, win: m.isWinner, opponentAbbr: m.opponent, isHome: false, scoreFor: m.gamesWon, scoreAgainst: m.gamesLost }));
}

/**
 * Not run through `cachedRoute()` — same real-time contract as
 * `app/api/soccer/[league]/game/[gameId]/route.ts`: `fetchTennisMatchDetail`
 * carries the current live status/set score for a match genuinely in
 * progress. Tennis has no separate "team" route to compose with (no team
 * concept — see adapter.ts's header) so both players' season records/H2H
 * are resolved here, in one call, instead of a second per-side fetch.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ tour: string; gameId: string }> }) {
  const { tour, gameId } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  try {
    const match = await fetchTennisMatchDetail(tour, gameId);
    if (!match) {
      return NextResponse.json({ error: `No ${tour} match with id ${gameId}` }, { status: 404 });
    }

    const context = await loadTennisSeasonContext(tour, currentTennisSeason());
    const player1Matches = matchTennisIndex(context, match.player1.name) ?? [];
    const player2Matches = matchTennisIndex(context, match.player2.name) ?? [];
    const p1Norm = normalizeName(match.player1.name);
    const p2Norm = normalizeName(match.player2.name);

    return NextResponse.json({
      game: match,
      player1Recent: toRecentRows(player1Matches),
      player2Recent: toRecentRows(player2Matches),
      player1H2h: toRecentRows(player1Matches.filter((m) => normalizeName(m.opponent) === p2Norm)),
      player2H2h: toRecentRows(player2Matches.filter((m) => normalizeName(m.opponent) === p1Norm)),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Tennis game detail failed', detail: String(error) }, { status: 500 });
  }
}
