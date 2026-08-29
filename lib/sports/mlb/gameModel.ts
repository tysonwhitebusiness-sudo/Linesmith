/**
 * Game-level prediction model — moneyline win probability and total-runs
 * probability, built from team season stats, starter quality, and weather
 * that are already fetched elsewhere in this app. Deliberately NOT the same
 * shape as Phase C.1's player model: a game has no "own trailing history" to
 * lean on the way a player does, so this uses established sabermetric
 * formulas instead of a Beta-Binomial posterior.
 *
 * Moneyline: Pythagorean win expectation (runs scored/allowed → implied win
 * rate) per team, each blended toward today's opposing starter's own runs
 * environment (approximated from ERA — earned runs only, a disclosed
 * simplification, not the true runs-allowed rate a full box score would
 * give), then combined into a head-to-head probability via the log5 formula
 * (Bill James) with a standard home-field adjustment layered on top.
 *
 * Totals: each team's expected runs today (same blended estimate as above)
 * summed and treated as Poisson-distributed — the standard sabermetric
 * assumption for run-scoring — to get P(combined total > line) directly.
 */

import { predictProbWithInterval } from '../../core/logisticRegression';

/** Empirically the standard baseball exponent (vs. 2 for most other sports) — Bill James / later refinements settled here. */
const PYTHAGOREAN_EXPONENT = 1.83;

/** MLB home teams have won ~53-54% of games historically — a well-documented, not tuned, constant. Left as the floor even now that a team-specific split edge (below) can add to it, since the flat rate is real and shouldn't be fully displaced by a small in-season sample. */
const HOME_FIELD_EDGE = 0.04;

/** Below this many decisions, a split record is too noisy to trust — its edge is treated as 0 rather than extrapolated from a handful of games. */
const MIN_SPLIT_SAMPLE = 8;
/** Same floor for the last-10 form signal — MLB's own standings feed always reports at most 10, so this just guards partial seasons. */
const MIN_RECENT_SAMPLE = 6;
/** How far a team's home/road split is allowed to move the model versus its season rate — bounded so one hot/cold home split doesn't dominate. */
const MAX_SPLIT_EDGE = 0.08;
/** Same bound for the recent-form nudge. */
const MAX_RECENT_EDGE = 0.1;
/** Recent form is real signal but noisier than a full season — down-weighted before being added in. */
const RECENT_FORM_WEIGHT = 0.4;

/** Same start-count floor used elsewhere (adapter.ts) before trusting an individual starter's own numbers. */
const MIN_STARTS_FOR_GAME_MODEL = 3;

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

/**
 * Blends a team's own season rate toward a starting pitcher's ERA once
 * they've thrown enough starts to mean something — the same instinct as the
 * player model's matchup shift. Used two ways below: a team's runs-SCORED
 * rate blends toward the *opposing* starter's ERA (who their batters face
 * today), and a team's runs-ALLOWED rate blends toward *their own*
 * starter's ERA (who's actually on the mound for them today). ERA is earned
 * runs only, and a starter typically pitches 5-6 of 9 innings, so this is a
 * real but disclosed approximation, not the true runs rate a full box score
 * would give.
 */
/** logit. Clamped off 0 and 1 so an extreme input cannot produce Infinity. */
function toLogOdds(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
}

