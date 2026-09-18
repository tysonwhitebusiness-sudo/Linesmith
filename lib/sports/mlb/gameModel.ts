

/** Empirically the standard baseball exponent (vs. 2 for most other sports) — Bill James / later refinements settled here. */
const PYTHAGOREAN_EXPONENT = 1.83;

export function pythagoreanWinPct(runsScored: number, runsAllowed: number): number {
  const rs = Math.pow(Math.max(runsScored, 0.1), PYTHAGOREAN_EXPONENT);
  const ra = Math.pow(Math.max(runsAllowed, 0.1), PYTHAGOREAN_EXPONENT);
  return rs / (rs + ra);
}

/** Bill James' log5: combines two teams' own win rates into a head-to-head probability. */
export function log5(winPctA: number, winPctB: number): number {
  const num = winPctA - winPctA * winPctB;
  const den = winPctA + winPctB - 2 * winPctA * winPctB;
  if (den <= 0) return 0.5;
  return Math.min(0.99, Math.max(0.01, num / den));
}

export interface TeamRecordSplit {
  wins: number;
  losses: number;
}

export interface TeamOffenseDefense {
  runsScoredPerGame: number;
  runsAllowedPerGame: number;
  /** This team's season record — the baseline the splits below are measured against. */
  seasonRecord?: TeamRecordSplit | null;
  /** This team's record in today's venue context: home record for the home team, away record for the away team. */
  venueRecord?: TeamRecordSplit | null;
  /** Last-10-games record, any venue — already fetched for the standings page, unused here until now. */
  recentRecord?: TeamRecordSplit | null;
}

function winPct(record: TeamRecordSplit | null | undefined): number | null {
  if (!record) return null;
  const total = record.wins + record.losses;
  if (total < 1) return null;
  return record.wins / total;
}

/**
 * How much better (or worse) a team plays in a specific context than its
 * season rate — clamped so a small-sample split can't swing the model more
 * than `cap`, and zeroed out below `minSample` decisions entirely.
 */
export function splitEdge(season: TeamRecordSplit | null | undefined, split: TeamRecordSplit | null | undefined, minSample: number, cap: number): number {
  if (!split) return 0;
  const total = split.wins + split.losses;
  if (total < minSample) return 0;
  const seasonPct = winPct(season);
  const splitPct = winPct(split);
  if (seasonPct == null || splitPct == null) return 0;
  return Math.min(cap, Math.max(-cap, splitPct - seasonPct));
}

export interface OpposingStarter {
  era: number | null;
  starts: number;
}

export interface MoneylineInput {
  home: TeamOffenseDefense;
  away: TeamOffenseDefense;
  /** Today's actual starters, own team's side — NOT who they're facing. */
  homeStarter: OpposingStarter | null;
  awayStarter: OpposingStarter | null;
  /**
   * Multiplicative run-environment adjustment for today's specific venue —
   * applied symmetrically to both teams' expected runs (scored AND allowed),
   * since a hitter-friendly park inflates offense for both sides equally
   * while they're playing in it. 1.0 = no adjustment (unknown venue, or too
   * few games there this season to trust a factor — see parkFactors.ts).
   */
  parkFactor?: number;
}

export interface MoneylineResult {
  homeWinProb: number;
  awayWinProb: number;
  homeExpectedRuns: number;
  awayExpectedRuns: number;
  /**
   * The raw ingredients behind homeWinProb, exposed (not just the finished
   * number) so a caller can log them — this is what a later fitting pass
   * needs to learn real weights for home field / venue / form instead of
   * the hand-picked constants below staying guesses forever.
   */
  diagnostics: {
    rawLog5HomeWinProb: number;
    homeVenueEdge: number;
    awayVenueEdge: number;
    homeRecentEdge: number;
    awayRecentEdge: number;
    /** Unscaled versions of homeRecentEdge/awayRecentEdge (before ×RECENT_FORM_WEIGHT) — matches modelFit.ts's training feature exactly. */
    rawHomeRecentEdge: number;
    rawAwayRecentEdge: number;
    parkFactor: number;
  };
}

export interface FittedMoneylineWeights {
  /** Order must match modelFit.ts's MONEYLINE_FEATURE_NAMES: [rawLog5, venueDiff, formDiff, parkFactorCentered, eloProb, marketProbCentered, simWinProb]. */
  weights: number[];
  intercept: number;
  /** [intercept, weights...] covariance matrix from the fit — null on older fits from before uncertainty quantification existed. Powers computeMoneylineConfidenceInterval; without it there's no statistical basis for an interval, so callers get null back instead of a fabricated one. */
  covariance: number[][] | null;
}

export interface MoneylineConfidenceInterval {
  /** 90% Wald interval (delta method) for the HOME side's win probability — same clamp as applyFittedMoneylineWeights's point estimate. */
  lowerHome: number;
  upperHome: number;
}

/** Numerically stable Poisson PMF — builds each term from the last rather than computing lambda^k or k! directly, which overflow for realistic MLB run totals. */
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let pmf = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) pmf *= lambda / i;
  return pmf;
}

