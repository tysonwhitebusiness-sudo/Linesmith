/**
 * `GameDetail.tsx` adapter — soccer half.
 *
 * Converts the real `/api/soccer/[league]/game/[gameId]` +
 * `/api/soccer/[league]/team/[teamId]` (x2) responses (fetched by
 * `useSoccerGameDetail`) into the shared `GameDetailData` interface. Real:
 * hero (score, real pregame moneyline/total from `SoccerPregameLine`),
 * records + last-five (from each team's `recentResults`, same real-score
 * derivation `teamDetailAdapter.ts` uses), left-rail props. `matchup`/
 * `statComparison` are now real for EPL (2026-08-24), from `home`/`away`'s
 * own `teamSeasonStats` (each team's real Understat row, opponent-
 * independent so safe to reuse regardless of which specific game this is)
 * — stay `null` for MLS, no Understat source. `rankings`/`unitGrades`/
 * `injuries` stay `null` — no grading model or injuries source for soccer.
 * `propsForGame` also stays `null`: it's documented as an
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
import type { GameDetailData, GameMatchupData, StatComparisonData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { toVenueForecastFromCandidates } from '@/lib/sports/shared/venueForecast';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregateShapes';
import { toStatComparisonGroups } from '@/lib/sports/shared/seasonAggregateShapes';
import { SOCCER_EPL_SEASON_SPEC, SOCCER_MLS_SEASON_SPEC } from '@/lib/sports/shared/seasonAggregateSpecs';

function offenseRows(t: SoccerTeamDetailApiResponse | null): OpposingStarterStat[] {
  if (!t?.teamSeasonStats) return [];
  const s = t.teamSeasonStats;
  return [{ key: 'goalsFor', label: 'Goals Scored/Gm', value: s.goalsForPerGame, decimals: 2, rank: s.offenseRank, poolSize: s.poolSize }];
}

function defenseRows(t: SoccerTeamDetailApiResponse | null): OpposingStarterStat[] {
  if (!t?.teamSeasonStats) return [];
  const s = t.teamSeasonStats;
  return [
    { key: 'goalsAgainst', label: 'Goals Allowed/Gm', value: s.goalsAgainstPerGame, decimals: 2, rank: s.rank, poolSize: s.poolSize },
    { key: 'xGA', label: 'xG Allowed/Gm', value: s.xGAPerGame, decimals: 2, rank: s.rank, poolSize: s.poolSize },
  ];
}

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
  /** The real per-game bookmaker grid (odds-architecture rebuild Phase 6)
   * — see CfbGameDetailInput's identical field for the full reasoning. */
  gameLine: UnifiedGameLine | null;
  /**
   * League-wide season aggregates and ranks (`useSeasonRanks`), Phase 6.15.
   * `null` while loading, or if the rollup found no pool -- the blocks it
   * feeds then stay null and render their honest empty state.
   *
   * KEYED BY LEAGUE, not by "soccer". `useSeasonRanks` is called with
   * `soccer_epl` or `soccer_mls`, so this is already the right league's pool
   * by the time it arrives.
   */
  seasonRanks: SeasonAggregateResult | null;
}

/** `EntitySeasonAggregate.stats` -> the `Record<key, rank>` the Rankings block reads. A missing rank stays `null` rather than becoming "0", which would render as the best rank in the league. */
function toRankMap(agg: { stats: Array<{ key: string; rank: number }> }): Record<string, string | null> {
  return Object.fromEntries(agg.stats.map((st) => [st.key, st.rank == null ? null : String(st.rank)]));
}

