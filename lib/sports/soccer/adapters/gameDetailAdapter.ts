/**
 * `GameDetail.tsx` adapter — soccer half.
 *
 * Converts the real `/api/soccer/[league]/game/[gameId]` +
 * `/api/soccer/[league]/team/[teamId]` (x2) responses (fetched by
 * `useSoccerGameDetail`) into the shared `GameDetailData` interface. Real:
 * hero (score, real pregame moneyline/total from `SoccerPregameLine`),
 * records + last-five (from each team's `recentResults`, same real-score
 * derivation `teamDetailAdapter.ts` uses), left-rail props. `matchup`/
 * `statComparison`/`rankings`/`unitGrades`/`injuries` stay `null` — no
 * grading model or opponent-conditional stat source for soccer yet, same
 * honest gap `teamDetailAdapter.ts`/`playerDetailAdapter.ts` already
 * document. `propsForGame` also stays `null`: it's documented as an
 * NFL-only slot MLB already skips in favor of `leftRail`, and its shared
 * `playerHref` builder (`/${sport}/player/{id}`) has no league segment —
 * soccer's real player route needs one (`/soccer/{league}/player/{id}`),
 * so reusing that slot would produce a broken link. `leftRail` doesn't
 * have this problem (it drives an in-page query-param selection, not a
 * direct `<Link>`), so that's soccer's real props-for-game surface.
 */

import type { PickCandidate, SoccerLeague } from '@/lib/core/types';
import type { SoccerGameSummary } from '@/lib/sports/soccer/espn';
import type { SoccerTeamDetailApiResponse } from './teamDetailAdapter';
import { toSoccerRecentResultRows } from './teamDetailAdapter';
import type { GameDetailData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';

function toOptionalRecord(games: ReturnType<typeof toSoccerRecentResultRows>): { wins: number; losses: number } | null {
  if (games.length === 0) return null;
  const wins = games.filter((g) => g.win === true).length;
  const losses = games.filter((g) => g.win === false).length;
  return { wins, losses };
}

export interface SoccerGameDetailInput {
  league: SoccerLeague;
  meta: SoccerGameSummary;
  home: SoccerTeamDetailApiResponse | null;
  away: SoccerTeamDetailApiResponse | null;
  /** Page-filtered player-level candidates for this game. */
  candidates: PickCandidate[];
}

export function toGameDetailData(input: SoccerGameDetailInput): GameDetailData {
  const { league, meta, home, away, candidates } = input;
  const game = meta.game;
  if (!game) throw new Error('toGameDetailData called without a resolved game — caller must gate on meta.game first');

  const homeRecent = home ? toSoccerRecentResultRows(home.recentGames, home.team.teamId) : [];
  const awayRecent = away ? toSoccerRecentResultRows(away.recentGames, away.team.teamId) : [];
  const homeH2h = homeRecent.filter((r) => r.opponentAbbr === game.awayAbbr);
  const awayH2h = awayRecent.filter((r) => r.opponentAbbr === game.homeAbbr);

  const isLive = game.status?.state === 'in';
  const isFinal = game.status?.state === 'post';

  const hero: GameDetailData['hero'] = {
    away: {
      abbr: game.awayAbbr,
      name: game.awayTeamName,
      href: away ? `/soccer/${league}/team/${away.team.teamId}` : undefined,
      logoUrl: game.awayLogoUrl,
      record: toOptionalRecord(awayRecent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    home: {
      abbr: game.homeAbbr,
      name: game.homeTeamName,
      href: home ? `/soccer/${league}/team/${home.team.teamId}` : undefined,
      logoUrl: game.homeLogoUrl,
      record: toOptionalRecord(homeRecent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    isLive,
    isFinal,
    liveScore: isLive || isFinal ? { away: String(game.awayScore ?? 0), home: String(game.homeScore ?? 0) } : undefined,
    livePeriodLabel: isLive ? game.status?.shortDetail : undefined,
    startTimeLabel: new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    model: null,
    pickLockAt: null,
    pickLoading: false,
    venue: null,
    pregameLines: meta.pregameLine
      ? {
          moneyline: { away: meta.pregameLine.moneylineAway, home: meta.pregameLine.moneylineHome },
          spread: meta.pregameLine.spread != null ? { homePoint: meta.pregameLine.spread } : null,
          total: meta.pregameLine.overUnder != null ? { point: meta.pregameLine.overUnder } : null,
        }
      : null,
  };

  const records: { away: RecordsSectionTeam; home: RecordsSectionTeam; loading: boolean } = {
    away: {
      abbr: game.awayAbbr,
      logoUrl: game.awayLogoUrl,
      divisionRank: null,
      season: toOptionalRecord(awayRecent),
      seasonHome: null,
      seasonAway: null,
      recent: awayRecent.slice(0, 5),
      h2h: awayH2h,
    },
    home: {
      abbr: game.homeAbbr,
      logoUrl: game.homeLogoUrl,
      divisionRank: null,
      season: toOptionalRecord(homeRecent),
      seasonHome: null,
      seasonAway: null,
      recent: homeRecent.slice(0, 5),
      h2h: homeH2h,
    },
    loading: false,
  };

  const lastFive: { away: LastFiveGamesTeam; home: LastFiveGamesTeam; loading: boolean } = {
    away: { abbr: game.awayAbbr, logoUrl: game.awayLogoUrl, games: awayRecent.slice(0, 5) },
    home: { abbr: game.homeAbbr, logoUrl: game.homeLogoUrl, games: homeRecent.slice(0, 5) },
    loading: false,
  };

  return {
    gameId: game.gameId,
    hero,
    matchup: null,
    records,
    statComparison: null,
    lastFive,
    rankings: null,
    unitGrades: null,
    injuries: { away: { abbr: game.awayAbbr, logoUrl: game.awayLogoUrl, rows: [] }, home: { abbr: game.homeAbbr, logoUrl: game.homeLogoUrl, rows: [] }, loading: false },
    propsForGame: null,
    picksPanelGame: { id: game.gameId, sport: 'soccer', awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}

