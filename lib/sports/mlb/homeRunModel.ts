/**
 * Home Run model — standalone fitted regression, `market = 'home-run'` in
 * `model_weights`. Extends the existing live Beta-Binomial `home-runs` prop
 * posterior (edgeModel.ts / adapter.ts's `barrelPct` matchup shift) with
 * three new signals absent from it: park factor, an explicit pitcher-vs-
 * batter matchup blend, and lineup-order/expected-PA. See
 * docs/hr-predictor-plan.md for the full plan this file implements.
 *
 * Combined the same way gameModel.ts's Moneyline/Totals are: raw signals as
 * named features, `fitLogisticRegression` (homeRunModelFit.ts) learns the
 * weights from real history, `activated = holdoutBrier < baselineHoldoutBrier`
 * decides whether a version goes live. This file only builds the raw
 * feature functions — pure, no DB/network access — so they're identical
 * whether called from the historical training builder or the live path.
 */

import { predictProb } from '../../core/logisticRegression';

/** Same feature order as HOME_RUN_FEATURE_NAMES in homeRunModelFit.ts — shared so training and live prediction can never drift apart. */
export const HOME_RUN_FEATURE_NAMES = ['betaBinomialHrProb', 'parkHrFactorCentered', 'pitcherMatchupSignal', 'expectedPaCentered'] as const;

/**
 * Park factor as a regression feature. Reuses parkFactors.ts's existing
 * factor directly — NOT an HR-specific venue factor, a disclosed v1
 * simplification. parkFactors.ts measures combined-runs-per-game at a venue
 * relative to league average (built for the Moneyline/Totals runs
 * environment), not home-run rate specifically. A park that inflates
 * doubles/triples without inflating HR (spacious gaps, short fences) or vice
 * versa (short porch, otherwise pitcher-friendly) isn't captured correctly by
 * this proxy. A true HR-specific venue factor — HR rate per venue vs. league
 * HR rate, the same shape as computeParkFactors but keyed on home runs
 * instead of total runs — would need a per-game boxscore pull (HR counts
 * aren't in the schedule feed computeParkFactors already uses) and is a
 * natural v2 upgrade, not required to ship v1. `1.0` (neutral) in, `0` out.
 */
export function parkHrFactorCentered(parkFactor: number): number {
  return parkFactor - 1;
}

/** Keeps a rate strictly inside (0, 1) so log-odds below never divide by zero or take log(0) — same guard role as gameModel.ts's Math.max(x, 0.1) on Pythagorean inputs. */
function clampRate(rate: number): number {
  return Math.min(0.999, Math.max(0.001, rate));
}

function logOdds(rate: number): number {
  const r = clampRate(rate);
  return Math.log(r / (1 - r));
}

/**
 * Pitcher's own HR-rate-allowed vs. league average, in log-odds units — 0
 * when the pitcher allows HRs at exactly the league rate, positive when he
 * allows more, negative when he suppresses them. Log-odds (not a raw ratio
 * or log5()) so it's naturally centered at 0 and combines additively with
 * the other features once the regression fits its weight, the same
 * "_centered" convention modelFit.ts already uses for parkFactorCentered/
 * marketProbCentered.
 *
 * Deliberately pitcher-only, not a batter+pitcher blend, even though the
 * plan doc's original description paired it with the batter's platoon
 * split: the batter's own rate is already feature #1
 * (betaBinomialHrProb) — folding batter rate in here too would double-count
 * that signal across two features instead of letting the regression combine
 * two independent axes (batter quality, pitcher quality) on its own, which
 * is what a linear-in-log-odds model is already built to do. Platoon-specific
 * pitcher splits (vs. this pitcher's throwing hand specifically, rather than
 * his overall rate) are a disclosed v2 refinement — see homeRunModel's plan
 * doc open question #3 on HR/9 vs. hard-hit-rate as the input rate itself.
 */
export function pitcherMatchupSignal(pitcherHrRateAllowed: number, leagueHrRate: number): number {
  return logOdds(pitcherHrRateAllowed) - logOdds(leagueHrRate);
}

/**
 * Batting-slot (1-9) -> expected plate appearances that game. Linear
 * approximation (leadoff sees the most, 9-hole the fewest, ~0.1 PA less per
 * slot down the order) — a reasonable, disclosed estimate in the same spirit
 * as gameModel.ts's NEUTRAL_TEMP_F or modelFit.ts's NEUTRAL_BULLPEN_ERA, not
 * a precisely fit per-slot average. This is the "Lineup Order" input
 * confirmed live on FullCountProps' Blast Board, absent from the current
 * Beta-Binomial baseline.
 */
