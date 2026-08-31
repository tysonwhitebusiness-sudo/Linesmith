/**
 * `GameDetail.tsx` adapter — tennis half.
 *
 * Converts `/api/tennis/[tour]/game/[gameId]`'s response (fetched by
 * `useTennisGameDetail`) into the shared `GameDetailData` interface. Real:
 * hero (real set scores, status, country flags used as the "team" logo
 * slot — honest for an individual sport with no crest), season record +
 * last-five + head-to-head (from stats.tennismylife.org, same real source
 * `adapter.ts`'s player-level history uses), left-rail props.
 * `statComparison` became real in 6.2b and `rankings`/`unitGrades` in 6.15,
 * all three from the same per-player season rollup.
 *
 * `matchup` STAYS NULL, AND NOT FOR WANT OF DATA. Every other sport's card is
 * this side's production against what the other side ALLOWS, and
 * `player_game_history.opponent_id` is populated on 100% of tennis rows, so
 * the allowed rollup builds fine here. It is TAUTOLOGICAL. A team's "allowed"
 * aggregates over eighty different opponents and says something its own
 * production does not; a tennis match is zero-sum between exactly the two
 * entities on the card, so "what he allows" is the complement of his own
 * results — his opponents' match win rate against him IS one minus his. The
 * card would restate `statComparison` with the arithmetic reversed. Measured
 * the data before deciding, then declined to build it.
 *
 * `propsForGame` stays `null` for the reason MLB's does: `LeftRail` already
 * renders that list for every sport. `pregameLines`
 * (2026-08-26, odds-architecture rebuild) now real when recovered: tennis
 * DOES have a real game-level moneyline (who wins the match — SharpAPI's
 * tennis coverage, OddsHarvester's `match_winner` token), which is a
 * different thing from the per-player PROP markets (aces/games-won/
 * to-win-a-set) that genuinely aren't moneyline-shaped — this adapter's
 * own earlier comment conflated the two. `spread`/`total` stay unset
 * regardless (no such market exists for tennis — `gameLine.spread`/
 * `.total` are simply never populated by any writer, not fabricated null
 * here).
 */

