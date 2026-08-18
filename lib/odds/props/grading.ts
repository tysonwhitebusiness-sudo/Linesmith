/**
 * Phase C.0 — grades `pick_history` rows against what actually happened,
 * once a game is final. One `getLiveFeed` call per game supplies both the
 * final box score (per-player batting/pitching lines, same field names as
 * the season gamelog `statEntry`/`hitEntry` already read) and the 1st-inning
 * linescore, so every table-driven market plus `hit-in-game` and
 * `first-inning` can be graded from a single fetch — no new data source.
 *
 * `vs-LHP`/`vs-RHP` are not graded here: grading them needs the specific
 * opposing starter's handedness for that past game, which the live feed
 * doesn't surface as directly as the other three. Left ungraded rather than
 * guessed at — a real gap, not a silent one.
 */

import { getLiveFeed } from '../../sports/mlb/statsapi';
import { STAT_MARKET_BY_DIMENSION, PITCHER_MARKET_DIMENSIONS } from '../../sports/mlb/adapter';
import {
  listUngradedGameIds,
  listUngradedForGame,
  writeGrades,
  readPropOddsHistoryForKey,
  type GradeResult,
  type UngradedRow,
  type PropOddsHistoryPoint,
} from '../../db/client';
import { americanToDecimal } from '../display';
import { devigTwoWay } from '../devig';

/**
 * The market's side of the edge, joined in after the fact — grading is the
 * first point a row's actual `surfaced_at` can be matched against the price
 * history that was building in `prop_odds_history` at the same moment.
 * Picks the (provider, bookmaker) pair with both an over and an under
 * observed closest in time to when the candidate was actually surfaced,
 * rather than mixing sides from different books, which would misrepresent
 * the vig.
 */
function findClosestPricePair(
  points: PropOddsHistoryPoint[],
  surfacedAt: string,
): { over: PropOddsHistoryPoint; under: PropOddsHistoryPoint } | null {
  const target = Date.parse(surfacedAt);
  if (!Number.isFinite(target)) return null;

  const byBook = new Map<string, PropOddsHistoryPoint[]>();
  for (const p of points) {
    const key = `${p.providerId}:${p.bookmaker}`;
    const list = byBook.get(key) ?? [];
    list.push(p);
    byBook.set(key, list);
  }

  const closestTo = (arr: PropOddsHistoryPoint[]) =>
    arr.reduce((best, p) => (Math.abs(Date.parse(p.observedAt) - target) < Math.abs(Date.parse(best.observedAt) - target) ? p : best));

  let best: { over: PropOddsHistoryPoint; under: PropOddsHistoryPoint; diff: number } | null = null;
  for (const pts of byBook.values()) {
    const overs = pts.filter((p) => p.side === 'over');
    const unders = pts.filter((p) => p.side === 'under');
    if (overs.length === 0 || unders.length === 0) continue;
    const over = closestTo(overs);
    const under = closestTo(unders);
    const diff = Math.abs(Date.parse(over.observedAt) - target) + Math.abs(Date.parse(under.observedAt) - target);
    if (!best || diff < best.diff) best = { over, under, diff };
  }
  return best;
}

/** Market probability + edge, when the row has a model prediction and a genuine two-sided price exists to join against. */
function joinMarketSide(row: UngradedRow, gameId: string): Partial<GradeResult> {
  if (!row.marketKey || row.modelProb == null) return {};
  const points = readPropOddsHistoryForKey(gameId, row.subjectId, row.marketKey, row.line);
  if (points.length === 0) return {};
  const pair = findClosestPricePair(points, row.surfacedAt);
  if (!pair) return {};

  const devigged = devigTwoWay(americanToDecimal(pair.over.americanOdds), americanToDecimal(pair.under.americanOdds));
  if (!devigged) return {};

  return {
    marketProb: devigged.a,
    edge: row.modelProb - devigged.a,
    priceSource: pair.over.providerId,
    bookmaker: pair.over.bookmaker,
    priceCapturedAt: pair.over.observedAt,
  };
}

function findPlayer(boxscore: any, subjectId: string): { stats: any; isHome: boolean } | null {
  const home = boxscore?.teams?.home?.players?.[`ID${subjectId}`];
  if (home) return { stats: home.stats, isHome: true };
  const away = boxscore?.teams?.away?.players?.[`ID${subjectId}`];
  if (away) return { stats: away.stats, isHome: false };
  return null;
}