export function toGameDetailData(input: SoccerGameDetailInput): GameDetailData {
  const { league, meta, home, away, candidates, gameLine, seasonRanks } = input;
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
    // Phase 6.15 -- the ground, from ESPN's own `gameInfo.venue`. NAME ONLY:
    // soccer resolves no forecast anywhere in this codebase, because ESPN
    // omits the roof state for the sport and the per-venue roof list that
    // would settle it was waived. `toVenueForecastFromCandidates` returns a
    // name-only strip in exactly that case, the same way a domed NFL stadium
    // does.
    venue: toVenueForecastFromCandidates(candidates, game.venue?.fullName),
    // Prefers the merged, multi-source gameLine over ESPN's own single-book
    // pregameLine — same precedence CFB's adapter uses, see its comment.
    // gameLine.moneyline.draw now carries the real third outcome ESPN's own
    // moneylineDraw always had but this slot never surfaced until now.
    pregameLines: gameLine
      ? {
          moneyline: gameLine.moneyline
            ? { away: gameLine.moneyline.away ?? null, home: gameLine.moneyline.home ?? null, draw: gameLine.moneyline.draw ?? null }
            : null,
          spread: gameLine.spread ? { homePoint: gameLine.spread.homePoint ?? null } : null,
          total: gameLine.total?.point != null ? { point: gameLine.total.point } : null,
        }
      : meta.pregameLine
        ? {
            moneyline: { away: meta.pregameLine.moneylineAway, home: meta.pregameLine.moneylineHome, draw: meta.pregameLine.moneylineDraw },
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

  // ---- Real matchup + stat comparison (EPL only) — each side's own real Understat row, opponent-independent ----
  const awayOffense = offenseRows(away);
  const homeOffense = offenseRows(home);
  const teamAway =
    away && awayOffense.length > 0 && defenseRows(home).length > 0
      ? {
          title: 'Team matchup — attack vs. defense',
          subjectName: away.team.name,
          subjectHeadshotUrl: away.team.logoUrl ?? undefined,
          subjectTeamAbbr: game.awayAbbr,
          subjectTeamLogoUrl: away.team.logoUrl ?? undefined,
          subjectStats: awayOffense,
          subjectRoleLabel: 'Produces',
          opponentName: `${game.homeAbbr} defense`,
          opponentHeadshotUrl: game.homeLogoUrl,
          opponentTeamAbbr: game.homeAbbr,
          opponentTeamLogoUrl: game.homeLogoUrl,
          opponentStats: defenseRows(home),
          opponentRoleLabel: 'Allows',
        }
      : null;
  const teamHome =
    home && homeOffense.length > 0 && defenseRows(away).length > 0
      ? {
          title: 'Team matchup — attack vs. defense',
          subjectName: home.team.name,
          subjectHeadshotUrl: home.team.logoUrl ?? undefined,
          subjectTeamAbbr: game.homeAbbr,
          subjectTeamLogoUrl: home.team.logoUrl ?? undefined,
          subjectStats: homeOffense,
          subjectRoleLabel: 'Produces',
          opponentName: `${game.awayAbbr} defense`,
          opponentHeadshotUrl: game.awayLogoUrl,
          opponentTeamAbbr: game.awayAbbr,
          opponentTeamLogoUrl: game.awayLogoUrl,
          opponentStats: defenseRows(away),
          opponentRoleLabel: 'Allows',
        }
      : null;
  const matchup: GameMatchupData | null =
    teamAway || teamHome ? { tabs: [{ key: 'team', label: 'Team' }], teamAway, teamHome } : null;

  // ---- Season rollup (Phase 6.15) ----
  //
  // The matchup card above keeps its own source for the reason CFB's does: it
  // needs an ALLOWED side per team, and `player_game_history` records what a
  // player did, never what his opponent gave up.
  //
  // `statComparison` IS replaced. It was ONE row -- goals scored per game --
  // against nine ranked stats across Attack, Defence and Discipline here.
  const spec = league === 'mls' ? SOCCER_MLS_SEASON_SPEC : SOCCER_EPL_SEASON_SPEC;
  const awayAgg = away ? seasonRanks?.byEntity[String(away.team.teamId)] : null;
  const homeAgg = home ? seasonRanks?.byEntity[String(home.team.teamId)] : null;
  // Said out loud on the card: the rollup falls back a season when the newest
  // one is still a stub, which is the normal August state of both leagues.
  const seasonLabel = seasonRanks?.season ? `${seasonRanks.season} season` : undefined;
  const statComparisonGroups = toStatComparisonGroups(spec, awayAgg, homeAgg);
  const statComparison: StatComparisonData | null =
    statComparisonGroups.length > 0
      ? { awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, ranked: statComparisonGroups, seasonLabel }
      : null;

  return {
    gameId: game.gameId,
    gameLine,
    hero,
    matchup,
    records,
    statComparison,
    lastFive,
    rankings:
      awayAgg && homeAgg
        ? {
            // `againstRanks` is the opponent's own for-ranks -- "the ranks you
            // are up against" -- NFL's existing convention on this block.
            away: { forRanks: toRankMap(awayAgg), againstRanks: toRankMap(homeAgg) },
            home: { forRanks: toRankMap(homeAgg), againstRanks: toRankMap(awayAgg) },
            statKeys: awayAgg.stats.map((st) => ({ key: st.key, label: st.label, decimals: st.decimals })),
            awayAbbr: game.awayAbbr,
            homeAbbr: game.homeAbbr,
            awayLogoUrl: game.awayLogoUrl,
            homeLogoUrl: game.homeLogoUrl,
            poolSize: seasonRanks?.poolSize ?? 0,
            seasonLabel,
          }
        : null,
    unitGrades: {
      away: awayAgg && awayAgg.units.length > 0 ? awayAgg.units : null,
      home: homeAgg && homeAgg.units.length > 0 ? homeAgg.units : null,
      awayAbbr: game.awayAbbr,
      homeAbbr: game.homeAbbr,
    },
    // EMPTY BECAUSE ESPN DOES NOT PUBLISH SOCCER INJURIES, not because nobody
    // wired it. `fetchEspnInjuries` is generic over sport/league and CFB, NBA
    // and NHL all use it; `soccer/eng.1/injuries` and `soccer/usa.1/injuries`
    // both answer `"status":"success"` with an EMPTY `injuries` array.
    // Measured against the live endpoints at the same minute as
    // `football/college-football/injuries`, which returned three teams -- so
    // this is the feed, not the season and not the call. Wiring the fetch here
    // would add a page-load request that is always empty.
    injuries: { away: { abbr: game.awayAbbr, logoUrl: game.awayLogoUrl, rows: [] }, home: { abbr: game.homeAbbr, logoUrl: game.homeLogoUrl, rows: [] }, loading: false },
    propsForGame: null,
    picksPanelGame: { id: game.gameId, sport: 'soccer', awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}

