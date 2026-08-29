import { NextResponse } from 'next/server';
import { BadRequest, entityId } from '@/lib/apiValidation';
import { fetchAllTeams, fetchGameSummary, type NbaTeam } from '@/lib/sports/nba/espn';
import { fetchScoreboard, fetchTeamRoster, fetchTeamSchedule, fetchEspnInjuries, type EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';
import { cachedRoute } from '@/lib/cachedRoute';
import { currentNbaSeason, loadNbaSeasonContext, matchNbaPlayer, nbaPlayerMatches } from '@/lib/sports/nba/sportsdataverse';
import { currentNbaSeasonYear } from '@/lib/sports/nba/teamDefenseAllowed';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000;

/**
 * Real roster + next/recent games with real scores, no candidates/grades
 * (NBA has no grading model — see adapter.ts's header). Real per-player
 * season stats (2026-08-24) from the same league-wide sportsdataverse
 * context `adapter.ts`'s `attachRealHistory` already uses per-candidate —
 * one fetch for the whole roster, matched in-memory, no per-player I/O.
 */
async function buildTeamPayload(teamId: string) {
  const [teams, roster, nearTermGames] = await Promise.all([
    fetchAllTeams(),
    fetchTeamRoster('basketball', 'nba', teamId),
    fetchScoreboard('basketball', 'nba', 14, 21),
  ]);
  const team = teams.find((t: NbaTeam) => t.teamId === teamId);
  if (!team) return null;

  const now = Date.now();
  const nearTermTeamGames = nearTermGames.filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId);
  const nextGame = nearTermTeamGames.filter((g) => Date.parse(g.date) >= now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] ?? null;

  // Real season-to-date games, not `fetchScoreboard`'s capped ~3-week
  // window (see fetchTeamSchedule's own header — a real bug found
  // 2026-08-24: `windows.szn` was silently a ≤10-game sample mislabeled
  // "Season"). Falls back to the near-term scoreboard slice on a real
  // per-team-schedule fetch failure rather than going empty.
  let recentGames = (await fetchTeamSchedule('basketball', 'nba', teamId, String(currentNbaSeasonYear())))
    .filter((g) => g.status?.completed === true)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (recentGames.length === 0) {
    recentGames = nearTermTeamGames.filter((g) => Date.parse(g.date) < now).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  const nextGameLine = nextGame ? (await fetchGameSummary(nextGame.gameId)).pregameLine : null;

  const rosterSeasonStats = new Map<string, { games: number; points: number; rebounds: number; assists: number }>();
  try {
    const context = await loadNbaSeasonContext(currentNbaSeason());
    for (const p of roster) {
      const athleteId = matchNbaPlayer(context, p.fullName);
      if (!athleteId) continue;
      const matches = nbaPlayerMatches(context, athleteId);
      if (matches.length === 0) continue;
      rosterSeasonStats.set(p.subjectId, {
        games: matches.length,
        points: matches.reduce((s, m) => s + m.points, 0),
        rebounds: matches.reduce((s, m) => s + m.rebounds, 0),
        assists: matches.reduce((s, m) => s + m.assists, 0),
      });
    }
  } catch {
    // Real sportsdataverse hiccup — roster keeps no season stats rather than taking the whole team page down.
  }

  // Real injuries (2026-08-24, confirmed live) — league-wide fetch shared/cached across every NBA team.
  let injuries: EspnInjuryRow[] = [];
  try {
    const injuryIndex = await fetchEspnInjuries('basketball', 'nba');
    injuries = injuryIndex.get(teamId) ?? [];
  } catch {
    // Real ESPN hiccup — team page just shows no injuries for this load.
  }

  const logoByAbbr = Object.fromEntries(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));

  return {
    team,
    roster: roster.map((p) => ({
      subjectId: p.subjectId,
      fullName: p.fullName,
      position: p.positionAbbr ?? null,
      headshotUrl: p.headshotUrl ?? null,
      seasonStats: rosterSeasonStats.get(p.subjectId) ?? null,
    })),
    nextGame,
    nextGameLine,
    // Real season-to-date, not an arbitrary display cap — `TeamDetail.tsx`'s
    // own "Last 5 games" view slices to 5 itself; the Games/windows tables
    // want the real season sample.
    recentGames,
    injuries,
    logoByAbbr,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  // Task 3.5 — the id lands in a snapshot_cache key, so it is bounded before
  // it gets there. Unvalidated, every distinct string minted a permanent row.
  try {
    entityId(String(teamId), 'teamId');
  } catch (error) {
    if (error instanceof BadRequest) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }


  return cachedRoute({
    cacheKey: `nba:team:${teamId}`,
    ttlMs: CACHE_TTL_MS,
    request,
    build: () => buildTeamPayload(teamId),
    notFoundMessage: `No NBA team with id ${teamId}`,
    errorMessage: 'NBA team detail failed',
  });
}