/** G4 — moneyline grades straight from the final score, no box score needed. */
function gradeMoneylineRow(row: UngradedRow, feed: any): GradeResult | null {
  const homeTeamId = feed.gameData?.teams?.home?.id;
  const awayTeamId = feed.gameData?.teams?.away?.id;
  const homeRuns = feed.linescore?.teams?.home?.runs;
  const awayRuns = feed.linescore?.teams?.away?.runs;
  if (homeTeamId == null || awayTeamId == null || homeRuns == null || awayRuns == null || homeRuns === awayRuns) return null;

  const winnerId = homeRuns > awayRuns ? homeTeamId : awayTeamId;
  const won = row.subjectId === `team-${winnerId}`;
  return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: won ? 1 : 0 };
}

/** P1-1 — total grades straight from the final combined score, same as moneyline needs no box score. */
function gradeTotalRow(row: UngradedRow, feed: any): GradeResult | null {
  const homeRuns = feed.linescore?.teams?.home?.runs;
  const awayRuns = feed.linescore?.teams?.away?.runs;
  if (homeRuns == null || awayRuns == null || row.line == null) return null;
  const total = Number(homeRuns) + Number(awayRuns);
  const over = total > row.line;
  // category is always 'over' for a logged total prediction — see logGameTotalPredictions.
  const won = row.category === 'over' ? over : !over;
  return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: total };
}

function gradeRow(row: UngradedRow, boxscore: any, innings: any[]): GradeResult | null {
  if (row.dimension === 'moneyline' || row.dimension === 'total') return null; // handled separately — no box score involved

  const player = findPlayer(boxscore, row.subjectId);
  if (!player) return null; // didn't appear in this game's box score (scratched, etc.)

  if (row.dimension === 'hit-in-game') {
    const hits = Number(player.stats?.batting?.hits ?? 0);
    if (row.category !== 'hit' && row.category !== 'no-hit') return null;
    const won = row.category === 'hit' ? hits > 0 : hits === 0;
    return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: hits };
  }

  if (row.dimension === 'first-inning') {
    const first = innings.find((i) => i.num === 1);
    if (!first) return null;
    // Home team pitches the top of the 1st (retiring the away side); away
    // team pitches the bottom — same convention as firstInningCandidates.
    const runsAllowed = Number((player.isHome ? first.away?.runs : first.home?.runs) ?? 0);
    if (row.category !== 'run' && row.category !== 'no-run') return null;
    const won = row.category === 'run' ? runsAllowed > 0 : runsAllowed === 0;
    return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: runsAllowed };
  }

  const def = STAT_MARKET_BY_DIMENSION[row.dimension];
  if (!def) return null; // vs-LHP/vs-RHP or an unrecognized dimension — not graded here.

  const statGroup = PITCHER_MARKET_DIMENSIONS.has(row.dimension) ? player.stats?.pitching : player.stats?.batting;
  const value = def.valueOf(statGroup ?? {});
  const line = row.line ?? def.line;
  const over = value > line;
  if (row.category !== 'over' && row.category !== 'under') return null;
  const won = row.category === 'over' ? over : !over;
  return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: value };
}

export interface GradingSummary {
  gamesChecked: number;
  gamesFinal: number;
  rowsGraded: number;
  rowsSkipped: number;
}

/** Call on a schedule (piggybacked on the snapshot refresh cycle) — cheap when there's nothing to grade. */
export async function gradeFinishedGames(): Promise<GradingSummary> {
  const gameIds = listUngradedGameIds();
  const summary: GradingSummary = { gamesChecked: gameIds.length, gamesFinal: 0, rowsGraded: 0, rowsSkipped: 0 };

  for (const gameId of gameIds) {
    const gamePk = Number(gameId);
    if (!Number.isFinite(gamePk)) continue;

    const feed = await getLiveFeed(gamePk);
    const state = feed?.gameData?.status?.abstractGameState;
    if (!feed || state !== 'Final') continue; // not final yet — try again next run
    summary.gamesFinal += 1;

    const innings = feed.linescore?.innings ?? [];
    const rows = listUngradedForGame(gameId);
    const results: GradeResult[] = [];
    for (const row of rows) {
      const graded =
        row.dimension === 'moneyline'
          ? gradeMoneylineRow(row, feed)
          : row.dimension === 'total'
            ? gradeTotalRow(row, feed)
            : gradeRow(row, feed.boxscore, innings);
      if (!graded) {
        summary.rowsSkipped += 1;
        continue;
      }
      results.push({ ...graded, ...joinMarketSide(row, gameId) });
    }
    writeGrades(results);
    summary.rowsGraded += results.length;
  }

  return summary;
}
