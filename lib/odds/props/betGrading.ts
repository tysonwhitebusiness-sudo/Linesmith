/**
 * Grades submitted `bets` rows against live/final box scores — the same
 * read-time-reconciliation idea as MLB prop grading (now predict/mlb_prop_grading.py's grade_finished_games)
 * (called there on a schedule; called here from the Live Bets route on
 * every load, since a single-user app has no background job runner). Kept
 * as its own module rather than folded into `grading.ts`: `pick_history`
 * carries market/model-probability columns (`joinMarketSide`) that have no
 * equivalent on `bets`, and `bets`' moneyline/total legs are keyed
 * differently (team abbreviation off `gameMarketCandidate`, not the
 * `team-{id}` convention `game_picks`/`pick_history` uses) — different
 * enough on both ends that sharing one function would mean branching
 * internally on which table called it.
 *
 * Player-prop grading (`gradeBetRow`) mirrors `grading.ts`'s `gradeRow`
 * exactly, including its documented gap: vs-LHP/vs-RHP aren't graded.
 */

import { getLiveFeed } from '../../sports/mlb/statsapi';
import { STAT_MARKET_BY_DIMENSION, PITCHER_MARKET_DIMENSIONS } from '../../sports/mlb/adapter';
import {
  listOpenBetGameIds,
  listOpenBetsForGame,
  markBetsLive,
  writeBetGrades,
  type UngradedBetRow,
  type BetGradeResult,
} from '../../db/client';

function findPlayer(boxscore: any, subjectId: string): { stats: any; isHome: boolean } | null {
  const home = boxscore?.teams?.home?.players?.[`ID${subjectId}`];
  if (home) return { stats: home.stats, isHome: true };
  const away = boxscore?.teams?.away?.players?.[`ID${subjectId}`];
  if (away) return { stats: away.stats, isHome: false };
  return null;
}

/** Moneyline leg — `category` is the team abbreviation `gameMarketCandidate` stashed it as, matched against the feed's own team abbreviations rather than a team ID (bets don't carry one). */
function gradeMoneylineBet(row: UngradedBetRow, feed: any): BetGradeResult | null {
  const homeAbbr = feed.gameData?.teams?.home?.abbreviation;
  const awayAbbr = feed.gameData?.teams?.away?.abbreviation;
  const homeRuns = feed.linescore?.teams?.home?.runs;
  const awayRuns = feed.linescore?.teams?.away?.runs;
  if (homeRuns == null || awayRuns == null) return null;
  if (homeRuns === awayRuns) return { id: row.id, outcome: 'push', actualValue: null };

  const pickedHome = row.category === homeAbbr;
  const pickedAway = row.category === awayAbbr;
  if (!pickedHome && !pickedAway) return null; // abbreviation didn't match either side — can't grade safely

  const homeWon = homeRuns > awayRuns;
  const won = pickedHome ? homeWon : !homeWon;
  return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: homeWon ? homeRuns : awayRuns };
}

/** Total leg — same arithmetic as `grading.ts`'s `gradeTotalRow`; `category` is 'over' | 'under' here (game-market convention), not the season-total-prediction 'over'-only convention pick_history uses. */
function gradeTotalBet(row: UngradedBetRow, feed: any): BetGradeResult | null {
  const homeRuns = feed.linescore?.teams?.home?.runs;
  const awayRuns = feed.linescore?.teams?.away?.runs;
  if (homeRuns == null || awayRuns == null || row.line == null) return null;
  const total = Number(homeRuns) + Number(awayRuns);
  if (total === row.line) return { id: row.id, outcome: 'push', actualValue: total };
  const over = total > row.line;
  if (row.category !== 'over' && row.category !== 'under') return null;
  const won = row.category === 'over' ? over : !over;
  return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: total };
}

/** Player prop leg — hit-in-game / first-inning / the shared stat-market table, identical rules to `grading.ts`'s `gradeRow`. */
function gradeBetRow(row: UngradedBetRow, boxscore: any, innings: any[]): BetGradeResult | null {
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
    const runsAllowed = Number((player.isHome ? first.away?.runs : first.home?.runs) ?? 0);
    if (row.category !== 'run' && row.category !== 'no-run') return null;
    const won = row.category === 'run' ? runsAllowed > 0 : runsAllowed === 0;
    return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: runsAllowed };
  }

  const def = STAT_MARKET_BY_DIMENSION[row.dimension];
  if (!def) return null; // moneyline/total handled separately above; vs-LHP/vs-RHP not graded here, same gap as grading.ts

  const statGroup = PITCHER_MARKET_DIMENSIONS.has(row.dimension) ? player.stats?.pitching : player.stats?.batting;
  const value = def.valueOf(statGroup ?? {});
  const line = row.line ?? def.line;
  if (row.category !== 'over' && row.category !== 'under') return null;
  if (value === line) return { id: row.id, outcome: 'push', actualValue: value };
  const over = value > line;
  const won = row.category === 'over' ? over : !over;
  return { id: row.id, outcome: won ? 'win' : 'loss', actualValue: value };
}

export interface BetGradingSummary {
  gamesChecked: number;
  gamesFinal: number;
  betsGraded: number;
  betsSkipped: number;
}

/** Call whenever Live Bets is loaded — cheap (one live-feed fetch per open game) when there's nothing to grade. */
export async function gradeOpenBets(): Promise<BetGradingSummary> {
  const gameIds = await listOpenBetGameIds();
  const summary: BetGradingSummary = { gamesChecked: gameIds.length, gamesFinal: 0, betsGraded: 0, betsSkipped: 0 };

  for (const gameId of gameIds) {
    const gamePk = Number(gameId);
    if (!Number.isFinite(gamePk)) continue;

    const feed = await getLiveFeed(gamePk);
    const state = feed?.gameData?.status?.abstractGameState;
    if (!feed || !state) continue;

    if (state === 'Live') await markBetsLive(gameId);
    if (state !== 'Final') continue; // not final yet — try again next load

    summary.gamesFinal += 1;
    const innings = feed.linescore?.innings ?? [];
    const rows = await listOpenBetsForGame(gameId);
    const results: BetGradeResult[] = [];
    for (const row of rows) {
      const graded =
        row.dimension === 'moneyline'
          ? gradeMoneylineBet(row, feed)
          : row.dimension === 'total'
            ? gradeTotalBet(row, feed)
            : gradeBetRow(row, feed.boxscore, innings);
      if (!graded) {
        summary.betsSkipped += 1;
        continue;
      }
      results.push(graded);
    }
    await writeBetGrades(results);
    summary.betsGraded += results.length;
  }

  return summary;
}
