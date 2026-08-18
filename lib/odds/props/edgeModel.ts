/**
 * Phase C.1 — the Bayesian probability model, in isolation from where it's
 * wired up (adapter.ts, which already resolves matchup favorability and has
 * the fragile directionality logic — this file takes that as a plain
 * boolean rather than re-deriving it, to avoid a second place that can get
 * a rank inversion wrong).
 *
 * Beta-Binomial: conjugate prior for a Bernoulli rate, so the posterior
 * after observing real games is closed-form — cheap enough to run for every
 * candidate on every snapshot. The prior's center is the real league base
 * rate for that market (lib/db/client.ts's `leagueBaseRates`, computed from
 * every graded outcome this app has ever seen — backfilled and live). The
 * matchup shift and per-market prior strength below are v1: principled math,
 * hand-set hyperparameters — not yet fit against real calibration data,
 * because that fit needs the very outcomes this model is only starting to
 * accumulate. Revisit once pick_history has a real season of live-graded
 * edges behind it, not just the backfill.
 */

export interface BetaPosterior {
  alpha: number;
  beta: number;
  mean: number;
  variance: number;
  stdDev: number;
}

export function betaPosterior(alpha0: number, beta0: number, hits: number, total: number): BetaPosterior {
  const alpha = alpha0 + hits;
  const beta = beta0 + Math.max(0, total - hits);
  const sum = alpha + beta;
  const mean = alpha / sum;
  const variance = (alpha * beta) / (sum * sum * (sum + 1));
  return { alpha, beta, mean, variance, stdDev: Math.sqrt(variance) };
}

/**
 * Effective prior sample size, per market — how many "pseudo-games" of
 * league-average behavior the prior is worth before real data takes over.
 * Rare events (home runs, triples, stolen bases) get a stronger prior: a
 * batter going 2-for-5 on home runs this month is not actually a 40% home
 * run hitter, and a weak prior would let a tiny sample say so.
 */
const PRIOR_STRENGTH: Record<string, number> = {
  'home-runs': 50,
  triples: 70,
  'stolen-bases': 45,
  doubles: 30,
  'first-home-run': 70,
};
const DEFAULT_PRIOR_STRENGTH = 15;

export function priorStrength(dimension: string): number {
  return PRIOR_STRENGTH[dimension] ?? DEFAULT_PRIOR_STRENGTH;
}

/**
 * How hard the matchup nudges the prior mean before real data is applied.
 * Scaled by `mean * (1 - mean)` so the shift is naturally smaller near 0 or
 * 1 (a market that's already a near-lock or near-impossible doesn't move
 * much for one matchup factor) and larger near 0.5. Bounded to keep a single
 * matchup signal from dominating the league rate.
 */
const MATCHUP_SHIFT_WEIGHT = 0.35;

export function shiftedPriorMean(leagueRate: number, favorable: boolean | null): number {
  if (favorable == null) return leagueRate;
  const direction = favorable ? 1 : -1;
  const shift = MATCHUP_SHIFT_WEIGHT * direction * leagueRate * (1 - leagueRate);
  return Math.min(0.97, Math.max(0.03, leagueRate + shift));
}

export interface ModelProbabilityInput {
  dimension: string;
  leagueRate: number;
  /** The candidate's own real history — did each game clear the line, oldest to newest doesn't matter here, just the count. */
  overCount: number;
  totalCount: number;
  /** Reuses adapter.ts's already-resolved matchup favorability — null when no matchup signal was available. */
  matchupFavorable: boolean | null;
  /**
   * The trailing L10 window's own over/total, as a subset already counted
   * once in overCount/totalCount above — not extra games, extra weight on
   * games already there. Optional so backfill or any caller without a
   * recent-window handy still gets the plain season posterior.
   */
  recentOverCount?: number;
  recentTotalCount?: number;
}

export interface ModelProbabilityResult {
  prob: number;
  stdDev: number;
  sampleSize: number;
  priorMean: number;
  priorStrength: number;
}

/**
 * How much extra a recent (L10) game counts toward the posterior versus an
 * older one — 0.5 means each recent game is worth 1.5x a normal game's
 * weight. This is what "recent performance into the edge" means concretely:
 * a real, current change in form shows up in `prob` sooner than an equal
 * number of games spread across the full season would let it, while a
 * stable player's season-long rate still dominates (bounded, not replaced).
 * v1 hand-set, same disclosed-not-yet-fit status as the rest of this file.
 */
const RECENT_GAME_WEIGHT_BONUS = 0.5;

export function computeModelProbability(input: ModelProbabilityInput): ModelProbabilityResult {
  const n0 = priorStrength(input.dimension);
  const priorMean = shiftedPriorMean(input.leagueRate, input.matchupFavorable);
  const alpha0 = priorMean * n0;
  const beta0 = (1 - priorMean) * n0;

  const recentOver = input.recentOverCount ?? 0;
  const recentTotal = input.recentTotalCount ?? 0;
  const weightedOverCount = input.overCount + recentOver * RECENT_GAME_WEIGHT_BONUS;
  const weightedTotalCount = input.totalCount + recentTotal * RECENT_GAME_WEIGHT_BONUS;

  const posterior = betaPosterior(alpha0, beta0, weightedOverCount, weightedTotalCount);
  return {
    prob: posterior.mean,
    stdDev: posterior.stdDev,
    sampleSize: input.totalCount,
    priorMean,
    priorStrength: n0,
  };
}
