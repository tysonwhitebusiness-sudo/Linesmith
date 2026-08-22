/**
 * `TeamDetail.tsx` adapter — NHL half. Mirrors CFB's/NBA's team adapter:
 * no grading model, no team-level windows/distribution (same deferred
 * gap). Real: roster, next fixture (no real pregame-line source for NHL —
 * see nhle.ts's header), a recent-fixtures list with real scores, real
 * record from standings.
 */

import type { TeamStandingRow } from '@/components/useAllTeams';
import type { RecentResultRow, RosterPlayer, TeamDetailData, TeamNextGame } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { NhlTeam, NhlGame } from '@/lib/sports/nhl/nhle';

export interface NhlTeamDetailApiResponse {
  team: NhlTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null }>;
  nextGame: NhlGame | null;
  nextGameLine: null;
  recentGames: NhlGame[];
}

export function toNhlRecentResultRows(games: NhlGame[], teamAbbr: string): RecentResultRow[] {
  return games.map((g) => {
    const isHome = g.homeAbbr === teamAbbr;
    const scoreFor = isHome ? g.homeScore : g.awayScore;
    const scoreAgainst = isHome ? g.awayScore : g.homeScore;
    const resolved = scoreFor != null && scoreAgainst != null;
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

export interface NhlTeamDetailInput {
  data: NhlTeamDetailApiResponse;
  standingsTeams: TeamStandingRow[];
}

export function toTeamDetailData(input: NhlTeamDetailInput): TeamDetailData {
  const { data, standingsTeams } = input;
  const { team, roster, nextGame, recentGames } = data;

  const rosterPlayers: RosterPlayer[] = roster.map((p) => ({
    subjectId: p.subjectId,
    name: p.fullName,
    position: p.position ?? '',
    teamAbbr: team.abbreviation,
    headshotUrl: p.headshotUrl ?? undefined,
    seasonLineText: 'No season stats source yet for NHL',
    hasStats: false,
    href: `/nhl/player/${encodeURIComponent(p.subjectId)}`,
  }));

  const opponentIsHome = nextGame ? nextGame.homeAbbr === team.abbreviation : false;
  const opponentAbbr = nextGame ? (opponentIsHome ? nextGame.awayAbbr : nextGame.homeAbbr) : undefined;
  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? '',
        opponentTeamId: null,
        opponentLogoUrl: undefined,
        isHome: !opponentIsHome,
        startTime: nextGame.date,
        moneyline: null,
        total: null,
        gameHref: `/nhl/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  return {
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          divisionRank: team.conference ? `${team.conference}` : '',
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
    recentResults: toNhlRecentResultRows(recentGames, team.abbreviation),
  };
}