/**
 * P(over) for X ~ Poisson(lambda), with a PUSH handled as a push.
 *
 * Task 4.12 (P3 L1). `Math.floor(threshold)` alone returns P(X > k), which is
 * right for a half-integer line — the overwhelming majority of MLB totals —
 * and WRONG for an integer one. On a line of exactly 9, X = 9 is a PUSH: the
 * stake comes back. The old code scored it as a loss, understating the over.
 *
 * Conditioning on "not a push" is the standard treatment and is what a price on
 * an integer line actually represents — a book quoting over 9 at -110 is
 * pricing the two outcomes that can happen, not three.
 *
 *   integer line   P(over) = P(X > k) / (1 - P(X = k))
 *   half-integer   P(over) = P(X > k)          (no push is possible)
 *
 * Kept identical to python-odds-service/src/predict/game_model.py's
 * poisson_over_probability.
 */
export function poissonOverProbability(lambda: number, threshold: number): number {
  const k = Math.floor(threshold);
  let cdf = 0;
  for (let i = 0; i <= k; i++) cdf += poissonPmf(lambda, i);
  let over = 1 - cdf;
  if (Number.isInteger(threshold)) {
    const push = poissonPmf(lambda, k);
    if (push < 1) over = over / (1 - push);
  }
  return Math.min(0.99, Math.max(0.01, over));
}

/* `poissonPushProbability` was added here by 4.12 (P3 L1) and DELETED by the
 * Phase 4 gate on 2026-08-29: it was exported, documented, and called by
 * nothing -- not by production code, not by a test. `poissonOverProbability`
 * above already handles the integer-line push itself, by renormalising over
 * `1 - push`, which is the fix P3 L1 actually asked for. The standalone
 * accessor was redundant the moment that landed.
 *
 * The capability is not lost: Python's `poisson_push_probability`
 * (predict/game_model.py) does have a real caller, which is where model math
 * belongs under Q13. */

export interface TotalModelInput {
  homeExpectedRuns: number;
  awayExpectedRuns: number;
  line: number;
}

export interface TotalModelResult {
  expectedTotal: number;
  overProb: number;
}
/**
 * `computeMoneylineModel` and its private helpers (`blendWithStarterEra`,
 * `toLogOdds`, `fromLogOdds`) were DELETED here on 2026-08-29 — task 4.8
 * (P3 H2), operator decision.
 *
 * P3 H2: "There are two different MLB game models in production, and the one
 * being graded and displayed is not the one that was validated." This file held
 * the unvalidated one. Its last caller was `adapter.ts`'s cache-miss fallback,
 * which rendered it for roughly 2 of 19 MLB games — measured 2026-08-29, 17 of
 * 19 games had a `mlb_game_model_cache` row inside the 30-minute bound — with
 * nothing on screen distinguishing it from Python's fitted model.
 *
 * Per Q13 the model lives in Python: `python-odds-service/src/predict/
 * game_model.py`'s `compute_moneyline_model`, written to `mlb_game_model_cache`
 * by `computeMlbGameModelJob`. There is now exactly one MLB game model.
 *
 * NOTE FOR ANYONE READING 4.12's COMMITS: tasks 4.12 (P3 M4, the starter-ERA
 * innings-share blend) and (P3 M5, applying home-field in log-odds) were
 * implemented in BOTH languages and described as "kept identical". The
 * TypeScript halves lived in the functions deleted here, so those fixes now
 * exist only in Python — which is where they run. Nothing was lost; the parity
 * claim simply no longer has two sides to be parity between.
 *
 * `computeTotalModel`, `log5`, `pythagoreanWinPct`, `splitEdge` and
 * `poissonOverProbability` all REMAIN — they have real live callers in
 * `gameEdge.ts`, `recommendedPick.ts`, `modelFit.ts` and
 * `gameModelBackfill.ts`, and are not part of the duplicated model.
 */

/** Sum of two independent Poisson variables is itself Poisson with the combined rate — the standard simplifying assumption here. */
export function computeTotalModel(input: TotalModelInput): TotalModelResult {
  const expectedTotal = input.homeExpectedRuns + input.awayExpectedRuns;
  return {
    expectedTotal,
    overProb: poissonOverProbability(expectedTotal, input.line),
  };
}

export interface FittedTotalWeights {
  /** Order must match modelFit.ts's TOTAL_FEATURE_NAMES: [rawPoissonOverProb, formDiff, parkFactorCentered, eloProb, marketProbCentered, lineMovement, bullpenEraCentered, simOverProb]. */
  weights: number[];
  intercept: number;
  /** [intercept, weights...] covariance matrix from the fit — null on fits from before uncertainty quantification, or before this market has ever been fit. */
  covariance: number[][] | null;
}

export interface TotalConfidenceInterval {
  /** 90% Wald interval (delta method) for the OVER probability — same clamp as applyFittedTotalWeights's point estimate. */
  lowerOver: number;
  upperOver: number;
}
