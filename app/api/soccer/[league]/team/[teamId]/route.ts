import { NextResponse } from 'next/server';
import { fetchAllTeams, fetchGameSummary, type SoccerTeam } from '@/lib/sports/soccer/espn';
import { fetchScoreboard, fetchTeamRoster } from '@/lib/sports/multiSport/teamSportEspn';
import { currentUnderstatSeason, buildUnderstatTeamDefenseIndex, matchUnderstatTeamName, buildUnderstatNameIndex, matchUnderstatIndex } from '@/lib/sports/soccer/understat';
import { currentAsaSeason, loadAsaSeasonContext, matchAsaIndex } from '@/lib/sports/soccer/americanSocceranalysis';
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
 * Real roster + next/recent games from ESPN (real final scores — see
 * `EspnTeamSportGame`), a real single-book pregame line, and (EPL only)
 * real season goals-for/goals-against rate + league rank from Understat's
 * team-level data (`understat.ts`'s `buildUnderstatTeamDefenseIndex`) for
 * the Team Detail stat-groups card. MLS's equivalent needs ASA's own
 * `/mls/teams/xgoals` season rollup wired in — not yet built, so MLS's
 * `teamSeasonStats` stays `null`, an honest gap rather than the EPL rank
 * borrowed onto a different league's teams.
 */
async function buildTeamPayload(league: SoccerLeague, teamId: string) {
  const slug = ESPN_LEAGUE_SLUG[league];
  const [teams, roster, games] = await Promise.all([
    fetchAllTeams(league),
    fetchTeamRoster('soccer', slug, teamId),
    fetchScoreboard('soccer', slug, 21, 45),
  ]);
  const team = teams.find((t: SoccerTeam) => t.teamId === teamId);
  if (!team) return null;

  const teamGames = games.filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId);
  const now = Date.now();
  const nextGame = teamGames.filter((g) => Date.parse(g.date) >= now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] ?? null;
  const recentGames = teamGames.filter((g) => Date.parse(g.date) < now).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const nextGameLine = nextGame ? (await fetchGameSummary(league, nextGame.gameId)).pregameLine : null;
  const opponentTeamId = nextGame ? (nextGame.homeTeamId === teamId ? nextGame.awayTeamId : nextGame.homeTeamId) : null;
  const opponentTeam = opponentTeamId ? teams.find((t) => t.teamId === opponentTeamId) : null;

  let teamSeasonStats = null;
  let opponentSeasonStats = null;
  if (league === 'epl') {
    const defenseIndex = await buildUnderstatTeamDefenseIndex(currentUnderstatSeason());
    teamSeasonStats = matchUnderstatTeamName(defenseIndex, team.name);
    if (opponentTeam) opponentSeasonStats = matchUnderstatTeamName(defenseIndex, opponentTeam.name);
  }

  // Real per-player season stats (2026-08-24) — reuses the same real
  // Understat(EPL)/ASA(MLS) name-indexed season totals `adapter.ts`'s
  // `attachRealHistory` already resolves per-candidate, run for every
  // roster player instead of only ones with an active prop.
  const rosterSeasonStats = new Map<string, { games: number | null; goals: number; assists: number }>();
  try {
    if (league === 'epl') {
      const nameIndex = await buildUnderstatNameIndex(currentUnderstatSeason());
      for (const p of roster) {
        const resolved = matchUnderstatIndex(nameIndex, p.fullName);
        if (resolved && resolved.games > 0) rosterSeasonStats.set(p.subjectId, { games: resolved.games, goals: resolved.goals, assists: resolved.assists });
      }
    } else {
      // ASA's season aggregate has no real "games played" field (only
      // minutesPlayed) — `games: null` here, not a fabricated count;
      // `hasStats`/`seasonLineText` key off `minutesPlayed` instead.
      const asaContext = await loadAsaSeasonContext(currentAsaSeason());
      for (const p of roster) {
        const resolved = matchAsaIndex(asaContext.nameIndex, p.fullName);
        if (resolved && resolved.minutesPlayed > 0) rosterSeasonStats.set(p.subjectId, { games: null, goals: resolved.goals, assists: resolved.assists });
      }
    }
  } catch {
    // Real Understat/ASA hiccup — roster keeps no season stats rather than taking the whole team page down.
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
    recentGames: recentGames.slice(0, 20),
    teamSeasonStats,
    opponentSeasonStats,
    opponentAbbr: opponentTeam?.abbreviation ?? null,
    opponentName: opponentTeam?.name ?? null,
    opponentLogoUrl: opponentTeam?.logoUrl ?? null,
    logoByAbbr,
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
