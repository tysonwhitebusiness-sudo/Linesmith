/**
 * Kelly criterion staking — turns a win probability and a price into a
 * suggested fraction of bankroll, rather than leaving "the model favors
 * this side" with no sizing signal at all. Sport-agnostic, pure math.
 *
 * Two deliberate risk reductions on top of textbook Kelly, both disclosed
 * rather than silently baked in:
 *  - Fractional Kelly (DEFAULT_KELLY_FRACTION): full Kelly is famously
 *    aggressive and assumes the input probability is exactly right. Any
 *    real model has estimation error beyond what a confidence interval
 *    captures (misspecification, regime shifts a training set never saw),
 *    so betting a fraction of what Kelly suggests is the standard practical
 *    hedge against "my probability was wrong."
 *  - Where a confidence interval is available (see logisticRegression.ts's
 *    predictProbWithInterval), callers should size off the LOWER bound of
 *    that interval for the picked side, not the point estimate — a bet
 *    only has a real edge if it still clears breakeven at the pessimistic
 *    end of what the model is actually sure of.
 */

export const DEFAULT_KELLY_FRACTION = 0.5; // half-Kelly

export function americanToDecimalOdds(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

/**
 * Full Kelly fraction of bankroll: f* = (p*b - (1-p)) / b, where b is the
 * net decimal odds (payout per unit staked, excluding the stake itself).
 * Clamped to [0, 1] — a negative result means no edge (don't bet), and this
 * returns 0 rather than a negative "short" position, which isn't a thing a
 * moneyline bettor can take.
 */
export function kellyFraction(prob: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  if (b <= 0 || !Number.isFinite(prob)) return 0;
  const f = (prob * b - (1 - prob)) / b;
  return Math.max(0, Math.min(1, f));
}

/** Kelly fraction scaled down by `fraction` (half-Kelly by default) — the number actually worth suggesting as a stake. */
export function suggestedStake(prob: number, decimalOdds: number, fraction: number = DEFAULT_KELLY_FRACTION): number {
  return kellyFraction(prob, decimalOdds) * fraction;
}

export interface StakeSuggestion {
  /** Half-Kelly stake off the model's point-probability estimate. */
  pointStake: number;
  /** Half-Kelly stake off the confidence interval's lower bound for the picked side — null when no interval is available (e.g. no fit is active). The conservative number to actually act on. */
  conservativeStake: number | null;
}

export function stakeSuggestion(prob: number, probLower: number | null, decimalOdds: number, fraction: number = DEFAULT_KELLY_FRACTION): StakeSuggestion {
  return {
    pointStake: suggestedStake(prob, decimalOdds, fraction),
    conservativeStake: probLower != null ? suggestedStake(probLower, decimalOdds, fraction) : null,
  };
}
