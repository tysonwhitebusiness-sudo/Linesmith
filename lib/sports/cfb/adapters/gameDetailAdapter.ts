/**
 * `GameDetail.tsx` adapter — CFB half. Mirrors soccer's game adapter (see
 * that file's header for the full reasoning): hero (real score, real
 * pregame moneyline/spread/total), records + last-five (from each team's
 * `recentResults`, real scores), left-rail props. `matchup`/
 * `statComparison`/`rankings`/`unitGrades` stay `null` — no grading model
 * or opponent-conditional stat source for CFB yet. `propsForGame` also
 * stays `null`: same `playerHref` league-segment reasoning doesn't apply
 * to CFB (no league segment needed — `/${sport}/player/{id}` already
 * resolves correctly to `/cfb/player/{id}`), but there's no per-player
 * season-stats/injuries source to make that list meaningfully richer than
 * `leftRail` already is, so it stays unset for the same reason MLB skips it.
 */

import type { PickCandidate } from '@/lib/core/types';
import type { CfbGameSummary } from '@/lib/sports/cfb/espn';
import type { CfbTeamDetailApiResponse } from './teamDetailAdapter';
import { toCfbRecentResultRows } from './teamDetailAdapter';
import type { GameDetailData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';

function toOptionalRecord(games: ReturnType<typeof toCfbRecentResultRows>): { wins: number; losses: number } | null {
  if (games.length === 0) return null;
  const wins = games.filter((g) => g.win === true).length;
  const losses = games.filter((g) => g.win === false).length;
  return { wins, losses };
}

export interface CfbGameDetailInput {
  meta: CfbGameSummary;
  home: CfbTeamDetailApiResponse | null;
  away: CfbTeamDetailApiResponse | null;
  candidates: PickCandidate[];
}

export function toGameDetailData(input: CfbGameDetailInput): GameDetailData {
  const { meta, home, away, candidates } = input;
  const game = meta.game;
  if (!game) throw new Error('toGameDetailData called without a resolved game — caller must gate on meta.game first');

  const homeRecent = home ? toCfbRecentResultRows(home.recentGames, home.team.teamId) : [];
  const awayRecent = away ? toCfbRecentResultRows(away.recentGames, away.team.teamId) : [];
  const homeH2h = homeRecent.filter((r) => r.opponentAbbr === game.awayAbbr);
  const awayH2h = awayRecent.filter((r) => r.opponentAbbr === game.homeAbbr);

  const isLive = game.status?.state === 'in';
  const isFinal = game.status?.state === 'post';

  const hero: GameDetailData['hero'] = {
    away: {
      abbr: game.awayAbbr,
      name: game.awayTeamName,
      href: away ? `/cfb/team/${away.team.teamId}` : undefined,
      logoUrl: game.awayLogoUrl,
      record: toOptionalRecord(awayRecent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    home: {
      abbr: game.homeAbbr,
      name: game.homeTeamName,
      href: home ? `/cfb/team/${home.team.teamId}` : undefined,
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
    picksPanelGame: { id: game.gameId, sport: 'cfb', awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}
