/**
 * `TeamDetail.tsx` adapter — soccer half.
 *
 * Deliberately thin, same reasoning as the player adapter: no grading
 * model (`grades: null`), no per-match history/candidates for the window
 * boxes/distribution chart (real per-match history exists now per
 * docs/soccer-gameplan-2026-08-22.md §11 but isn't wired into team-level
 * form yet — separate, later step). What *is* real: roster, next fixture
 * with a real single-book pregame line, a recent-fixtures list, and now a
 * real record/points/GD from standings (the `standingsTeams` list this
 * adapter already receives carries them since the teams route started
 * joining in `fetchStandings` — no second fetch needed here).
 */

import type { TeamStandingRow } from '@/components/useAllTeams';
import type { RosterPlayer, TeamDetailData, TeamNextGame } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { SoccerTeam, SoccerPregameLine } from '@/lib/sports/soccer/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
import type { SoccerLeague } from '@/lib/core/types';

export interface SoccerTeamDetailApiResponse {
  team: SoccerTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: SoccerPregameLine | null;
  recentGames: EspnTeamSportGame[];
}

/** Local copy of the same small ordinal helper every other adapter in this family carries — avoids a circular value-import. */
function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

export interface SoccerTeamDetailInput {
  league: SoccerLeague;
  data: SoccerTeamDetailApiResponse;
  standingsTeams: TeamStandingRow[];
}

export function toTeamDetailData(input: SoccerTeamDetailInput): TeamDetailData {
  const { league, data, standingsTeams } = input;
  const { team, roster, nextGame, nextGameLine, recentGames } = data;

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
  // Moneyline here is the *this team's* side of a real 3-way (home/away/draw)
  // market — `TeamNextGame.moneyline` only has away/home slots (built for
  // MLB/NFL's 2-way markets), so the draw price has nowhere to go yet; not
  // lost, just not surfaced by this shared shape. `away`/`home` map to
  // which side of the real match this team actually is, not to this team
  // specifically vs. "the other one" — same convention MLB/NFL already use.
  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? '',
        opponentTeamId: null,
        opponentLogoUrl: undefined,
        isHome: !opponentIsHome,
        startTime: nextGame.date,
        moneyline: nextGameLine
          ? { away: nextGameLine.moneylineAway, home: nextGameLine.moneylineHome }
          : null,
        total: nextGameLine?.overUnder != null ? { point: nextGameLine.overUnder, overPrice: nextGameLine.overOdds } : null,
        gameHref: `/soccer/${league}/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  return {
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          divisionRank: ownStanding.divisionRank ? `${ordinal(Number(ownStanding.divisionRank))}, ${ownStanding.points ?? 0} pts` : '',
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
