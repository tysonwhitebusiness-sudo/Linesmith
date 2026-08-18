import { NextResponse } from 'next/server';
import { getStandings } from '@/lib/sports/nfl/espn';
import { fetchTeamRoster } from '@/lib/sports/multiSport/teamSportEspn';
import {
  getTeamRecentResults,
  getNflverseSchedule,
  getNflverseTeamStatsWithRank,
  getTeamDefenseAllowedWithRank,
  getPlayerSeasonStatsByGsis,
  getEspnToGsisMap,
} from '@/lib/sports/nfl/nflverse';
import { buildNflMoneylineCandidate, buildNflGameTotalCandidate, buildNflTeamTotalCandidate } from '@/lib/sports/nfl/teamFormCandidates';
import { getAllTeamGrades } from '@/lib/sports/nfl/nflTeamGrades';
import { getNflPlayerRankings } from '@/lib/sports/nfl/nflPlayerRankings';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { jsonPassthrough } from '@/lib/db/jsonPassthrough';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';

export const dynamic = 'force-dynamic';

// Every one of this route's 9 constituent calls already carries its own
// DB-persisted cache (roster 1h, standings 30min, nflverse CSVs 6-24h, team
// grades/player rankings 24h) — so this isn't a repeat of the "external call
// with no cache at all" problem the MLB teams route had. What's left is pure
// assembly cost: 9 separate SQLite reads + JSON.parse of some genuinely large
// cached payloads (player-season-stats, player-rankings) + the roster
// join/candidate-building logic, on every single request. Measured 12.7s
// cold (fresh process, includes route compile) vs 740ms warm-in-process —
// caching the assembled payload as one unit collapses that 740ms further and,
// same as the MLB per-team fix, survives dev-server restarts instead of
// re-paying assembly cost every time. TTL matches the shortest-lived
// constituent (standings, 30min) so this layer never serves data staler than
// what any underlying source promises.
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Everything NflTeamDetail needs in one call, rather than MLB's pattern of
 * several small hooks each hitting their own route — roster (with real
 * headshots + season stat lines), recent results, full team stats w/rank
 * (grouped: Scoring/Passing/Rushing/Receiving/Defense), the next opponent's
 * defensive rank in the same groups, and the three real team-level
 * candidates (Moneyline/Total/Team Total Points) that unlock the window
 * boxes/distribution chart/games table on the page.
 */
/** Null return means "team not found" — deliberately not cached, same convention as the MLB per-team route. */
async function buildTeamPayload(teamId: string): Promise<Record<string, unknown> | null> {
  const standings = await getStandings();
  const team = standings.find((t) => t.teamId === teamId);
  if (!team) return null;

  const [rosterRaw, recentResults, teamStatsByTeam, schedule, seasonStatsByGsis, espnToGsis, teamGrades, playerRankings] = await Promise.all([
    fetchTeamRoster('football', 'nfl', teamId),
    getTeamRecentResults(team.abbreviation, 25),
    getNflverseTeamStatsWithRank(),
    getNflverseSchedule(),
    getPlayerSeasonStatsByGsis(),
    getEspnToGsisMap(),
    getAllTeamGrades(),
    getNflPlayerRankings(),
  ]);

  const nextGame = schedule
    .filter((g) => !g.completed && (g.awayTeam === team.abbreviation || g.homeTeam === team.abbreviation))
    .sort((a, b) => (a.gameday > b.gameday ? 1 : -1))[0] ?? null;

  const opponentAbbr = nextGame
    ? (nextGame.awayTeam === team.abbreviation ? nextGame.homeTeam : nextGame.awayTeam)
    : null;
  const defenseAllowed = opponentAbbr ? (await getTeamDefenseAllowedWithRank())[opponentAbbr] ?? [] : [];

  // Real season stats attached per roster player — same fetch already
  // needed for the player-picker matchup mode, doubles as the roster
  // list's stat line so there's no second round-trip for either.
  const roster = rosterRaw.map((p) => {
    const athleteId = p.subjectId.split(':')[2];
    const gsisId = athleteId ? espnToGsis.get(athleteId) : undefined;
    const seasonStats = gsisId ? seasonStatsByGsis.get(gsisId) : undefined;
    const rank = gsisId ? playerRankings.byGsis.get(gsisId) : undefined;
    return {
      subjectId: p.subjectId,
      fullName: p.fullName,
      position: p.positionAbbr ?? null,
      headshotUrl: p.headshotUrl ?? null,
      seasonStats: seasonStats ?? null,
      positionRank: rank?.positionRank ?? null,
      positionPoolSize: rank?.positionPoolSize ?? null,
      sideOfBallRank: rank?.sideOfBallRank ?? null,
      sideOfBallPoolSize: rank?.sideOfBallPoolSize ?? null,
    };
  });

  const formInput = {
    teamId: Number(teamId),
    teamName: team.displayName,
    teamAbbr: team.abbreviation,
    results: recentResults,
    today: nextGame && opponentAbbr ? { opponentAbbr, isHome: nextGame.homeTeam === team.abbreviation, gamePk: nextGame.gameId } : null,
  };

  return {
    team,
    roster,
    recentResults,
    teamStats: teamStatsByTeam[team.abbreviation] ?? [],
    nextGame,
    opponentAbbr,
    opponentDefenseAllowed: defenseAllowed,
    grades: teamGrades[team.abbreviation] ?? null,
    opponentGrades: opponentAbbr ? teamGrades[opponentAbbr] ?? null : null,
    candidates: {
      moneyline: buildNflMoneylineCandidate(formInput),
      total: buildNflGameTotalCandidate(formInput),
      teamTotal: buildNflTeamTotalCandidate(formInput),
    },
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const cacheKey = `nfl:team:${teamId}`;

  async function rebuild() {
    const payload = await buildTeamPayload(teamId);
    if (payload) {
      try { writeSnapshotCache(cacheKey, JSON.stringify(payload)); } catch { /* ok */ }
    }
    return payload;
  }

  try {
    const cached = readSnapshotCache(cacheKey);
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

    if (cached && age < CACHE_TTL_MS) {
      return jsonPassthrough(cached.payload, 'hit');
    }
    if (cached) {
      triggerBackgroundRebuild(cacheKey, rebuild);
      return jsonPassthrough(cached.payload, 'stale');
    }

    const payload = await awaitRebuild(cacheKey, rebuild);
    if (!payload) {
      return NextResponse.json({ error: `No NFL team with id ${teamId}` }, { status: 404 });
    }
    return NextResponse.json(payload, { headers: { 'cache-control': 'no-store', 'x-cache': 'miss' } });
  } catch (error) {
    const stale = readSnapshotCache(cacheKey);
    if (stale) return jsonPassthrough(stale.payload, 'stale');
    return NextResponse.json(
      { error: 'NFL team detail failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
