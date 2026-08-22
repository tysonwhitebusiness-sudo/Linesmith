import { NextResponse } from 'next/server';
import { fetchAllTeams, fetchGameSummary, type NbaTeam } from '@/lib/sports/nba/espn';
import { fetchScoreboard, fetchTeamRoster } from '@/lib/sports/multiSport/teamSportEspn';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000;

/** Deliberately thin like soccer's/CFB's team routes — real roster + next/recent games with real scores, no candidates/grades (NBA has no grading model — see adapter.ts's header). */
async function buildTeamPayload(teamId: string) {
  const [teams, roster, games] = await Promise.all([
    fetchAllTeams(),
    fetchTeamRoster('basketball', 'nba', teamId),
    fetchScoreboard('basketball', 'nba', 14, 21),
  ]);
  const team = teams.find((t: NbaTeam) => t.teamId === teamId);
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
    cacheKey: `nba:team:${teamId}`,
    ttlMs: CACHE_TTL_MS,
    request,
    build: () => buildTeamPayload(teamId),
    notFoundMessage: `No NBA team with id ${teamId}`,
    errorMessage: 'NBA team detail failed',
  });
}
