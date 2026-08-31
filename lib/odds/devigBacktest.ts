/**
 * Backtesting the de-vig methods against settled outcomes — Phase 6.24.
 *
 * ============ WHY THIS EXISTS SEPARATELY FROM THE METHODS ============
 *
 * `devigMethods.ts` adds power, Shin and worst-case beside the multiplicative
 * method the app has always used. Switching the default changes every edge the
 * app displays, so the choice has to be made on evidence. This assembles that
 * evidence and — importantly — reports when there is not enough of it.
 *
 * ============ THE SAMPLE IS THE FINDING, AND IT IS SMALL ============
 *
 * A de-vig backtest needs three things per observation: a RAW two-sided price,
 * the outcome, and both at the same book. Measured 2026-08-31:
 *
 *  - **`historical_odds` cannot be used at all.** It holds 37,922 games with
 *    two-sided probabilities and final scores, which looks ideal — but
 *    `ml_home_consensus_prob + ml_away_consensus_prob` is **exactly 1.0000 on
 *    every single row**. The vig was removed before storage. You cannot compare
 *    methods for removing a margin that is already gone, and every method would
 *    return the input unchanged.
 *  - **`game_odds_history` joined to settled `game_picks` yields 82 games** with
 *    a genuine closing two-sided moneyline. That log only began on 2026-08-12,
 *    so this number grows daily with no further code.
 *
 * Eighty-two observations cannot separate methods whose predictions differ by
 * one or two probability points. `MIN_SAMPLE_FOR_VERDICT` encodes that: below
 * it, this reports the numbers and explicitly declines to name a winner. A
 * confident ranking off 82 games would be the exact failure this whole exercise
 * exists to avoid — picking the method that flatters the model rather than the
 * one that predicts.
 *
 * ============ SCORED ON CALIBRATION, NOT ON EDGE ============
 *
 * The score is the Brier score of each method's fair probability against the
 * realised outcome, plus a bucketed calibration error. Deliberately NOT
 * "which method finds the most edge": every de-vig produces more apparent edge
 * the more aggressively it shades a side, so ranking on edge would reliably
 * select the most wrong method.
 */

import { pgAll } from '@/lib/db/pgClient';
import { DEVIG_METHODS, devigBy, type DevigMethod } from './devigMethods';

/**
 * Below this, no winner is declared. Distinguishing methods that differ by
 * ~1-2 probability points needs on the order of a thousand settled games; this
 * is a floor, not a sufficiency claim.
 */
export const MIN_SAMPLE_FOR_VERDICT = 1000;

export interface DevigObservation {
  gameId: string;
  homeDecimal: number;
  awayDecimal: number;
  /** 1 when the home side won, 0 when it lost. */
  homeWon: 0 | 1;
}

export interface MethodScore {
  method: DevigMethod;
  n: number;
  /** Mean squared error of the fair probability against the outcome. Lower is better. */
  brier: number;
  /** Mean |predicted - realised| across probability deciles. Lower is better. */
  calibrationError: number;
  /** Mean predicted home probability, against the realised home win rate below. */
  meanPredicted: number;
}

export interface DevigBacktestResult {
  sampleSize: number;
  realisedHomeWinRate: number | null;
  scores: MethodScore[];
  /** `null` below `MIN_SAMPLE_FOR_VERDICT` — deliberately, see the header. */
  verdict: DevigMethod | null;
  note: string;
}

/** American odds -> decimal. */
function toDecimal(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / -american + 1;
}

/**
 * Settled games with a real closing two-sided moneyline at the same book.
 *
 * DISTINCT ON takes the last observation per side, which is the same closing
 * definition `get_closing_price` and `userClv.ts` use — three places now agree
 * about what "the close" means, rather than each choosing.
 */
