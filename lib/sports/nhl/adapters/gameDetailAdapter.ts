/**
 * `GameDetail.tsx` adapter — NHL half. Mirrors CFB's/NBA's game adapter:
 * real hero (score, real status — no pregame line, see nhle.ts's header),
 * real records + last-five, real left-rail props.
 */

import type { PickCandidate } from '@/lib/core/types';
import type { NhlGameMeta } from '@/components/useNhlGameDetail';
import type { NhlTeamDetailApiResponse } from './teamDetailAdapter';
import { toNhlRecentResultRows } from './teamDetailAdapter';
import type { GameDetailData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';

function toOptionalRecord(games: ReturnType<typeof toNhlRecentResultRows>): { wins: number; losses: number } | null {
  if (games.length === 0) return null;
  const wins = games.filter((g) => g.win === true).length;
  const losses = games.filter((g) => g.win === false).length;
  return { wins, losses };
}

export interface NhlGameDetailInput {
  meta: NhlGameMeta;
  home: NhlTeamDetailApiResponse | null;
  away: NhlTeamDetailApiResponse | null;
  candidates: PickCandidate[];
}

export function toGameDetailData(input: NhlGameDetailInput): GameDetailData {
  const { meta, home, away, candidates } = input;
  const game = meta.game;
  if (!game) throw new Error('toGameDetailData called without a resolved game — caller must gate on meta.game first');

  const homeRecent = home ? toNhlRecentResultRows(home.recentGames, home.team.abbreviation) : [];
  const awayRecent = away ? toNhlRecentResultRows(away.recentGames, away.team.abbreviation) : [];
  const homeH2h = homeRecent.filter((r) => r.opponentAbbr === game.awayAbbr);
  const awayH2h = awayRecent.filter((r) => r.opponentAbbr === game.homeAbbr);

  const isLive = game.status.state === 'in';
  const isFinal = game.status.state === 'post';

  const hero: GameDetailData['hero'] = {
    away: {
      abbr: game.awayAbbr,
      name: away?.team.name ?? game.awayAbbr,
      href: away ? `/nhl/team/${away.team.teamId}` : undefined,
      logoUrl: away?.team.logoUrl ?? undefined,
      record: toOptionalRecord(awayRecent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    home: {
      abbr: game.homeAbbr,
      name: home?.team.name ?? game.homeAbbr,
      href: home ? `/nhl/team/${home.team.teamId}` : undefined,
      logoUrl: home?.team.logoUrl ?? undefined,
      record: toOptionalRecord(homeRecent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    isLive,
    isFinal,
    liveScore: isLive || isFinal ? { away: String(game.awayScore ?? 0), home: String(game.homeScore ?? 0) } : undefined,
    livePeriodLabel: isLive ? game.status.shortDetail : undefined,
    startTimeLabel: new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    model: null,
    pickLockAt: null,
    pickLoading: false,
    venue: null,
    pregameLines: null,
  };

  const records: { away: RecordsSectionTeam; home: RecordsSectionTeam; loading: boolean } = {
    away: {
      abbr: game.awayAbbr,
      logoUrl: away?.team.logoUrl ?? undefined,
      divisionRank: null,
      season: toOptionalRecord(awayRecent),
      seasonHome: null,
      seasonAway: null,
      recent: awayRecent.slice(0, 5),
      h2h: awayH2h,
    },
    home: {
      abbr: game.homeAbbr,
      logoUrl: home?.team.logoUrl ?? undefined,
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
    away: { abbr: game.awayAbbr, logoUrl: away?.team.logoUrl ?? undefined, games: awayRecent.slice(0, 5) },
    home: { abbr: game.homeAbbr, logoUrl: home?.team.logoUrl ?? undefined, games: homeRecent.slice(0, 5) },
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
    injuries: {
      away: { abbr: game.awayAbbr, logoUrl: away?.team.logoUrl ?? undefined, rows: [] },
      home: { abbr: game.homeAbbr, logoUrl: home?.team.logoUrl ?? undefined, rows: [] },
      loading: false,
    },
    propsForGame: null,
    picksPanelGame: { id: game.gameId, sport: 'nhl', awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}
