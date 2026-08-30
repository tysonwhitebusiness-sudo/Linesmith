/**
 * `GameDetail.tsx` adapter — NBA half. Mirrors CFB's/soccer's game
 * adapter: real hero (score, real pregame moneyline/spread/total), real
 * records + last-five, real left-rail props. Real `divisionRank` (2026-08-24,
 * from `standingsTeams`) and real `injuries` (confirmed live against ESPN's
 * NBA injuries feed). `matchup`/`statComparison`/`rankings`/`unitGrades`
 * stay `null` — no grading model or league-wide team-season-stats index for
 * NBA yet (position-group defense-allowed exists — `nba/teamDefenseAllowed.ts`
 * — but not a full team-vs-team stat comparison).
 */

import type { PickCandidate } from '@/lib/core/types';
import type { NbaGameSummary } from '@/lib/sports/nba/espn';
import type { NbaTeamDetailApiResponse } from './teamDetailAdapter';
import { toNbaRecentResultRows } from './teamDetailAdapter';
import type { GameDetailData, StatComparisonData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregateShapes';
import { toStatComparisonGroups } from '@/lib/sports/shared/seasonAggregateShapes';
import { NBA_SEASON_SPEC } from '@/lib/sports/shared/seasonAggregateSpecs';

function toOptionalRecord(games: ReturnType<typeof toNbaRecentResultRows>): { wins: number; losses: number } | null {
  if (games.length === 0) return null;
  const wins = games.filter((g) => g.win === true).length;
  const losses = games.filter((g) => g.win === false).length;
  return { wins, losses };
}

function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/** Real division rank string (2026-08-24) — same `standingsTeams.find`/`ordinal` shape `teamDetailAdapter.ts`'s own `record.divisionRank` already uses, applied to whichever team this specific game's `teamId` matches. */
function divisionRankText(teamId: string, standingsTeams: TeamStandingRow[]): string {
  const standing = standingsTeams.find((s) => s.teamId === Number(teamId));
  return standing?.divisionRank ? `${ordinal(Number(standing.divisionRank))} seed, ${standing.divisionName}` : '';
}

export interface NbaGameDetailInput {
  meta: NbaGameSummary;
  home: NbaTeamDetailApiResponse | null;
  away: NbaTeamDetailApiResponse | null;
  candidates: PickCandidate[];
  standingsTeams: TeamStandingRow[];
  /** The real per-game bookmaker grid (odds-architecture rebuild Phase 6)
   * — see CfbGameDetailInput's identical field for the full reasoning. */
  gameLine: UnifiedGameLine | null;
  /**
   * League-wide season aggregates and ranks (`useSeasonRanks`), Phase 6.2b.
   * `null` while loading or if the rollup fails — `statComparison` then stays
   * null and the block renders its honest empty state, exactly as before.
   */
  seasonRanks: SeasonAggregateResult | null;
}

export function toGameDetailData(input: NbaGameDetailInput): GameDetailData {
  const { meta, home, away, candidates, standingsTeams, gameLine, seasonRanks } = input;
  const game = meta.game;
  if (!game) throw new Error('toGameDetailData called without a resolved game — caller must gate on meta.game first');

  const homeRecent = home ? toNbaRecentResultRows(home.recentGames, home.team.teamId) : [];
  const awayRecent = away ? toNbaRecentResultRows(away.recentGames, away.team.teamId) : [];
  const homeH2h = homeRecent.filter((r) => r.opponentAbbr === game.awayAbbr);
  const awayH2h = awayRecent.filter((r) => r.opponentAbbr === game.homeAbbr);

  const isLive = game.status?.state === 'in';
  const isFinal = game.status?.state === 'post';

  const hero: GameDetailData['hero'] = {
    away: {
      abbr: game.awayAbbr,
      name: game.awayTeamName,
      href: away ? `/nba/team/${away.team.teamId}` : undefined,
      logoUrl: game.awayLogoUrl,
      record: toOptionalRecord(awayRecent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    home: {
      abbr: game.homeAbbr,
      name: game.homeTeamName,
      href: home ? `/nba/team/${home.team.teamId}` : undefined,
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
    // Prefers the merged, multi-source gameLine over ESPN's own single-book
    // pregameLine — same precedence CFB's adapter uses, see its comment.
    pregameLines: gameLine
      ? {
          moneyline: gameLine.moneyline ? { away: gameLine.moneyline.away ?? null, home: gameLine.moneyline.home ?? null } : null,
          spread: gameLine.spread ? { homePoint: gameLine.spread.homePoint ?? null } : null,
          total: gameLine.total?.point != null ? { point: gameLine.total.point } : null,
        }
      : meta.pregameLine
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
      divisionRank: away ? divisionRankText(away.team.teamId, standingsTeams) : null,
      season: toOptionalRecord(awayRecent),
      seasonHome: null,
      seasonAway: null,
      recent: awayRecent.slice(0, 5),
      h2h: awayH2h,
    },
    home: {
      abbr: game.homeAbbr,
      logoUrl: game.homeLogoUrl,
      divisionRank: home ? divisionRankText(home.team.teamId, standingsTeams) : null,
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

  // Stat comparison — Phase 6.2b. Was hardcoded `null` ("no league-wide
  // season-stats index for NBA"), which was true until the season
  // rollup existed. Both sides come from one league-wide fetch keyed by team
  // id, so a game costs one request, not two.
  //
  // The ids line up because `player_game_history.team_id` for NBA is the
  // same id space this adapter already uses for logos and hrefs — verified
  // against the table's real distinct values, not assumed.
  const awayAgg = away ? seasonRanks?.byEntity[String(away.team.teamId)] : null;
  const homeAgg = home ? seasonRanks?.byEntity[String(home.team.teamId)] : null;
  const statComparisonGroups = toStatComparisonGroups(NBA_SEASON_SPEC, awayAgg, homeAgg);
  const statComparison: StatComparisonData | null =
    statComparisonGroups.length > 0
      ? { awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, ranked: statComparisonGroups }
      : null;

  return {
    gameId: game.gameId,
    gameLine,
    hero,
    matchup: null,
    records,
    statComparison,
    lastFive,
    rankings: null,
    unitGrades: null,
    injuries: {
      away: { abbr: game.awayAbbr, logoUrl: game.awayLogoUrl, rows: away?.injuries.map((i) => ({ playerName: i.playerName, status: i.status, position: i.position, note: i.note })) ?? [] },
      home: { abbr: game.homeAbbr, logoUrl: game.homeLogoUrl, rows: home?.injuries.map((i) => ({ playerName: i.playerName, status: i.status, position: i.position, note: i.note })) ?? [] },
      loading: false,
    },
    propsForGame: null,
    picksPanelGame: { id: game.gameId, sport: 'nba', awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}