import type { PickCandidate, TennisTour } from '@/lib/core/types';
import type { EspnTennisMatchDetail } from '@/lib/sports/multiSport/espnTennis';
import type { GameDetailData, RecentResultRow, StatComparisonData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregateShapes';
import { toStatComparisonGroups } from '@/lib/sports/shared/seasonAggregateShapes';
import { TENNIS_ATP_SEASON_SPEC, TENNIS_WTA_SEASON_SPEC } from '@/lib/sports/shared/seasonAggregateSpecs';
import { toPriceRange } from '@/lib/sports/shared/priceRange';

interface RecentResultRowWire {
  gameId: string;
  date: string;
  win: boolean;
  opponentAbbr: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
}

function toRows(wire: RecentResultRowWire[]): RecentResultRow[] {
  return wire.map((r) => ({ gameId: r.gameId, date: r.date, win: r.win, opponentAbbr: r.opponentAbbr, isHome: r.isHome, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst }));
}

function toRecord(rows: RecentResultRow[]): { wins: number; losses: number } | null {
  if (rows.length === 0) return null;
  return { wins: rows.filter((r) => r.win === true).length, losses: rows.filter((r) => r.win === false).length };
}

export interface TennisGameDetailInput {
  tour: TennisTour;
  meta: EspnTennisMatchDetail;
  player1Recent: RecentResultRowWire[];
  player2Recent: RecentResultRowWire[];
  player1H2h: RecentResultRowWire[];
  player2H2h: RecentResultRowWire[];
  /** Page-filtered player-level candidates for this match. */
  candidates: PickCandidate[];
  /** The real per-match bookmaker grid (odds-architecture rebuild Phase 6)
   * — see CfbGameDetailInput's identical field for the full reasoning.
   * home/away here follow the same player1/player2 -> home/away mapping
   * this adapter's hero already uses (arbitrary, no real home/away for an
   * individual sport), so home/away odds land on the correct player as
   * long as the writer (harvester_scrape.py's tennis matching) resolves
   * against the same ESPN-sourced game identity this page does. */
  gameLine: UnifiedGameLine | null;
  /**
   * League-wide season aggregates and ranks for this tour (`useSeasonRanks`),
   * Phase 6.2b. `null` while loading or if the rollup fails.
   */
  seasonRanks: SeasonAggregateResult | null;
}

/** `EntitySeasonAggregate.stats` -> the `Record<key, rank>` the Rankings block reads. A missing rank stays `null` rather than becoming "0", which would render as the best rank in the pool. */
function toRankMap(agg: { stats: Array<{ key: string; rank: number }> }): Record<string, string | null> {
  return Object.fromEntries(agg.stats.map((st) => [st.key, st.rank == null ? null : String(st.rank)]));
}

export function toGameDetailData(input: TennisGameDetailInput): GameDetailData {
  const { tour, meta, player1Recent, player2Recent, player1H2h, player2H2h, candidates, gameLine, seasonRanks } = input;

  const p1Recent = toRows(player1Recent);
  const p2Recent = toRows(player2Recent);
  const p1H2h = toRows(player1H2h);
  const p2H2h = toRows(player2H2h);

  const isLive = meta.status.state === 'in';
  const isFinal = meta.status.state === 'post';

  // Player1/player2 map onto the shared hero's away/home slots — arbitrary
  // for an individual sport with no real home/away, same convention
  // `multiSportGameContext.ts`'s tennis branch already documents.
  const hero: GameDetailData['hero'] = {
    away: {
      abbr: meta.player2.name,
      name: meta.player2.name,
      href: `/tennis/${tour}/player/${encodeURIComponent(meta.player2.subjectId)}`,
      logoUrl: meta.player2.flagUrl ?? undefined,
      record: toRecord(p2Recent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    home: {
      abbr: meta.player1.name,
      name: meta.player1.name,
      href: `/tennis/${tour}/player/${encodeURIComponent(meta.player1.subjectId)}`,
      logoUrl: meta.player1.flagUrl ?? undefined,
      record: toRecord(p1Recent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    isLive,
    isFinal,
    liveScore: isLive || isFinal ? { away: String(meta.player2.setsWon[0] ?? 0), home: String(meta.player1.setsWon[0] ?? 0) } : undefined,
    livePeriodLabel: isLive || isFinal ? meta.status.detail : undefined,
    startTimeLabel: new Date(meta.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    model: null,
    pickLockAt: null,
    pickLoading: false,
    venue: null,
    // No spread/total slot: tennis genuinely has no such market — see this
    // file's header. Moneyline only, when recovered.
    pregameLines: gameLine?.moneyline
      ? { moneyline: { away: gameLine.moneyline.away ?? null, home: gameLine.moneyline.home ?? null } }
      : null,
  };

  const records: { away: RecordsSectionTeam; home: RecordsSectionTeam; loading: boolean } = {
    away: { abbr: meta.player2.name, logoUrl: meta.player2.flagUrl ?? undefined, divisionRank: null, season: toRecord(p2Recent), seasonHome: null, seasonAway: null, recent: p2Recent.slice(0, 5), h2h: p2H2h },
    home: { abbr: meta.player1.name, logoUrl: meta.player1.flagUrl ?? undefined, divisionRank: null, season: toRecord(p1Recent), seasonHome: null, seasonAway: null, recent: p1Recent.slice(0, 5), h2h: p1H2h },
    loading: false,
  };

  const lastFive: { away: LastFiveGamesTeam; home: LastFiveGamesTeam; loading: boolean } = {
    away: { abbr: meta.player2.name, logoUrl: meta.player2.flagUrl ?? undefined, games: p2Recent.slice(0, 5) },
    home: { abbr: meta.player1.name, logoUrl: meta.player1.flagUrl ?? undefined, games: p1Recent.slice(0, 5) },
    loading: false,
  };

  // Stat comparison — Phase 6.2b. Was hardcoded `null` ("no grading model or
  // opponent-conditional stat source for tennis"). Tennis compares two
  // PLAYERS rather than two teams, which is why the season rollup groups this
  // sport by `athlete_id`: all 271,964 tennis rows carry a null `team_id`, so
  // a team rollup would return nothing at all.
  //
  // `meta.playerN.subjectId` is `espn:tennis:{competitorId}` while the table
  // stores the bare competitor id, so the prefix comes off before the lookup.
  // Both sides are the same ESPN field — verified against real data, 60 of 60
  // sampled `prop_odds` tennis subject ids resolve to a real `athlete_id`.
  //
  // The pool is singles only; doubles pairings are excluded upstream (see
  // `excludeCompoundIds`), so a doubles match simply finds no aggregate and
  // renders the empty state rather than ranking a pair against singles players.
  const tennisSpec = tour === 'wta' ? TENNIS_WTA_SEASON_SPEC : TENNIS_ATP_SEASON_SPEC;
  const bareId = (subjectId: string) => subjectId.replace(/^espn:tennis:/, '');
  const p2Agg = seasonRanks?.byEntity[bareId(meta.player2.subjectId)] ?? null;
  const p1Agg = seasonRanks?.byEntity[bareId(meta.player1.subjectId)] ?? null;
  // Which season these ranks are FROM, said on the card -- the rollup falls
  // back a season when the newest one is still a stub.
  const seasonLabel = seasonRanks?.season ? `${seasonRanks.season} season` : undefined;
  const tennisStatGroups = toStatComparisonGroups(tennisSpec, p2Agg, p1Agg);
  const statComparison: StatComparisonData | null =
    tennisStatGroups.length > 0
      ? { awayAbbr: meta.player2.name, homeAbbr: meta.player1.name, ranked: tennisStatGroups, seasonLabel }
      : null;

  return {
    gameId: meta.matchId,
    gameLine,
    hero,
    matchup: null,
    records,
    statComparison,
    lastFive,
    // Phase 6.15 -- from the SAME aggregates the comparison above already
    // reads, so a player's rank in a stat row and the ranks behind his unit
    // grade cannot disagree. The pool is singles only; a doubles pairing finds
    // no aggregate and both blocks stay null rather than ranking a pair
    // against individuals.
    //
    // `againstRanks` is the OPPONENT'S OWN for-ranks -- "the ranks you are up
    // against" -- which is the convention every other sport's game page uses
    // on this block.
    rankings:
      p1Agg && p2Agg
        ? {
            away: { forRanks: toRankMap(p2Agg), againstRanks: toRankMap(p1Agg) },
            home: { forRanks: toRankMap(p1Agg), againstRanks: toRankMap(p2Agg) },
            statKeys: p1Agg.stats.map((st) => ({ key: st.key, label: st.label, decimals: st.decimals })),
            awayAbbr: meta.player2.name,
            homeAbbr: meta.player1.name,
            awayLogoUrl: meta.player2.flagUrl ?? undefined,
            homeLogoUrl: meta.player1.flagUrl ?? undefined,
            poolSize: seasonRanks?.poolSize ?? 0,
            seasonLabel,
          }
        : null,
    unitGrades: {
      away: p2Agg && p2Agg.units.length > 0 ? p2Agg.units : null,
      home: p1Agg && p1Agg.units.length > 0 ? p1Agg.units : null,
      awayAbbr: meta.player2.name,
      homeAbbr: meta.player1.name,
    },
    injuries: { away: { abbr: meta.player2.name, logoUrl: meta.player2.flagUrl ?? undefined, rows: [] }, home: { abbr: meta.player1.name, logoUrl: meta.player1.flagUrl ?? undefined, rows: [] }, loading: false },
    priceRange: toPriceRange(gameLine, meta.player1.name),
    picksPanelGame: { id: meta.matchId, sport: 'tennis', awayAbbr: meta.player2.name, homeAbbr: meta.player1.name, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}