const PA_BY_SLOT: Record<number, number> = {
  1: 4.6, 2: 4.5, 3: 4.4, 4: 4.3, 5: 4.2, 6: 4.1, 7: 4.0, 8: 3.9, 9: 3.8,
};
/** Mean of PA_BY_SLOT's nine values — the neutral reference expectedPaCentered zeroes against, so a lineup-slot-unknown caller can pass this directly for a neutral feature value. */
export const NEUTRAL_EXPECTED_PA = Object.values(PA_BY_SLOT).reduce((a, b) => a + b, 0) / Object.keys(PA_BY_SLOT).length;

/** Slot outside 1-9 (shouldn't happen for a real lineup) falls back to the neutral center rather than throwing — same graceful-default convention as every other optional signal in this codebase. */
export function expectedPaForSlot(battingSlot: number): number {
  return PA_BY_SLOT[battingSlot] ?? NEUTRAL_EXPECTED_PA;
}

export function expectedPaCentered(battingSlot: number): number {
  return expectedPaForSlot(battingSlot) - NEUTRAL_EXPECTED_PA;
}

/**
 * Centers a raw PA/game figure directly, same reference point as
 * expectedPaCentered — used by the historical training builder, which has no
 * per-game batting-slot data to look up (MLB's game-log endpoint doesn't
 * carry it) and uses the batter's own trailing PA/game average as the
 * honest, no-lookahead proxy instead. Live prediction uses the real
 * lineup-slot lookup (expectedPaCentered); this is the disclosed train/live
 * gap for this feature, same shape as modelFit.ts's rawLog5
 * (team-only-in-training vs. starter-blended-live).
 */
export function expectedPaCenteredFromTrailingAverage(avgPaPerGame: number): number {
  return avgPaPerGame - NEUTRAL_EXPECTED_PA;
}

/**
 * Lineup-confidence discount — applied to the FINAL probability, not a
 * fitted feature (same role as FullCountProps' ×0.9 example for a
 * projected-but-unconfirmed batter). Multiplies down a probability built
 * from a projected (not yet official) lineup slot by the estimated chance
 * that batter actually starts. `1` (official lineup, or no discount known)
 * leaves the probability untouched.
 */
export function applyLineupConfidence(prob: number, startProbability: number): number {
  return prob * Math.min(1, Math.max(0, startProbability));
}

/** [betaBinomialHrProb, parkHrFactorCentered, pitcherMatchupSignal, expectedPaCentered] — same order as HOME_RUN_FEATURE_NAMES. */
export interface HomeRunFeatureInputs {
  betaBinomialHrProb: number;
  parkHrFactorCentered: number;
  pitcherMatchupSignal: number;
  expectedPaCentered: number;
}

/**
 * A home run is rare enough that an unclamped sigmoid output from a still-
 * thin fit could in principle land somewhere silly — same defensive-bound
 * role as gameModel.ts's [0.03, 0.97] clamp on win probability, just a
 * tighter, rare-event-appropriate range. No real MLB batter's single-game HR
 * probability has ever actually approached either edge.
 */
const MIN_HOME_RUN_PROB = 0.005;
const MAX_HOME_RUN_PROB = 0.5;

/**
 * Applies a fitted home-run model version's weights to a live feature set —
 * same role as gameModel.ts's applyFittedMoneylineWeights, but the feature
 * vector here is already fully assembled by the caller (adapter.ts) rather
 * than built from a shared diagnostics object, since this model has no
 * moneyline-style "raw formula" stage of its own — betaBinomialHrProb IS the
 * raw signal, computed by edgeModel.ts's computeModelProbability.
 */
export function applyFittedHomeRunWeights(inputs: HomeRunFeatureInputs, weights: number[], intercept: number): number {
  const features = [inputs.betaBinomialHrProb, inputs.parkHrFactorCentered, inputs.pitcherMatchupSignal, inputs.expectedPaCentered];
  const prob = predictProb(features, weights, intercept);
  return Math.min(MAX_HOME_RUN_PROB, Math.max(MIN_HOME_RUN_PROB, prob));
}
