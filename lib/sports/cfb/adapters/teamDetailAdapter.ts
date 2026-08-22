/**
 * `TeamDetail.tsx` adapter — CFB half. Mirrors soccer's own team adapter:
 * no grading model (`grades: null`), no team-level windows/distribution
 * (would need a team-level candidate-construction pipeline, deferred same
 * as soccer's — see docs/build-queue-2026-08-22.md). Real: roster, next
 * fixture with a real single-book pregame line, a recent-fixtures list
 * with real scores, real record/rank from standings.
 */

import type { TeamStandingRow } from '@/components/useAllTeams';
import type { RecentResultRow, RosterPlayer, TeamDetailData, TeamNextGame } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { CfbTeam, CfbPregameLine } from '@/lib/sports/cfb/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';

export interface CfbTeamDetailApiResponse {
  team: CfbTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: CfbPregameLine | null;
  recentGames: EspnTeamSportGame[];
}

/** Local copy of the same small ordinal helper every other adapter in this family carries — avoids a circular value-import. */
function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/** Real final scores from ESPN's scoreboard `score`/`status` fields — no draws in football, so `isDraw` is always false (the field exists on `RecentResultRow` for soccer; harmless/unused here). */
export function toCfbRecentResultRows(games: EspnTeamSportGame[], teamId: string): RecentResultRow[] {
  return games.map((g) => {
    const isHome = g.homeTeamId === teamId;
    const scoreFor = isHome ? g.homeScore : g.awayScore;
    const scoreAgainst = isHome ? g.awayScore : g.homeScore;
    const resolved = g.status?.completed === true && scoreFor != null && scoreAgainst != null;
    return {
      gameId: g.gameId,
      date: g.date,
      win: resolved ? scoreFor > scoreAgainst : null,
      opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr,
      isHome,
      scoreFor: scoreFor ?? 0,
      scoreAgainst: scoreAgainst ?? 0,
    };
  });
}

export interface CfbTeamDetailInput {
  data: CfbTeamDetailApiResponse;
  standingsTeams: TeamStandingRow[];
}

export function toTeamDetailData(input: CfbTeamDetailInput): TeamDetailData {
  const { data, standingsTeams } = input;
  const { team, roster, nextGame, nextGameLine, recentGames } = data;

  const rosterPlayers: RosterPlayer[] = roster.map((p) => ({
    subjectId: p.subjectId,
    name: p.fullName,
    position: p.position ?? '',
    teamAbbr: team.abbreviation,
    headshotUrl: p.headshotUrl ?? undefined,
    seasonLineText: 'No season stats source yet for CFB',
    hasStats: false,
    href: `/cfb/player/${encodeURIComponent(p.subjectId)}`,
  }));

  const opponentIsHome = nextGame ? nextGame.homeTeamId === team.teamId : false;
  const opponentAbbr = nextGame ? (opponentIsHome ? nextGame.awayAbbr : nextGame.homeAbbr) : undefined;
  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? '',
        opponentTeamId: null,
        opponentLogoUrl: undefined,
        isHome: !opponentIsHome,
        startTime: nextGame.date,
        moneyline: nextGameLine ? { away: nextGameLine.moneylineAway, home: nextGameLine.moneylineHome } : null,
        total: nextGameLine?.overUnder != null ? { point: nextGameLine.overUnder, overPrice: nextGameLine.overOdds } : null,
        gameHref: `/cfb/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  return {
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          divisionRank: ownStanding.divisionRank ? `${ordinal(Number(ownStanding.divisionRank))} in ${ownStanding.divisionName}` : '',
        }
      : null,
    grades: null,
    candidates: [],
    games: [],
    windows: null,
    distribution: null,
    matchup: null,
    statGroups: [],
    roster: rosterPlayers,
    rosterSortByStats: false,
    rosterPageSize: 24,
    standingsTeams,
    nextGame: nextGameData,
    advancedStats: null,
    form: null,
    recentResults: toCfbRecentResultRows(recentGames, team.teamId),
  };
}
