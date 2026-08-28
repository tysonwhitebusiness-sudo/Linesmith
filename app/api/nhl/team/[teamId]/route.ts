import { NextResponse } from 'next/server';
import { fetchAllTeams, fetchTeamRoster, fetchWeekSchedule, fetchTeamSeasonSchedule, fetchBoxscore, currentNhlSeason, isNhlGameCompleted, type NhlTeam, type NhlBoxscore } from '@/lib/sports/nhl/nhle';
import { matchesForPlayer } from '@/lib/sports/nhl/adapter';
import { fetchEspnInjuries, type EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';
import { normalizeName } from '@/lib/odds/screenshotImport';

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

  // Real season-to-date, unsliced — `completedGames`'s pool was already
  // real full-season (`fetchTeamSeasonSchedule`); the old `.slice(0, 10)`
  // before return was the actual bug (2026-08-24 fix): `windows.szn` was
  // silently a ≤10-game sample mislabeled "Season" even though the real
  // season-long data was already sitting right here.
  const completedGames = seasonGames.filter((g) => isNhlGameCompleted(g.gameState)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  // Real per-player season stats (2026-08-24) — same real box-score pipeline
  // `adapter.ts`'s `attachRealHistory` already runs per-candidate, applied
  // to every roster player instead. `completedGames` (not just the 10-game
  // `recentGames` slice) so a real season total, not a display-list slice.
  const rosterSeasonStats = new Map<string, { games: number; goals: number; assists: number; points: number }>();
  try {
    const boxscores = new Map<string, NhlBoxscore>();
    await Promise.all(
      completedGames.map(async (game) => {
        const box = await fetchBoxscore(game.gameId);
        if (box) boxscores.set(game.gameId, box);
      }),
    );
    for (const p of roster) {
      const playerId = Number(p.subjectId.split(':')[1]);
      if (!Number.isFinite(playerId)) continue;
      const matches = matchesForPlayer(completedGames, boxscores, playerId, team.abbreviation);
      if (matches.length === 0) continue;
      rosterSeasonStats.set(p.subjectId, {
        games: matches.length,
        goals: matches.reduce((s, m) => s + m.goals, 0),
        assists: matches.reduce((s, m) => s + m.assists, 0),
        points: matches.reduce((s, m) => s + m.points, 0),
      });
    }
  } catch {
    // Real NHL boxscore hiccup — roster keeps no season stats rather than taking the whole team page down.
  }

  // Real injuries (2026-08-24, confirmed live) — ESPN's own id space differs
  // from nhle.ts's, so this looks up by normalized real team name instead
  // (see fetchEspnInjuries's own comment).
  let injuries: EspnInjuryRow[] = [];
  try {
    const injuryIndex = await fetchEspnInjuries('hockey', 'nhl');
    injuries = injuryIndex.get(normalizeName(team.name)) ?? [];
  } catch {
    // Real ESPN hiccup — team page just shows no injuries for this load.
  }

  const logoByAbbr = Object.fromEntries(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));

  return {
    team,
    roster: roster.map((p) => ({
      subjectId: p.subjectId,
      fullName: p.fullName,
      position: p.position,
      headshotUrl: p.headshotUrl,
      seasonStats: rosterSeasonStats.get(p.subjectId) ?? null,
    })),
    nextGame,
    // No real pregame-line source for NHL — see nhle.ts's header.
    nextGameLine: null,
    recentGames: completedGames,
    injuries,
    logoByAbbr,
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
