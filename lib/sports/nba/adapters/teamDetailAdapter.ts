/**
 * `TeamDetail.tsx` adapter — NBA half. Mirrors CFB's/soccer's team
 * adapter: no grading model (`grades: null`), no team-level windows/
 * distribution (same deferred gap as CFB/soccer). Real: roster, next
 * fixture with a real single-book pregame line, a recent-fixtures list
 * with real scores, real record/rank from standings.
 */

import type { TeamStandingRow } from '@/components/useAllTeams';
import type { RecentResultRow, RosterPlayer, TeamDetailData, TeamNextGame } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { NbaTeam, NbaPregameLine } from '@/lib/sports/nba/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';

export interface NbaTeamDetailApiResponse {
  team: NbaTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: NbaPregameLine | null;
  recentGames: EspnTeamSportGame[];
}

function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/** Real final scores from ESPN's scoreboard `score`/`status` fields — no draws in basketball, so `isDraw` is always false. */
export function toNbaRecentResultRows(games: EspnTeamSportGame[], teamId: string): RecentResultRow[] {
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

export interface NbaTeamDetailInput {
  data: NbaTeamDetailApiResponse;
  standingsTeams: TeamStandingRow[];
}

export function toTeamDetailData(input: NbaTeamDetailInput): TeamDetailData {
  const { data, standingsTeams } = input;
  const { team, roster, nextGame, nextGameLine, recentGames } = data;

  const rosterPlayers: RosterPlayer[] = roster.map((p) => ({
    subjectId: p.subjectId,
    name: p.fullName,
    position: p.position ?? '',
    teamAbbr: team.abbreviation,
    headshotUrl: p.headshotUrl ?? undefined,
    seasonLineText: 'No season stats source yet for NBA',
    hasStats: false,
    href: `/nba/player/${encodeURIComponent(p.subjectId)}`,
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
        gameHref: `/nba/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  return {
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          divisionRank: ownStanding.divisionRank ? `${ordinal(Number(ownStanding.divisionRank))} seed, ${ownStanding.divisionName}` : '',
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
    recentResults: toNbaRecentResultRows(recentGames, team.teamId),
  };
}
