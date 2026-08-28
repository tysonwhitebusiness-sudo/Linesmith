import { NextResponse } from 'next/server';
import { fetchAllTeams, fetchGameSummary, type CfbTeam } from '@/lib/sports/cfb/espn';
import { fetchScoreboard, fetchTeamRoster, fetchEspnInjuries, fetchTeamSchedule } from '@/lib/sports/multiSport/teamSportEspn';
import { cachedRoute } from '@/lib/cachedRoute';
import { currentCfbdSeason, fetchFbsTeamNames, matchCfbdTeamName, loadCfbdTeamContext, cfbdPlayerMatchesFromContext } from '@/lib/sports/cfb/cfbd';
import { buildCfbTeamDefenseAllowedIndex, fuzzyLookupCfbTeamDefenseAllowed, type CfbTeamDefenseAllowed } from '@/lib/sports/cfb/teamDefenseAllowed';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000;

/**
 * Real roster + next/recent games from ESPN with real scores, plus (2026-08-24)
 * real per-player season stats and a real team-vs-opponent matchup, both
 * sourced from CFBD's box-score pipeline that already backed the player-detail
 * matchup card — see teamDefenseAllowed.ts's header. CFB still has no grading
 * model, so `grades` stays null in the adapter.
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

  // Real last-completed-season fallback for FORM/candidates/windows
  // (2026-08-24) — before this, a season that hasn't kicked off yet left
  // `recentGames` (and everything built from it: moneyline/total/points-for
  // candidates, the windows box, the "FORM" panel) silently empty, even
  // though the roster/team-stats sections above already fall back to real
  // 2025 data via CFBD. `recentGames`'s own near-term ESPN scoreboard
  // window (`fetchScoreboard`, 30 days back) has no such fallback built in,
  // so this reaches for the same real per-team schedule endpoint the NBA
  // season-window fix already uses (`fetchTeamSchedule`), scoped to last
  // season, only when this season genuinely has nothing yet.
  let formGames = recentGames;
  if (formGames.length === 0) {
    const lastSeason = String(Number(currentCfbdSeason()) - 1);
    const lastSeasonGames = (await fetchTeamSchedule('football', 'college-football', teamId, lastSeason)).filter((g) => g.status?.completed === true);
    if (lastSeasonGames.length > 0) formGames = lastSeasonGames.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  const nextGameLine = nextGame ? (await fetchGameSummary(nextGame.gameId)).pregameLine : null;
  const opponentTeamId = nextGame ? (nextGame.homeTeamId === teamId ? nextGame.awayTeamId : nextGame.homeTeamId) : null;
  const opponentTeam = opponentTeamId ? teams.find((t) => t.teamId === opponentTeamId) : null;
  const logoByAbbr = Object.fromEntries(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));

  // Real per-player season stats (replaces the old hardcoded roster stub)
  // and the real team-vs-opponent matchup — both need this team's own CFBD
  // name and box-score context, the same pipeline `adapter.ts`'s
  // `attachRealHistory` already uses per-candidate, just run once for the
  // whole roster instead of only players with an active prop.
  const fbsNames = await fetchFbsTeamNames();
  const cfbdTeamName = matchCfbdTeamName(team.location, fbsNames);
  let rosterSeasonStats = new Map<string, { games: number; passingYards: number; rushingYards: number; receivingYards: number; receptions: number }>();
  if (cfbdTeamName) {
    try {
      const context = await loadCfbdTeamContext(cfbdTeamName, currentCfbdSeason());
      for (const p of roster) {
        const matches = cfbdPlayerMatchesFromContext(context, p.fullName);
        if (matches.length === 0) continue;
        rosterSeasonStats.set(p.subjectId, {
          games: matches.length,
          passingYards: matches.reduce((s, m) => s + m.passingYards, 0),
          rushingYards: matches.reduce((s, m) => s + m.rushingYards, 0),
          receivingYards: matches.reduce((s, m) => s + m.receivingYards, 0),
          receptions: matches.reduce((s, m) => s + m.receptions, 0),
        });
      }
    } catch {
      // Real CFBD hiccup for this one team — roster keeps no season stats
      // rather than taking the whole team page down.
    }
  }

  // Real injuries (2026-08-24, confirmed live) — league-wide fetch shared/cached across every team on this sport.
  let injuries: import('@/lib/sports/multiSport/teamSportEspn').EspnInjuryRow[] = [];
  try {
    const injuryIndex = await fetchEspnInjuries('football', 'college-football');
    injuries = injuryIndex.get(team.teamId) ?? [];
  } catch {
    // Real ESPN hiccup — team page just shows no injuries for this load.
  }

  let teamOffense: CfbTeamDefenseAllowed | null = null;
  let opponentDefenseAllowed: CfbTeamDefenseAllowed | null = null;
  try {
    const defenseIndex = await buildCfbTeamDefenseAllowedIndex();
    teamOffense = fuzzyLookupCfbTeamDefenseAllowed(defenseIndex, team.location);
    if (opponentTeam) opponentDefenseAllowed = fuzzyLookupCfbTeamDefenseAllowed(defenseIndex, opponentTeam.location);
  } catch {
    // Real leaderboard-build hiccup — matchup card just stays empty for this load.
  }

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
    recentGames: formGames.slice(0, 10),
    teamOffense,
    opponentDefenseAllowed,
    opponentAbbr: opponentTeam?.abbreviation ?? null,
    opponentName: opponentTeam?.name ?? null,
    opponentLogoUrl: opponentTeam?.logoUrl ?? null,
    injuries,
    logoByAbbr,
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
