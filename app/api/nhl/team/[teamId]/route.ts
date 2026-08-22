import { NextResponse } from 'next/server';
import { fetchAllTeams, fetchTeamRoster, fetchWeekSchedule, fetchTeamSeasonSchedule, currentNhlSeason, isNhlGameCompleted, type NhlTeam } from '@/lib/sports/nhl/nhle';

export const dynamic = 'force-dynamic';

/**
 * No `cachedRoute()` here — nhle.ts's own functions are already
 * Postgres-cached per real source (teams 24h, roster 1h, schedule 6h), so
 * a second cache layer on top would just add staleness without saving a
 * real fetch. Matches the "direct SQLite/Postgres reads" exception
 * category CLAUDE.md documents for a route whose data already lives in
 * its own cached source.
 */
async function buildTeamPayload(teamId: string) {
  const teams = await fetchAllTeams();
  const team = teams.find((t: NhlTeam) => t.teamId === teamId);
  if (!team) return null;

  const season = currentNhlSeason();
  const [roster, weekGames, seasonGames] = await Promise.all([
    fetchTeamRoster(team.abbreviation),
    fetchWeekSchedule(),
    fetchTeamSeasonSchedule(team.abbreviation, season),
  ]);

  const now = Date.now();
  const nextFromWeek = weekGames
    .filter((g) => (g.homeAbbr === team.abbreviation || g.awayAbbr === team.abbreviation) && Date.parse(g.date) >= now)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  const nextFromSeason = seasonGames
    .filter((g) => Date.parse(g.date) >= now)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  const nextGame = nextFromWeek ?? nextFromSeason ?? null;

  const recentGames = seasonGames
    .filter((g) => isNhlGameCompleted(g.gameState))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 10);

  return {
    team,
    roster: roster.map((p) => ({ subjectId: p.subjectId, fullName: p.fullName, position: p.position, headshotUrl: p.headshotUrl })),
    nextGame,
    // No real pregame-line source for NHL — see nhle.ts's header.
    nextGameLine: null,
    recentGames,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  try {
    const payload = await buildTeamPayload(teamId);
    if (!payload) return NextResponse.json({ error: `No NHL team with id ${teamId}` }, { status: 404 });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: 'NHL team detail failed', detail: String(error) }, { status: 500 });
  }
}
