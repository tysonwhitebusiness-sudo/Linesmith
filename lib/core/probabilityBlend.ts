/**
 * Blends the model's own probability with the market's de-vigged implied
 * probability. The market is, empirically, a hard number to beat — blending
 * toward it is the single highest-leverage change available to this app's
 * calibration (see /diagnostics's Brier score). `MARKET_BLEND_WEIGHT` is a
 * placeholder until the fitting phase replaces it with a value learned from
 * real graded outcomes instead of guessed.
 */
export const MARKET_BLEND_WEIGHT = 0.5;

/**
 * Elo is blended in AFTER the market (sequential composition, not a 3-way
 * weighted average) at a smaller weight — it's a newer, less-proven signal
 * than the market, so it nudges the market-informed number rather than
 * competing with it on equal footing. Both weights are placeholders; Phase
 * 3's fitting pass replaces the guessing with weights learned from real
 * graded outcomes.
 */
export const ELO_BLEND_WEIGHT = 0.2;

export function blendProbability(modelProb: number, otherProb: number | null, weight: number = MARKET_BLEND_WEIGHT): number {
  if (otherProb == null || !Number.isFinite(otherProb)) return modelProb;
  return (1 - weight) * modelProb + weight * otherProb;
}
