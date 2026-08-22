/**
 * `TeamDetail.tsx` adapter — soccer half.
 *
 * Deliberately thin, same reasoning as the player adapter: no grading
 * model (`grades: null`), no per-match history/candidates for the window
 * boxes/distribution chart (soccer has no history source yet), no
 * standings source wired (`record: null`, `standingsTeams` real but
 * win/loss-less — see the teams route's own comment). What *is* real:
 * roster, next fixture, and a recent-fixtures list.
 */

import type { TeamStandingRow } from '@/components/useAllTeams';
import type { RosterPlayer, TeamDetailData, TeamNextGame } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { SoccerTeam } from '@/lib/sports/soccer/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
import type { SoccerLeague } from '@/lib/core/types';

export interface SoccerTeamDetailApiResponse {
  team: SoccerTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null }>;
  nextGame: EspnTeamSportGame | null;
  recentGames: EspnTeamSportGame[];
}

export interface SoccerTeamDetailInput {
  league: SoccerLeague;
  data: SoccerTeamDetailApiResponse;
  standingsTeams: TeamStandingRow[];
}

export function toTeamDetailData(input: SoccerTeamDetailInput): TeamDetailData {
  const { league, data, standingsTeams } = input;
  const { team, roster, nextGame, recentGames } = data;

  const rosterPlayers: RosterPlayer[] = roster.map((p) => ({
    subjectId: p.subjectId,
    name: p.fullName,
    position: p.position ?? '',
    teamAbbr: team.abbreviation,
    headshotUrl: p.headshotUrl ?? undefined,
    seasonLineText: 'No season stats source yet for this league',
    hasStats: false,
    href: `/soccer/${league}/player/${encodeURIComponent(p.subjectId)}`,
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
        moneyline: null,
        total: null,
        gameHref: `/soccer/${league}/game/${nextGame.gameId}`,
      }
    : null;

  return {
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: null,
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
    // recentGames has no final-score field yet (the ESPN scoreboard call
    // this route uses is schedule-shape only) — `win: null` renders as
    // the engine's existing "unresolved" state, honest rather than guessed.
    recentResults: recentGames.map((g) => {
      const isHome = g.homeTeamId === team.teamId;
      return {
        gameId: g.gameId,
        date: g.date,
        win: null,
        opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr,
        isHome,
        scoreFor: 0,
        scoreAgainst: 0,
      };
    }),
  };
}
