/**
 * Small normal-distribution helpers — CDF (for turning a continuous expected
 * score into bucketed win/under/over probabilities) and a Gaussian sampler
 * (for the tournament-winner Monte Carlo sim). Sport-agnostic, same role as
 * `logisticRegression.ts`: pure math, no baseball or golf in it.
 */

/** Abramowitz & Stegun 7.1.26 — standard, accurate to ~1.5e-7, no external dependency. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** P(X <= x) for X ~ Normal(mean, sd). */
export function normalCdf(x: number, mean = 0, sd = 1): number {
  if (sd <= 0) return x < mean ? 0 : 1;
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

/** Box-Muller transform — one standard-normal-derived sample per call. `rng` is injectable so a simulation can be made deterministic for tests. */
export function sampleNormal(mean: number, sd: number, rng: () => number = Math.random): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}
