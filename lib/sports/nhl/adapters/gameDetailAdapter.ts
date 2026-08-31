/**
 * `GameDetail.tsx` adapter — NHL half. Mirrors CFB's/NBA's game adapter:
 * real hero (score, real status), real records + last-five, real left-rail
 * props. Pregame line (2026-08-26, odds-architecture rebuild Phase 5) now
 * real: OddsHarvester is NHL's sole game-lines source (no other provider
 * covers NHL anywhere in this codebase — see harvester_scrape.py's own
 * SCRAPE_CONFIG comment for "nhl"), so `gameLine` here either carries
 * OddsHarvester's real data or is `null` — no merge-with-ESPN concern the
 * way CFB/NBA/soccer have, since there's nothing else to merge with.
 *
 * `statComparison` became real in 6.2b, and `rankings`/`unitGrades`/`matchup`
 * in 6.15 — all four from ONE league-wide season rollup over
 * `player_game_history`, read for-and-allowed. NHL is the sport the generic
 * `unitGrades` type was proven against, since the old NFL-shaped `TeamGrades`
 * could not express its units at all.
 */

import type { PickCandidate } from '@/lib/core/types';
import type { NhlGameMeta } from '@/components/useNhlGameDetail';
import type { NhlTeamDetailApiResponse } from './teamDetailAdapter';
import { toNhlRecentResultRows } from './teamDetailAdapter';
import type { GameDetailData, StatComparisonData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregateShapes';
import { toStatComparisonGroups } from '@/lib/sports/shared/seasonAggregateShapes';
import { NHL_SEASON_SPEC } from '@/lib/sports/shared/seasonAggregateSpecs';
import { toProducedAllowedMatchup } from '@/lib/sports/shared/producedAllowedMatchup';

function toOptionalRecord(games: ReturnType<typeof toNhlRecentResultRows>): { wins: number; losses: number } | null {
  if (games.length === 0) return null;
  const wins = games.filter((g) => g.win === true).length;
  const losses = games.filter((g) => g.win === false).length;
  return { wins, losses };
}

function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/** Real division rank string (2026-08-24) — same shape `teamDetailAdapter.ts`'s own `record.divisionRank` already uses. */
function divisionRankText(teamId: string, standingsTeams: TeamStandingRow[]): string {
  const standing = standingsTeams.find((s) => s.teamId === Number(teamId));
  return standing?.divisionRank ? `${ordinal(Number(standing.divisionRank))}, ${standing.divisionName}` : '';
}

export interface NhlGameDetailInput {
  meta: NhlGameMeta;
  home: NhlTeamDetailApiResponse | null;
  away: NhlTeamDetailApiResponse | null;
  candidates: PickCandidate[];
  standingsTeams: TeamStandingRow[];
  /** The real per-game bookmaker grid (odds-architecture rebuild Phase 5/6)
   * — OddsHarvester is NHL's only real source, see this file's header. */
  gameLine: UnifiedGameLine | null;
  /**
   * League-wide season aggregates and ranks (`useSeasonRanks`), Phase 6.2b.
   * `null` while loading or if the rollup fails — `statComparison` then stays
   * null and the block renders its honest empty state, exactly as before.
   */
  seasonRanks: SeasonAggregateResult | null;
  /**
   * The same rollup grouped by `opponent_id` -- what each team ALLOWS.
   * Phase 6.15, and the missing half of this sport's matchup card: the shape
   * was always fillable, nothing had ever computed an allowed side.
   */
  seasonRanksAllowed: SeasonAggregateResult | null;
}

/**
 * `EntitySeasonAggregate.stats` -> the `Record<key, rank>` the Rankings block
 * reads. Ranks are stringified because that is the shape `RankableTeamStats`
 * declares; a missing rank stays `null` rather than becoming "0", which would
 * render as the best rank in the league.
 */
function toRankMap(agg: { stats: Array<{ key: string; rank: number }> }): Record<string, string | null> {
  return Object.fromEntries(agg.stats.map((st) => [st.key, st.rank == null ? null : String(st.rank)]));
}

export function toGameDetailData(input: NhlGameDetailInput): GameDetailData {
  const { meta, home, away, candidates, standingsTeams, gameLine, seasonRanks, seasonRanksAllowed } = input;
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
    pregameLines: gameLine
      ? {
          moneyline: gameLine.moneyline ? { away: gameLine.moneyline.away ?? null, home: gameLine.moneyline.home ?? null } : null,
          spread: gameLine.spread ? { homePoint: gameLine.spread.homePoint ?? null } : null,
          total: gameLine.total?.point != null ? { point: gameLine.total.point } : null,
        }
      : null,
  };

  const records: { away: RecordsSectionTeam; home: RecordsSectionTeam; loading: boolean } = {
    away: {
      abbr: game.awayAbbr,
      logoUrl: away?.team.logoUrl ?? undefined,
      // Real when `standingsTeams` has it — currently always '' because
      // `/api/nhl/teams` itself hardcodes `divisionRank: ''` (no real
      // NHL conference-rank source wired yet, one level deeper than this
      // fix; wiring stays correct/harmless for whenever that lands.
      divisionRank: away ? divisionRankText(away.team.teamId, standingsTeams) : null,
      season: toOptionalRecord(awayRecent),
      seasonHome: null,
      seasonAway: null,
      recent: awayRecent.slice(0, 5),
      h2h: awayH2h,
    },
    home: {
      abbr: game.homeAbbr,
      logoUrl: home?.team.logoUrl ?? undefined,
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
    away: { abbr: game.awayAbbr, logoUrl: away?.team.logoUrl ?? undefined, games: awayRecent.slice(0, 5) },
    home: { abbr: game.homeAbbr, logoUrl: home?.team.logoUrl ?? undefined, games: homeRecent.slice(0, 5) },
    loading: false,
  };

  // Stat comparison — Phase 6.2b. Was hardcoded `null` ("no league-wide
  // season-stats index for NHL"), which was true until the season
  // rollup existed. Both sides come from one league-wide fetch keyed by team
  // id, so a game costs one request, not two.
  //
  // The ids line up because `player_game_history.team_id` for NHL is the
  // same id space this adapter already uses for logos and hrefs — verified
  // against the table's real distinct values, not assumed.
  const awayAgg = away ? seasonRanks?.byEntity[String(away.team.teamId)] : null;
  const homeAgg = home ? seasonRanks?.byEntity[String(home.team.teamId)] : null;
  // Which season these ranks are FROM, said on the card. The rollup falls
  // back a season when the newest one is still a stub, so an unlabelled block
  // can silently show last year's ranks beside this year's odds.
  const seasonLabel = seasonRanks?.season ? `${seasonRanks.season} season` : undefined;
  const statComparisonGroups = toStatComparisonGroups(NHL_SEASON_SPEC, awayAgg, homeAgg);
  const statComparison: StatComparisonData | null =
    statComparisonGroups.length > 0
      ? { awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, ranked: statComparisonGroups, seasonLabel }
      : null;

  // Team matchup -- Phase 6.15. Was `null` with the comment "no grading model
  // or league-wide team-season-stats index"; the index has existed since 6.2b
  // and the allowed side arrived with `toAllowedSpec`, so the reason expired
  // before the field did.
  const awayAllowed = away ? seasonRanksAllowed?.byEntity[String(away.team.teamId)] : null;
  const homeAllowed = home ? seasonRanksAllowed?.byEntity[String(home.team.teamId)] : null;
  const matchup = toProducedAllowedMatchup(
    NHL_SEASON_SPEC,
    'offence',
    { abbr: game.awayAbbr, name: away?.team.name ?? game.awayAbbr, logoUrl: away?.team.logoUrl ?? undefined, produced: awayAgg, allowed: awayAllowed },
    { abbr: game.homeAbbr, name: home?.team.name ?? game.homeAbbr, logoUrl: home?.team.logoUrl ?? undefined, produced: homeAgg, allowed: homeAllowed },
  );

  return {
    gameId: game.gameId,
    gameLine,
    hero,
    matchup,
    records,
    statComparison,
    lastFive,
    // Phase 6.15 — built from the same `seasonRanks` rollup, so a team's rank
    // in the comparison table and its rank here are the same number by
    // construction rather than by coincidence.
    //
    // `againstRanks` IS THE OPPONENT'S OWN FOR-RANKS, not an opponent-allowed
    // series -- that is NFL's existing convention on this block ("the ranks you
    // are up against"), and `EntitySeasonAggregate` carries no allowed split to
    // build anything else from. Copying the convention keeps one block meaning
    // one thing across sports; inventing a second meaning here would not.
    rankings:
      awayAgg && homeAgg
        ? {
            away: { forRanks: toRankMap(awayAgg), againstRanks: toRankMap(homeAgg) },
            home: { forRanks: toRankMap(homeAgg), againstRanks: toRankMap(awayAgg) },
            statKeys: awayAgg.stats.map((st) => ({ key: st.key, label: st.label, decimals: st.decimals })),
            awayAbbr: game.awayAbbr,
            homeAbbr: game.homeAbbr,
            awayLogoUrl: away?.team.logoUrl ?? undefined,
            homeLogoUrl: home?.team.logoUrl ?? undefined,
            poolSize: seasonRanks?.poolSize ?? 0,
            seasonLabel,
          }
        : null,
    // Phase 6.15 — the SAME `seasonRanks` rollup this file already uses for
    // `statComparison` a few lines above carries each team's graded units, and
    // the team page has rendered them since 6.1b. Only the game page was still
    // nulling them, so one page graded a team and the other said it could not.
    // Reusing `awayAgg`/`homeAgg` rather than re-deriving means the ranks
    // behind a stat row and the ranks behind a unit's grade cannot disagree.
    unitGrades: {
      away: awayAgg && awayAgg.units.length > 0 ? awayAgg.units : null,
      home: homeAgg && homeAgg.units.length > 0 ? homeAgg.units : null,
      awayAbbr: game.awayAbbr,
      homeAbbr: game.homeAbbr,
    },
    injuries: {
      away: { abbr: game.awayAbbr, logoUrl: away?.team.logoUrl ?? undefined, rows: away?.injuries.map((i) => ({ playerName: i.playerName, status: i.status, position: i.position, note: i.note })) ?? [] },
      home: { abbr: game.homeAbbr, logoUrl: home?.team.logoUrl ?? undefined, rows: home?.injuries.map((i) => ({ playerName: i.playerName, status: i.status, position: i.position, note: i.note })) ?? [] },
      loading: false,
    },
    propsForGame: null,
    picksPanelGame: { id: game.gameId, sport: 'nhl', awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}
