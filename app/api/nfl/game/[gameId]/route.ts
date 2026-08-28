import { NextResponse } from 'next/server';
import { fetchScoreboard } from '@/lib/sports/multiSport/teamSportEspn';
import { getLeagueInjuries } from '@/lib/sports/nfl/espn';
import { getNflLiveGameState } from '@/lib/sports/nfl/liveGameState';
import { getSportsGameOddsGameLine } from '@/lib/odds/props/providers/sportsGameOdds';
import { getTeamDefenseAllowedWithRank } from '@/lib/sports/nfl/nflverse';

export const dynamic = 'force-dynamic';

/**
 * The three things `/api/nfl/team/[teamId]` (already built, already returns
 * real grouped/ranked stats, grades, recent results, and gradeable
 * moneyline/total/teamTotal candidates scoped to each team's own next game)
 * doesn't cover: resolving a bare `gameId` to its two ESPN team ids in the
 * first place, real current live state, and a third game-line source
 * (SportsGameOdds) on top of whatever `useGameLines('nfl')` already found
 * from SharpAPI/TheRundown — billed once per page view for exactly these two
 * teams, not folded into the slate-wide polling path (see nflGameLines.ts).
 * `NflGameDetail` calls this first to resolve team ids, then calls the
 * existing team route twice rather than duplicating its logic here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  try {
    const games = await fetchScoreboard('football', 'nfl');
    const game = games.find((g) => g.gameId === gameId);
    if (!game) {
      return NextResponse.json({ error: `No NFL game with id ${gameId}` }, { status: 404 });
    }

    const [injuries, liveState, sgo, defenseAllowedByTeam] = await Promise.all([
      getLeagueInjuries(),
      getNflLiveGameState(gameId),
      getSportsGameOddsGameLine({
        sport: 'nfl',
        homeTeamName: game.homeTeamName,
        awayTeamName: game.awayTeamName,
        gameDate: game.date,
      }),
      getTeamDefenseAllowedWithRank(),
    ]);

    return NextResponse.json({
      game,
      homeInjuries: injuries.filter((i) => i.teamName === game.homeTeamName),
      awayInjuries: injuries.filter((i) => i.teamName === game.awayTeamName),
      liveState,
      sportsGameOddsLine: sgo.line,
      warnings: sgo.warnings,
      // `/api/nfl/team/{id}`'s own opponentDefenseAllowed is scoped to that
      // team's own next game per nflverse's schedule — not reliably this
      // game (known nflverse/ESPN schedule mismatch). This stat isn't
      // opponent-conditional though ("what PIT's defense allows" already
      // answers "what PIT will allow against NYJ") — just needs pulling by
      // the right abbreviation for *this* game's actual two teams.
      homeDefenseAllowed: defenseAllowedByTeam[game.homeAbbr] ?? [],
      awayDefenseAllowed: defenseAllowedByTeam[game.awayAbbr] ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      // Phase 1.10 (P4 M4): detail stays on the server log, not in a public
      // 502 body — pg errors name tables and columns, fetch errors name
      // upstream hosts. This route is public and takes its id from the URL.
      { error: 'NFL game detail failed' },
      { status: 502 },
    );
  }
}