/** Inverse logit. */
function fromLogOdds(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function blendWithStarterEra(teamRatePerGame: number, starter: OpposingStarter | null): number {
  if (!starter || starter.era == null || starter.starts < MIN_STARTS_FOR_GAME_MODEL) {
    return teamRatePerGame;
  }
  return teamRatePerGame * 0.5 + starter.era * 0.5;
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

export function computeMoneylineModel(input: MoneylineInput): MoneylineResult {
  const parkFactor = input.parkFactor ?? 1;

  // Each team's runs scored is shaped by the pitcher they're actually facing
  // (the opponent's starter); each team's runs allowed is shaped by their
  // own starter, who's the one actually on the mound for them today.
  let homeExpectedRuns = blendWithStarterEra(input.home.runsScoredPerGame, input.awayStarter);
  let awayExpectedRuns = blendWithStarterEra(input.away.runsScoredPerGame, input.homeStarter);
  let homeExpectedRunsAllowed = blendWithStarterEra(input.home.runsAllowedPerGame, input.homeStarter);
  let awayExpectedRunsAllowed = blendWithStarterEra(input.away.runsAllowedPerGame, input.awayStarter);

  // Venue run-environment: today's specific park, applied symmetrically to
  // both teams' scored AND allowed figures — a hitter's park inflates
  // offense against both sides equally while they're playing in it.
  //
  // Mathematical fact worth being explicit about: scaling both terms of a
  // Pythagorean ratio by the same constant leaves the ratio — and therefore
  // homeWinProb — completely unchanged (pyth(rs·k, ra·k) === pyth(rs, ra)
  // for any k). So a single symmetric park factor genuinely has ZERO effect
  // on the moneyline here, and that's correct, not a bug: a park that
  // inflates both offenses equally doesn't tell you who's more likely to
  // WIN, only how many total runs to expect. Its real, measurable effect is
  // on `homeExpectedRuns + awayExpectedRuns` below, which feeds the totals
  // (Poisson) model directly. A future, more granular park factor (e.g. one
  // that differentially favors left-handed power, benefiting whichever
  // team's roster is built that way) could move the moneyline — this
  // single-scalar version, by construction, cannot.
  homeExpectedRuns *= parkFactor;
  awayExpectedRuns *= parkFactor;
  homeExpectedRunsAllowed *= parkFactor;
  awayExpectedRunsAllowed *= parkFactor;

  const homeWinPct = pythagoreanWinPct(homeExpectedRuns, homeExpectedRunsAllowed);
  const awayWinPct = pythagoreanWinPct(awayExpectedRuns, awayExpectedRunsAllowed);

  const rawHomeWinProb = log5(homeWinPct, awayWinPct);

  // Team-specific split/form nudges on top of the flat home-field constant —
  // real signal already sitting in the standings feed (home/away splits,
  // last-10 record) that the season-wide Pythagorean rate above can't see:
  // a team can have an ordinary season line but a real home edge, or be
  // hotter/colder than their full-season run rate suggests right now.
  const homeVenueEdge = splitEdge(input.home.seasonRecord, input.home.venueRecord, MIN_SPLIT_SAMPLE, MAX_SPLIT_EDGE);
  const awayVenueEdge = splitEdge(input.away.seasonRecord, input.away.venueRecord, MIN_SPLIT_SAMPLE, MAX_SPLIT_EDGE);
  // Raw (unscaled) split, kept alongside the ×RECENT_FORM_WEIGHT version below
  // because modelFit.ts's training features use the unscaled diff — the
  // regression decides its own weight instead of trusting this hand-picked
  // 0.4 discount. Feeding the live path the pre-scaled number into a fitted
  // formula trained on the unscaled one would silently under-weight form by
  // 2.5x versus what was actually validated.
  const rawHomeRecentEdge = splitEdge(input.home.seasonRecord, input.home.recentRecord, MIN_RECENT_SAMPLE, MAX_RECENT_EDGE);
  const rawAwayRecentEdge = splitEdge(input.away.seasonRecord, input.away.recentRecord, MIN_RECENT_SAMPLE, MAX_RECENT_EDGE);
  const homeRecentEdge = rawHomeRecentEdge * RECENT_FORM_WEIGHT;
  const awayRecentEdge = rawAwayRecentEdge * RECENT_FORM_WEIGHT;

  const adjustment = HOME_FIELD_EDGE + (homeVenueEdge - awayVenueEdge) + (homeRecentEdge - awayRecentEdge);
  // Task 4.12 (P3 M5) — applied in LOG-ODDS, not by adding to a probability.
  //
  // This used to be `rawHomeWinProb + adjustment`. Probabilities are not
  // additive, and the error is not academic: +0.04 of home field on a
  // coin-flip game (0.50 -> 0.54) is a modest nudge, while the same +0.04 on
  // a heavy favourite (0.94 -> 0.98) roughly HALVES the underdog's chance. The
  // old form applied a much larger effective adjustment to lopsided games than
  // to close ones, the opposite of how a fixed edge behaves.
  //
  // Kept identical to python-odds-service/src/predict/game_model.py.
  const homeWinProb = Math.min(0.97, Math.max(0.03, fromLogOdds(toLogOdds(rawHomeWinProb) + adjustment)));

  return {
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    homeExpectedRuns,
    awayExpectedRuns,
    diagnostics: {
      rawLog5HomeWinProb: rawHomeWinProb,
      homeVenueEdge,
      awayVenueEdge,
      homeRecentEdge,
      awayRecentEdge,
      rawHomeRecentEdge,
      rawAwayRecentEdge,
      parkFactor,
    },
  };
}

export interface FittedMoneylineWeights {
  /** Order must match modelFit.ts's MONEYLINE_FEATURE_NAMES: [rawLog5, venueDiff, formDiff, parkFactorCentered, eloProb, marketProbCentered, simWinProb]. */
  weights: number[];
  intercept: number;
  /** [intercept, weights...] covariance matrix from the fit — null on older fits from before uncertainty quantification existed. Powers computeMoneylineConfidenceInterval; without it there's no statistical basis for an interval, so callers get null back instead of a fabricated one. */
  covariance: number[][] | null;
}

type FittedDiagnostics = Pick<
  MoneylineResult['diagnostics'],
  'rawLog5HomeWinProb' | 'homeVenueEdge' | 'awayVenueEdge' | 'rawHomeRecentEdge' | 'rawAwayRecentEdge' | 'parkFactor'
>;

/**
 * Same feature order as modelFit.ts's MONEYLINE_FEATURE_NAMES — shared by the
 * point-estimate and confidence-interval paths below so they can never drift
 * apart. `simWinProb` (added for the sim engine plan, docs/mlb-sim-engine-plan.md)
 * is the real per-game simulation once gameSimCache.ts has one cached for
 * this matchup — see its own header for the refresh cadence (piggybacks on
 * getMlbSnapshot's rebuild cycle, not a new schedule). Falls back to 0.5
 * (neutral) for a game with no cached sim yet (see
 * app/api/odds/lines/route.ts) — a resolvable lineup/starter doesn't exist
 * for every matchup at every moment of the day. Historical training rows
 * (modelFit.ts) populate it with a real simulated value too, from the
 * simplified team-level backfill path.
 */
function fittedFeatureVector(diag: FittedDiagnostics, eloProb: number, marketProb: number, simWinProb: number): number[] {
  return [
    diag.rawLog5HomeWinProb,
    diag.homeVenueEdge - diag.awayVenueEdge,
    diag.rawHomeRecentEdge - diag.rawAwayRecentEdge,
    diag.parkFactor - 1,
    eloProb,
    marketProb - 0.5,
    simWinProb,
  ];
}

/**
 * Applies Phase 3's fitted stacking regression in place of the hand-coded
 * home/venue/form adjustment above — same raw ingredients (diagnostics),
 * different combination: learned coefficients instead of the guessed
 * HOME_FIELD_EDGE / MAX_SPLIT_EDGE / RECENT_FORM_WEIGHT constants. `eloProb`
 * should be 0.5 (neutral) when Elo isn't trusted yet, and `marketProb`
 * should be 0.5 (neutral, centers to 0) when no live sportsbook line is
 * available yet — both matching exactly how modelFit.ts imputed them during
 * training. Using `null`-skips-blending semantics here instead would feed
 * the fitted formula a different distribution than the one it was
 * validated against. Same convention for `simWinProb`.
 */
export function applyFittedMoneylineWeights(diag: FittedDiagnostics, eloProb: number, marketProb: number, simWinProb: number, fitted: FittedMoneylineWeights): number {
  const features = fittedFeatureVector(diag, eloProb, marketProb, simWinProb);
  let z = fitted.intercept;
  for (let i = 0; i < fitted.weights.length; i++) z += fitted.weights[i] * (features[i] ?? 0);
  const prob = 1 / (1 + Math.exp(-z));
  return Math.min(0.97, Math.max(0.03, prob));
}

export interface MoneylineConfidenceInterval {
  /** 90% Wald interval (delta method) for the HOME side's win probability — same clamp as applyFittedMoneylineWeights's point estimate. */
  lowerHome: number;
  upperHome: number;
}

/**
 * Statistical confidence interval for the fitted prediction, from the
 * regression's own covariance matrix (see logisticRegression.ts's
 * predictProbWithInterval) — null when `fitted` has no covariance (older
 * fit, before this existed), since there's nothing real to build an
 * interval from. Always in terms of the HOME side; callers flip to the
 * picked side themselves (lower/upper swap under 1-p).
 */
export function computeMoneylineConfidenceInterval(diag: FittedDiagnostics, eloProb: number, marketProb: number, simWinProb: number, fitted: FittedMoneylineWeights): MoneylineConfidenceInterval | null {
  if (!fitted.covariance) return null;
  const features = fittedFeatureVector(diag, eloProb, marketProb, simWinProb);
  const { lower, upper } = predictProbWithInterval(features, fitted.weights, fitted.intercept, fitted.covariance);
  return {
    lowerHome: Math.min(0.97, Math.max(0.03, lower)),
    upperHome: Math.min(0.97, Math.max(0.03, upper)),
  };
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

/** P(push) for X ~ Poisson(lambda) — non-zero only on an integer line
 * (task 4.12, P3 L1). Half-integer lines cannot push. */
export function poissonPushProbability(lambda: number, threshold: number): number {
  if (!Number.isInteger(threshold)) return 0;
  return poissonPmf(lambda, threshold);
}

export interface TotalModelInput {
  homeExpectedRuns: number;
  awayExpectedRuns: number;
  line: number;
}

export interface TotalModelResult {
  expectedTotal: number;
  overProb: number;
}

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

/** Subset of MoneylineResult.diagnostics the totals fit reuses — same game, same raw ingredients, no need to recompute form/park separately. */
type TotalFittedDiagnostics = Pick<MoneylineResult['diagnostics'], 'rawHomeRecentEdge' | 'rawAwayRecentEdge' | 'parkFactor'>;

const NEUTRAL_BULLPEN_ERA = 4.3;

/**
 * Same feature order as modelFit.ts's TOTAL_FEATURE_NAMES — shared by the
 * point-estimate and confidence-interval paths below so they can never drift
 * apart. `lineMovement` is 0 (no signal) when there's no reliable "opening"
 * reference to compare against; `homeBullpenEra`/`awayBullpenEra` fall back
 * to the neutral reference individually when unavailable — same neutral-
 * impute convention as the rest. `simOverProb` (sim engine plan) is the real
 * per-game simulation's expected total, converted to an over-probability
 * against today's actual line, once gameSimCache.ts has one cached for this
 * matchup — same live-wiring shape as `simWinProb`, see fittedFeatureVector's
 * comment in this same file. Falls back to rawOverProb's own value (the
 * sim contributing "no additional signal beyond the existing formula" is
 * the honest neutral point for a probability feature, unlike a flat 0.5)
 * for a game with no cached sim yet.
 */
function fittedTotalFeatureVector(
  rawOverProb: number,
  diag: TotalFittedDiagnostics,
  eloProb: number,
  marketProb: number,
  lineMovement: number,
  homeBullpenEra: number | null,
  awayBullpenEra: number | null,
  simOverProb: number,
): number[] {
  const bullpenEraCentered = (homeBullpenEra ?? NEUTRAL_BULLPEN_ERA) / 2 + (awayBullpenEra ?? NEUTRAL_BULLPEN_ERA) / 2 - NEUTRAL_BULLPEN_ERA;
  return [
    rawOverProb,
    diag.rawHomeRecentEdge - diag.rawAwayRecentEdge,
    diag.parkFactor - 1,
    eloProb,
    marketProb - 0.5,
    lineMovement,
    bullpenEraCentered,
    simOverProb,
  ];
}

/**
 * Applies the fitted total-market stacking regression in place of the flat
 * 0.5-weight market blend the total lock cycle (now predict/odds_lines_cycle.py's run_total_lock_from_lines) otherwise falls back to — same
 * raw ingredients as the live Poisson formula (rawOverProb) plus form/park/
 * Elo/market/line-movement/bullpen signals, learned coefficients instead of
 * a guessed blend weight. `eloProb` and `marketProb` should be 0.5 (neutral)
 * when untrusted/unavailable, matching exactly how modelFit.ts imputed them
 * during training.
 */
export function applyFittedTotalWeights(
  rawOverProb: number,
  diag: TotalFittedDiagnostics,
  eloProb: number,
  marketProb: number,
  lineMovement: number,
  homeBullpenEra: number | null,
  awayBullpenEra: number | null,
  simOverProb: number,
  fitted: FittedTotalWeights,
): number {
  const features = fittedTotalFeatureVector(rawOverProb, diag, eloProb, marketProb, lineMovement, homeBullpenEra, awayBullpenEra, simOverProb);
  let z = fitted.intercept;
  for (let i = 0; i < fitted.weights.length; i++) z += fitted.weights[i] * (features[i] ?? 0);
  const prob = 1 / (1 + Math.exp(-z));
  return Math.min(0.97, Math.max(0.03, prob));
}

export interface TotalConfidenceInterval {
  /** 90% Wald interval (delta method) for the OVER probability — same clamp as applyFittedTotalWeights's point estimate. */
  lowerOver: number;
  upperOver: number;
}

/**
 * Statistical confidence interval for the fitted total prediction, from the
 * regression's own covariance matrix — null when `fitted` has no covariance.
 * Always in terms of OVER; callers flip to the picked side themselves
 * (lower/upper swap under 1-p), same convention as computeMoneylineConfidenceInterval.
 */
export function computeTotalConfidenceInterval(
  rawOverProb: number,
  diag: TotalFittedDiagnostics,
  eloProb: number,
  marketProb: number,
  lineMovement: number,
  homeBullpenEra: number | null,
  awayBullpenEra: number | null,
  simOverProb: number,
  fitted: FittedTotalWeights,
): TotalConfidenceInterval | null {
  if (!fitted.covariance) return null;
  const features = fittedTotalFeatureVector(rawOverProb, diag, eloProb, marketProb, lineMovement, homeBullpenEra, awayBullpenEra, simOverProb);
  const { lower, upper } = predictProbWithInterval(features, fitted.weights, fitted.intercept, fitted.covariance);
  return {
    lowerOver: Math.min(0.97, Math.max(0.03, lower)),
    upperOver: Math.min(0.97, Math.max(0.03, upper)),
  };
}
