/**
 * De-vig methods beyond the multiplicative one — Phase 6.24.
 *
 * `devig.ts` ships the standard multiplicative method and is the single de-vig
 * path in the app; nothing here replaces it. These are the alternatives 6.24
 * asks for, so that a backtest can eventually choose between them on evidence
 * rather than on which produces the biggest edge.
 *
 * ============ THEY DISAGREE ABOUT WHERE THE VIG SITS ============
 *
 * A two-sided price implies two probabilities that sum to more than one. Every
 * method below splits that excess differently, and the disagreement is largest
 * exactly where it matters most — on longshots.
 *
 *  - **Multiplicative** takes the excess in proportion to each side's own
 *    probability, so the favourite absorbs most of it in absolute terms. It is
 *    the simplest and assumes the book applies a flat percentage margin.
 *  - **Power** solves for the exponent `k` where the raw probabilities raised
 *    to `k` sum to one. It removes proportionally MORE from the longshot,
 *    which is the direction the favourite-longshot bias actually runs.
 *  - **Shin** models the margin as protection against insider money and solves
 *    for the insider proportion `z`. It also shades longshots down, from a
 *    stated mechanism rather than a curve chosen to fit.
 *  - **Worst case** assumes the entire margin sits on the OTHER side, so the
 *    side you are backing gets the least favourable fair probability the price
 *    can support. It is not a model of the book; it is a floor, and it is the
 *    right one to quote when a decision must not be flattered.
 *
 * ============ NO METHOD IS MADE THE DEFAULT HERE ============
 *
 * Switching the app's de-vig changes every edge it displays, and that change
 * must be justified by a backtest rather than by taste — see `devigBacktest.ts`
 * for what the settled sample can and cannot currently support.
 */

import { devigTwoWay } from './devig';

export type DevigMethod = 'multiplicative' | 'power' | 'shin' | 'worst-case';
export const DEVIG_METHODS: readonly DevigMethod[] = ['multiplicative', 'power', 'shin', 'worst-case'];

export interface DevigResult {
  a: number;
  b: number;
  /** Booksum minus one — the overround the method was asked to remove. */
  overround: number;
  method: DevigMethod;
}

/** Raw implied probabilities from a two-sided decimal price, or `null` if either is unusable. */
function rawPair(aDecimal: number | null | undefined, bDecimal: number | null | undefined): { a: number; b: number } | null {
  if (aDecimal == null || bDecimal == null || !Number.isFinite(aDecimal) || !Number.isFinite(bDecimal)) return null;
  if (aDecimal <= 1 || bDecimal <= 1) return null;
  return { a: 1 / aDecimal, b: 1 / bDecimal };
}

/**
 * Power: find `k` with `a^k + b^k = 1`.
 *
 * BISECTION, NOT NEWTON. The function is monotone in `k` over the bracket, so
 * bisection converges without a derivative and cannot diverge on a pathological
 * pair — and 60 iterations of a cheap function is not worth optimising for a
 * value computed once per price.
 *
 * `k > 1` whenever there is a real overround, because raising a number below
 * one to a larger power makes it smaller. A booksum at or below one has no vig
 * to remove and returns the raw pair unchanged rather than inventing one.
 */
export function devigPower(aDecimal: number | null | undefined, bDecimal: number | null | undefined): DevigResult | null {
  const raw = rawPair(aDecimal, bDecimal);
  if (!raw) return null;
  const sum = raw.a + raw.b;
  if (sum <= 1) return { a: raw.a, b: raw.b, overround: sum - 1, method: 'power' };

  let lo = 1;
  let hi = 8;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const s = Math.pow(raw.a, k) + Math.pow(raw.b, k);
    if (s > 1) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  const a = Math.pow(raw.a, k);
  const b = Math.pow(raw.b, k);
  // Normalise the residual: bisection lands within ~1e-15 of the root, and a
  // pair that sums to 0.9999999999 would quietly leak into every downstream
  // edge calculation.
  const t = a + b;
  return { a: a / t, b: b / t, overround: sum - 1, method: 'power' };
}

/**
 * Shin: solve for the insider proportion `z` in
 * `pi_i = (sqrt(z^2 + 4(1-z) * p_i^2 / S) - z) / (2(1-z))`, where `S` is the
 * booksum, choosing `z` so the two fair probabilities sum to one.
 *
 * `z` IS BRACKETED IN [0, 0.4), not left open. `z` is a proportion of money
 * from insiders; values approaching one are not a market, they are a division
 * by something near zero. A real book's `z` is a couple of percent, and the
 * bracket keeps a degenerate pair from producing a confident absurdity.
 */
export function devigShin(aDecimal: number | null | undefined, bDecimal: number | null | undefined): DevigResult | null {
  const raw = rawPair(aDecimal, bDecimal);
  if (!raw) return null;
  const S = raw.a + raw.b;
  if (S <= 1) return { a: raw.a, b: raw.b, overround: S - 1, method: 'shin' };

  const shinProb = (p: number, z: number): number =>
    (Math.sqrt(z * z + 4 * (1 - z) * ((p * p) / S)) - z) / (2 * (1 - z));

  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 60; i++) {
    const z = (lo + hi) / 2;
    const s = shinProb(raw.a, z) + shinProb(raw.b, z);
    // The sum decreases as z rises, so overshoot means z is too small.
    if (s > 1) lo = z;
    else hi = z;
  }
  const z = (lo + hi) / 2;
  const a = shinProb(raw.a, z);
  const b = shinProb(raw.b, z);
  const t = a + b;
  return { a: a / t, b: b / t, overround: S - 1, method: 'shin' };
}

/**
 * Worst case: each side's fair probability is `1 - other side's raw implied`.
 *
 * This assumes the ENTIRE margin sits on the other side, which is the least
 * favourable reading of the price for whoever is backing this one. It is a
 * floor rather than a model, and the two sides do NOT sum to one — they sum to
 * `2 - S`, which is below one by exactly the overround. That is not a bug and
 * it is why the pair is returned unnormalised: normalising it would turn a
 * deliberately conservative bound back into a point estimate and throw away the
 * only thing it was for.
 */
export function devigWorstCase(aDecimal: number | null | undefined, bDecimal: number | null | undefined): DevigResult | null {
  const raw = rawPair(aDecimal, bDecimal);
  if (!raw) return null;
  const S = raw.a + raw.b;
  return { a: Math.max(0, 1 - raw.b), b: Math.max(0, 1 - raw.a), overround: S - 1, method: 'worst-case' };
}

/** One entry point, so a caller can hold the method as data rather than a branch. */
export function devigBy(
  method: DevigMethod,
  aDecimal: number | null | undefined,
  bDecimal: number | null | undefined,
): DevigResult | null {
  switch (method) {
    case 'power':
      return devigPower(aDecimal, bDecimal);
    case 'shin':
      return devigShin(aDecimal, bDecimal);
    case 'worst-case':
      return devigWorstCase(aDecimal, bDecimal);
    case 'multiplicative': {
      const r = devigTwoWay(aDecimal, bDecimal);
      const raw = rawPair(aDecimal, bDecimal);
      if (!r || !raw) return null;
      return { a: r.a, b: r.b, overround: raw.a + raw.b - 1, method: 'multiplicative' };
    }
  }
}
