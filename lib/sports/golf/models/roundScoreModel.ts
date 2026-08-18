/**
 * Round Score Predictor — Phase A (see project memory's golf model gameplan).
 *
 * Expected round score + P(under par)/P(even par)/P(over par) for one
 * golfer's upcoming round, built entirely from data already live today —
 * same "no fitted weights yet" position as holeScoreModel.ts, replaced by
 * Phase B once golf_round_scores has a real sample to fit against.
 *
 * Two independent estimates, blended by shrinkage rather than stacked
 * additively (stacking would double-count: a golfer's own results this week
 * already reflect their skill edge, so adding a separate skill term on top
 * of their own observed scores would count it twice):
 *  1. A "should" estimate — this week's field-observed course difficulty,
 *     the golfer's season SG:Total edge vs. that field, and a disclosed
 *     wind adjustment.
 *  2. A "has actually" estimate — the golfer's own scores earlier this
 *     tournament, when there are any.
 * Bucket probabilities come from treating that blended expectation as the
 * mean of a Normal distribution with a documented ~2.8-stroke round-to-round
 * standard deviation (a widely published PGA Tour approximation, not fit)
 * and reading off P(score < 0) / P(score > 0) with a continuity correction
 * for the P(score == 0) mass in between.
 */

import { normalCdf } from '../../../core/normalDist';

export interface RoundFieldObservation {
  relativeToPar: number;
}

export interface RoundModelInput {
  /** Every golfer's completed-round score (relative to par) at this course this week so far. */
  fieldObservations: RoundFieldObservation[];
  /** The subject golfer's own completed rounds this week. */
  golferOwnObservations: RoundFieldObservation[];
  golferSgTotal: number | null;
  fieldAvgSgTotal: number | null;
  /** Live wind reading at the course, mph — null when unavailable. */
  windMph: number | null;
}

export interface RoundPrediction {
  expectedRelativeToPar: number;
  probUnderPar: number;
  probEvenPar: number;
  probOverPar: number;
  fieldSampleSize: number;
  basis: string[];
}

/** Widely published PGA Tour round-to-round scoring standard deviation — a documented approximation, not fit against this app's own data. Exported so tournamentWinModel.ts's Monte Carlo sim draws from the same figure this model's own bucket probabilities are built on. */
export const ROUND_SCORE_SD = 2.8;
/** Below this wind speed, the disclosed adjustment stays at 0 — calm-day noise isn't a real scoring effect. */
const WIND_THRESHOLD_MPH = 10;
/** Strokes added per mph of wind above the threshold — a modest, disclosed v1 constant. Real wind sensitivity almost certainly varies by course/hole design; Phase B fits this for real once golf_round_scores carries enough wind-tagged rounds. */
const WIND_STROKES_PER_MPH = 0.05;
/** Empirical-Bayes-style shrinkage constant — with 3 rounds of a golfer's own results this week, their own history and the skill/field estimate get roughly equal weight; more rounds tilt further toward their own observed form. */
const OWN_HISTORY_PRIOR_STRENGTH = 3;

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

interface RoundBuckets {
  probUnderPar: number;
  probEvenPar: number;
  probOverPar: number;
}

/**
 * Continuity-corrected discretization, shared by the full prediction below
 * and `fieldBaselineBucketProbs`: score < -0.5 rounds down to "under par",
 * score > 0.5 rounds up to "over par", the half-stroke band between them is
 * the P(score == 0) mass a continuous Normal can't place exactly.
 */
function bucketize(mean: number): RoundBuckets {
  const probUnderPar = normalCdf(-0.5, mean, ROUND_SCORE_SD);
  const probOverPar = 1 - normalCdf(0.5, mean, ROUND_SCORE_SD);
  const probEvenPar = Math.max(0, 1 - probUnderPar - probOverPar);
  const sum = probUnderPar + probOverPar + probEvenPar;
  return { probUnderPar: probUnderPar / sum, probEvenPar: probEvenPar / sum, probOverPar: probOverPar / sum };
}

/**
 * Bucket probabilities from the field-observed baseline alone — no skill,
 * weather, or own-history adjustment. The "league rate" a round-score
 * candidate's model conviction is measured against (see propScore.ts's `M`
 * component), same role `priorHoleCategoryRate` plays for hole candidates.
 */
export function fieldBaselineBucketProbs(fieldObservations: RoundFieldObservation[]): RoundBuckets {
  const fieldBaseline = average(fieldObservations.map((o) => o.relativeToPar)) ?? 0;
  return bucketize(fieldBaseline);
}

export function predictRoundScore(input: RoundModelInput): RoundPrediction {
  const basis: string[] = [];

  const fieldBaseline = average(input.fieldObservations.map((o) => o.relativeToPar)) ?? 0;
  basis.push(
    input.fieldObservations.length > 0
      ? `Field: ${input.fieldObservations.length} completed rounds this week, averaging ${fieldBaseline >= 0 ? '+' : ''}${fieldBaseline.toFixed(2)}`
      : 'Field: no completed rounds yet this week — course-difficulty baseline defaults to even par.',
  );

  let skillAdj = 0;
  if (input.golferSgTotal != null && input.fieldAvgSgTotal != null) {
    skillAdj = -(input.golferSgTotal - input.fieldAvgSgTotal);
    basis.push(`Skill: ${input.golferSgTotal >= input.fieldAvgSgTotal ? '+' : ''}${(input.golferSgTotal - input.fieldAvgSgTotal).toFixed(2)} SG/round vs. field average`);
  } else {
    basis.push('Skill: no season SG:Total available for this golfer.');
  }

  let windAdj = 0;
  if (input.windMph != null && input.windMph > WIND_THRESHOLD_MPH) {
    windAdj = (input.windMph - WIND_THRESHOLD_MPH) * WIND_STROKES_PER_MPH;
    basis.push(`Weather: ${input.windMph.toFixed(0)} mph wind, +${windAdj.toFixed(2)} strokes`);
  }

  const skillEstimate = fieldBaseline + skillAdj + windAdj;

  const ownAvg = average(input.golferOwnObservations.map((o) => o.relativeToPar));
  let expected = skillEstimate;
  if (ownAvg != null) {
    const n = input.golferOwnObservations.length;
    const ownWeight = n / (n + OWN_HISTORY_PRIOR_STRENGTH);
    expected = ownWeight * ownAvg + (1 - ownWeight) * skillEstimate;
    basis.push(`This golfer's own rounds this week: ${n}, averaging ${ownAvg >= 0 ? '+' : ''}${ownAvg.toFixed(2)} (blended at ${(ownWeight * 100).toFixed(0)}% weight)`);
  }

  const buckets = bucketize(expected);

  return {
    expectedRelativeToPar: expected,
    ...buckets,
    fieldSampleSize: input.fieldObservations.length,
    basis,
  };
}