export async function loadDevigObservations(): Promise<DevigObservation[]> {
  const rows = await pgAll<{ game_id: string; home_odds: number; away_odds: number; home_score: number; away_score: number }>(
    `WITH closes AS (
       SELECT DISTINCT ON (event_id, side) event_id, side, american_odds
         FROM game_odds_history
        WHERE market = 'moneyline'
        ORDER BY event_id, side, observed_at DESC, id DESC
     )
     SELECT gp.game_id,
            h.american_odds AS home_odds,
            a.american_odds AS away_odds,
            gp.final_home_score AS home_score,
            gp.final_away_score AS away_score
       FROM game_picks gp
       JOIN closes h ON h.event_id = gp.game_id AND h.side = 'home'
       JOIN closes a ON a.event_id = gp.game_id AND a.side = 'away'
      WHERE gp.final_home_score IS NOT NULL AND gp.final_away_score IS NOT NULL
        AND gp.final_home_score <> gp.final_away_score`,
    [],
  );

  return rows
    .map((r) => {
      const home = Number(r.home_odds);
      const away = Number(r.away_odds);
      if (!Number.isFinite(home) || !Number.isFinite(away) || home === 0 || away === 0) return null;
      // THE OUTCOME COMES FROM THE SCORES, NOT FROM `ml_outcome`.
      // `ml_outcome` grades whether the MODEL's pick won, and the model does
      // not always pick the home side — reading it as a home result would
      // score every method against a label that means something else. Ties are
      // excluded in the query rather than assigned a side.
      const homeScore = Number(r.home_score);
      const awayScore = Number(r.away_score);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
      return {
        gameId: r.game_id,
        homeDecimal: toDecimal(home),
        awayDecimal: toDecimal(away),
        homeWon: (homeScore > awayScore ? 1 : 0) as 0 | 1,
      };
    })
    .filter((o): o is DevigObservation => o !== null);
}

/** Ten equal-width probability buckets; a bucket with nothing in it contributes nothing. */
function calibrationError(pairs: Array<{ p: number; y: number }>): number {
  const buckets = new Map<number, { p: number; y: number; n: number }>();
  for (const { p, y } of pairs) {
    const b = Math.min(9, Math.floor(p * 10));
    const acc = buckets.get(b) ?? { p: 0, y: 0, n: 0 };
    acc.p += p;
    acc.y += y;
    acc.n += 1;
    buckets.set(b, acc);
  }
  const errs = [...buckets.values()].map((b) => Math.abs(b.p / b.n - b.y / b.n));
  return errs.length ? errs.reduce((s, e) => s + e, 0) / errs.length : 0;
}

export function scoreMethods(observations: readonly DevigObservation[]): DevigBacktestResult {
  const n = observations.length;
  const realised = n ? observations.reduce((s, o) => s + o.homeWon, 0) / n : null;

  const scores: MethodScore[] = DEVIG_METHODS.map((method) => {
    const pairs: Array<{ p: number; y: number }> = [];
    for (const o of observations) {
      const r = devigBy(method, o.homeDecimal, o.awayDecimal);
      if (!r) continue;
      pairs.push({ p: r.a, y: o.homeWon });
    }
    const brier = pairs.length ? pairs.reduce((s, { p, y }) => s + (p - y) ** 2, 0) / pairs.length : 0;
    return {
      method,
      n: pairs.length,
      brier,
      calibrationError: calibrationError(pairs),
      meanPredicted: pairs.length ? pairs.reduce((s, { p }) => s + p, 0) / pairs.length : 0,
    };
  }).sort((a, b) => a.brier - b.brier);

  const enough = n >= MIN_SAMPLE_FOR_VERDICT;
  return {
    sampleSize: n,
    realisedHomeWinRate: realised,
    scores,
    // NO WINNER BELOW THE FLOOR. Ranking four methods on a sample that cannot
    // separate them produces a confident answer with no information in it.
    verdict: enough ? (scores[0]?.method ?? null) : null,
    note: enough
      ? `Ranked on Brier score over ${n} settled games.`
      : `${n} settled games with a raw two-sided close — below the ${MIN_SAMPLE_FOR_VERDICT} needed to separate methods that differ by one or two probability points. Scores are reported; no method is recommended. The sample grows daily as game_odds_history accumulates.`,
  };
}

export async function runDevigBacktest(): Promise<DevigBacktestResult> {
  return scoreMethods(await loadDevigObservations());
}
