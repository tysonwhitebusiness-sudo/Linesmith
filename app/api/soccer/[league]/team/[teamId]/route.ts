import { NextResponse } from 'next/server';
import { fetchAllTeams, fetchGameSummary, type SoccerTeam } from '@/lib/sports/soccer/espn';
import { fetchScoreboard, fetchTeamRoster } from '@/lib/sports/multiSport/teamSportEspn';
import type { SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000;
const ESPN_LEAGUE_SLUG: Record<SoccerLeague, string> = { epl: 'eng.1', mls: 'usa.1' };

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

/**
 * Deliberately thinner than MLB/NFL's team routes — real roster + next/
 * recent games from ESPN, no candidates/grades/matchup (soccer has no
 * model, no per-match history source yet — see adapter.ts's header and
 * docs/soccer-gameplan-2026-08-22.md's real accepted gaps).
 */
async function buildTeamPayload(league: SoccerLeague, teamId: string) {
  const slug = ESPN_LEAGUE_SLUG[league];
  const [teams, roster, games] = await Promise.all([
    fetchAllTeams(league),
    fetchTeamRoster('soccer', slug, teamId),
    fetchScoreboard('soccer', slug, 21),
  ]);
  const team = teams.find((t: SoccerTeam) => t.teamId === teamId);
  if (!team) return null;

  const teamGames = games.filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId);
  const now = Date.now();
  const nextGame = teamGames.filter((g) => Date.parse(g.date) >= now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] ?? null;
  const recentGames = teamGames.filter((g) => Date.parse(g.date) < now).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const nextGameLine = nextGame ? (await fetchGameSummary(league, nextGame.gameId)).pregameLine : null;

  return {
    team,
    roster: roster.map((p) => ({
      subjectId: p.subjectId,
      fullName: p.fullName,
      position: p.positionAbbr ?? null,
      headshotUrl: p.headshotUrl ?? null,
    })),
    nextGame,
    nextGameLine,
    // No final-score field exists on EspnTeamSportGame yet (schedule-shape
    // only) — recent results list real fixtures, without a win/loss/score
    // outcome until that's wired. Honest "played, outcome unknown" rather
    // than a fabricated result.
    recentGames: recentGames.slice(0, 10),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ league: string; teamId: string }> }) {
  const { league, teamId } = await params;
  if (!isSoccerLeague(league)) {
    return NextResponse.json({ error: `Unknown league "${league}"` }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `soccer:team:${league}:${teamId}`,
    ttlMs: CACHE_TTL_MS,
    request,
    build: () => buildTeamPayload(league, teamId),
    notFoundMessage: `No ${league} team with id ${teamId}`,
    errorMessage: 'Soccer team detail failed',
  });
}
