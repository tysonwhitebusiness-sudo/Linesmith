import { NextResponse } from 'next/server';
import { fetchAllTeams, fetchGameSummary, type CfbTeam } from '@/lib/sports/cfb/espn';
import { fetchScoreboard, fetchTeamRoster } from '@/lib/sports/multiSport/teamSportEspn';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000;

/**
 * Deliberately thin like soccer's team route — real roster + next/recent
 * games from ESPN with real scores, no candidates/grades/matchup (CFB has
 * no grading model — see adapter.ts's header).
 */
async function buildTeamPayload(teamId: string) {
  const [teams, roster, games] = await Promise.all([
    fetchAllTeams(),
    fetchTeamRoster('football', 'college-football', teamId),
    fetchScoreboard('football', 'college-football', 21, 30),
  ]);
  const team = teams.find((t: CfbTeam) => t.teamId === teamId);
  if (!team) return null;

  const teamGames = games.filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId);
  const now = Date.now();
  const nextGame = teamGames.filter((g) => Date.parse(g.date) >= now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] ?? null;
  const recentGames = teamGames.filter((g) => Date.parse(g.date) < now).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const nextGameLine = nextGame ? (await fetchGameSummary(nextGame.gameId)).pregameLine : null;

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
    recentGames: recentGames.slice(0, 10),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  return cachedRoute({
    cacheKey: `cfb:team:${teamId}`,
    ttlMs: CACHE_TTL_MS,
    request,
    build: () => buildTeamPayload(teamId),
    notFoundMessage: `No CFB team with id ${teamId}`,
    errorMessage: 'CFB team detail failed',
  });
}
