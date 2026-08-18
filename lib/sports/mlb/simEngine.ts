/**
 * Play-by-play simulation engine — per-plate-appearance Markov chain over the
 * standard 24-state base/out machine. See docs/mlb-sim-engine-plan.md for the
 * full plan this file implements, phase by phase.
 *
 * Pure math, no DB/network access — mirrors homeRunModel.ts's split (pure
 * mechanics here, data-fetching in a separate file per phase) so the same
 * engine is testable in isolation from any real game data. A caller supplies
 * a stream of outcome vectors (one per PA); this file only knows how to turn
 * a stream of PA outcomes into runs.
 */

export type Outcome = 'BB' | 'K' | '1B' | '2B' | '3B' | 'HR' | 'OUT';

/** Fixed order every OutcomeVector uses — sampleOutcome walks this order, so array-based callers (Phase 2+) must match it exactly. */
export const OUTCOME_ORDER: Outcome[] = ['BB', 'K', '1B', '2B', '3B', 'HR', 'OUT'];

/** Probability of each outcome for one plate appearance — must sum to ~1 (sampleOutcome normalizes defensively, but a caller should keep this a real distribution). */
export type OutcomeVector = Record<Outcome, number>;

export function makeOutcomeVector(rates: Partial<Record<Outcome, number>>): OutcomeVector {
  const v: OutcomeVector = { BB: 0, K: 0, '1B': 0, '2B': 0, '3B': 0, HR: 0, OUT: 0 };
  for (const key of OUTCOME_ORDER) v[key] = rates[key] ?? 0;
  return v;
}

/** Deterministic-seed-free PRNG hook — every function below takes `rng: () => number` (uniform [0,1)) rather than reaching for Math.random() directly, so a test can inject a seeded generator for reproducible runs. */
export type Rng = () => number;

export function sampleOutcome(vector: OutcomeVector, rng: Rng): Outcome {
  const total = OUTCOME_ORDER.reduce((s, k) => s + vector[k], 0);
  const r = rng() * (total > 0 ? total : 1);
  let cumulative = 0;
  for (const key of OUTCOME_ORDER) {
    cumulative += vector[key];
    if (r < cumulative) return key;
  }
  return 'OUT'; // floating-point fallback — should only trigger on a vector that sums to ~0
}

/**
 * Base/out state — `bases` is a 3-bit occupancy mask (bit 0 = runner on 1st,
 * bit 1 = 2nd, bit 2 = 3rd), `outs` is 0-2 (3 outs ends the half-inning,
 * handled by the caller, not represented as a state here).
 */
export interface BaseOutState {
  outs: number;
  bases: number;
}

const FIRST = 1;
const SECOND = 2;
const THIRD = 4;

export interface AdvanceResult {
  next: BaseOutState;
  runsScored: number;
}

/**
 * v1 deterministic advancement — see docs/mlb-sim-engine-plan.md §1 for the
 * exact rules and the disclosed simplification (a runner on 2nd/3rd always
 * scores on a single/double rather than a real per-situation probability).
 * v2's probabilistic advancement tables replace only this function's body —
 * nothing else in this file needs to change when that upgrade lands.
 */
export function advanceState(state: BaseOutState, outcome: Outcome): AdvanceResult {
  const onFirst = (state.bases & FIRST) !== 0;
  const onSecond = (state.bases & SECOND) !== 0;
  const onThird = (state.bases & THIRD) !== 0;

  if (outcome === 'K' || outcome === 'OUT') {
    return { next: { outs: state.outs + 1, bases: state.bases }, runsScored: 0 };
  }

  if (outcome === 'BB') {
    // Force advancement only where the chain of occupied bases requires it.
    let runs = 0;
    let bases = state.bases;
    if (onFirst) {
      if (onSecond) {
        if (onThird) runs += 1; // bases loaded walk forces in a run
        bases |= THIRD;
      }
      bases |= SECOND;
    }
    bases |= FIRST;
    return { next: { outs: state.outs, bases }, runsScored: runs };
  }

  if (outcome === '1B') {
    let runs = 0;
    if (onThird) runs += 1;
    if (onSecond) runs += 1;
    let bases = FIRST;
    if (onFirst) bases |= SECOND;
    return { next: { outs: state.outs, bases }, runsScored: runs };
  }

  if (outcome === '2B') {
    const runs = (onFirst ? 1 : 0) + (onSecond ? 1 : 0) + (onThird ? 1 : 0);
    return { next: { outs: state.outs, bases: SECOND }, runsScored: runs };
  }

  // '3B' or 'HR' — everyone scores, batter included for a HR (bases empty after); a triple leaves the batter on 3rd.
  const runsAhead = (onFirst ? 1 : 0) + (onSecond ? 1 : 0) + (onThird ? 1 : 0);
  if (outcome === 'HR') {
    return { next: { outs: state.outs, bases: 0 }, runsScored: runsAhead + 1 };
  }
  return { next: { outs: state.outs, bases: THIRD }, runsScored: runsAhead };
}

/**
 * Plays out one half-inning. `nextVector` is called once per PA — a plain
 * closure over a fixed lineup for Phase 1, a lineup-with-bullpen-handoff
 * closure for Phase 4+. `stopIfLeadTaken` (walk-off) ends the half-inning the
 * instant the batting team takes the lead, before the third out — only ever
 * relevant for the home team's bottom-of-9th-or-later at-bat.
 */
export function simulateHalfInning(nextVector: () => OutcomeVector, rng: Rng, stopIfLeadTaken?: (runsThisHalf: number) => boolean): number {
  let outs = 0;
  let bases = 0;
  let runs = 0;
  while (outs < 3) {
    const outcome = sampleOutcome(nextVector(), rng);
    const result = advanceState({ outs, bases }, outcome);
    outs = result.next.outs;
    bases = result.next.bases;
    runs += result.runsScored;
    if (stopIfLeadTaken?.(runs)) break;
  }
  return runs;
}

export interface GameSimResult {
  homeRuns: number;
  awayRuns: number;
  innings: number;
}

const MAX_INNINGS_SAFETY = 30; // real games essentially never go this deep — a hard stop against a runaway RNG edge case, not a rules limit

/**
 * Standard 9-inning-plus-extras game loop: away bats first each inning; home
 * skips its bottom half if already ahead after 9+ (no need for the "extra"
 * at-bat); a walk-off ends the bottom half instantly once home takes the lead
 * in the 9th or later.
 */
export function simulateGame(homeVectorStream: () => OutcomeVector, awayVectorStream: () => OutcomeVector, rng: Rng): GameSimResult {
  let homeRuns = 0;
  let awayRuns = 0;
  let inning = 1;
  for (; inning <= MAX_INNINGS_SAFETY; inning++) {
    awayRuns += simulateHalfInning(awayVectorStream, rng);
    if (inning >= 9 && homeRuns > awayRuns) break; // home already won — no bottom half needed
    const before = homeRuns;
    homeRuns += simulateHalfInning(homeVectorStream, rng, inning >= 9 ? (runsThisHalf) => before + runsThisHalf > awayRuns : undefined);
    if (inning >= 9 && homeRuns !== awayRuns) break; // decided at the end of a completed inning 9+
  }
  return { homeRuns, awayRuns, innings: inning };
}

/** Runs simulateGame `n` times with fixed (non-lineup-varying) vector streams — Phase 1's shape, extended in later phases to accept per-batter/per-pitcher streams instead of one flat vector. */
export function simulateGames(homeVector: OutcomeVector, awayVector: OutcomeVector, n: number, rng: Rng): GameSimResult[] {
  const results: GameSimResult[] = [];
  for (let i = 0; i < n; i++) {
    results.push(simulateGame(() => homeVector, () => awayVector, rng));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Phase 2 — Dirichlet-multinomial shrinkage
// ---------------------------------------------------------------------------

/**
 * How many plate appearances of league-average behavior each outcome's prior
 * is worth before a batter's own real data takes over — the direct
 * multi-category generalization of edgeModel.ts's per-market
 * `PRIOR_STRENGTH`, same "rare outcomes get a stronger prior" philosophy,
 * re-derived at PA scale (edgeModel.ts's constants are game-scale, not
 * directly transferable 1:1) from Russell Carleton's published stat-
 * stabilization-point research: strikeout rate stabilizes fastest (~40-60
 * PA), walk rate next (~100-200 PA), contact-quality/power outcomes slowest
 * (HR ~170 PA, extra-base hits generally 300+, triples essentially never
 * stabilize in a single season — hence the very high prior strength). v1
 * hand-set and disclosed, same status as every other prior-strength constant
 * in this codebase — not yet fit against real graded outcomes.
 */
export const OUTCOME_PRIOR_STRENGTH: Record<Outcome, number> = {
  K: 60,
  BB: 200,
  '1B': 300,
  '2B': 300,
  '3B': 1000,
  HR: 170,
  OUT: 60,
};

/**
 * Per-category Beta shrinkage, then renormalized into a valid 7-category
 * distribution — not a textbook Dirichlet-multinomial posterior, despite the
 * doc plan's original description. A true Dirichlet's mean for category i is
 * alpha_i / sum(alpha_j); if every category shared one prior strength that
 * reduces to exactly leagueRates on zero data, but this plan deliberately
 * wants a DIFFERENT prior strength per category (rare outcomes shrink
 * harder) — and once alpha_i = leagueRate_i * strength_i with strength_i
 * varying, alpha_i / sum(alpha_j) no longer equals leagueRate_i even with
 * zero observations, because categories with a larger strength get
 * proportionally over-weighted in the shared normalizer. (Caught exactly
 * this way: a pitcher with an empty game log — see simRates.ts's PA-field
 * bug fix in the same change — came back with OUT collapsed from a real
 * ~46% to ~22%, because OUT's prior strength (60) is far below 1B's/2B's
 * (300), and the old formula let that ratio leak into the "no data"
 * fallback.)
 *
 * The fix: shrink each category independently exactly like
 * edgeModel.ts's betaPosterior does for one binary market — shrunk_i =
 * (leagueRate_i·strength_i + count_i) / (strength_i + totalPA) — which
 * correctly returns exactly leagueRate_i on zero observations regardless of
 * strength_i, then renormalize the 7 results to sum to 1 (they won't
 * automatically, since each category's denominator differs). With real data
 * behind it this is close to a Dirichlet in practice; the guarantee that
 * matters (zero data -> exactly league rates) is now actually true.
 */
export function dirichletShrunkVector(
  counts: OutcomeVector,
  leagueRates: OutcomeVector,
  priorStrength: Record<Outcome, number> = OUTCOME_PRIOR_STRENGTH,
): OutcomeVector {
  const totalPA = OUTCOME_ORDER.reduce((s, k) => s + counts[k], 0);
  const shrunk: Partial<Record<Outcome, number>> = {};
  for (const key of OUTCOME_ORDER) {
    const strength = priorStrength[key];
    shrunk[key] = (leagueRates[key] * strength + counts[key]) / (strength + totalPA);
  }
  const denom = OUTCOME_ORDER.reduce((s, k) => s + (shrunk[k] ?? 0), 0);
  const out: Partial<Record<Outcome, number>> = {};
  for (const key of OUTCOME_ORDER) out[key] = denom > 0 ? (shrunk[key] ?? 0) / denom : leagueRates[key];
  return makeOutcomeVector(out);
}

// ---------------------------------------------------------------------------
// Phase 3 — pitcher blending via the odds-ratio method
// ---------------------------------------------------------------------------

/** Keeps a rate strictly inside (0,1) before taking odds — same role as homeRunModel.ts's clampRate, needed for the same reason (a rate of exactly 0 or 1 makes odds 0 or infinite). */
function clampRate(rate: number): number {
  return Math.min(0.999, Math.max(0.001, rate));
}

function odds(rate: number): number {
  const r = clampRate(rate);
  return r / (1 - r);
}

/**
 * Generalizes log5 / homeRunModel.ts's pitcherMatchupSignal from one binary
 * outcome to all 7 categories at once: for each category independently,
 * combine the batter's own rate-vs-league odds-ratio with the pitcher's own
 * allowed-rate-vs-league odds-ratio, multiply, convert back to a probability
 * — then renormalize across all 7 categories so the result is a valid
 * distribution again (treating each category as its own independent binary
 * odds-ratio, per-category, doesn't automatically sum to 1 the way a single
 * multinomial draw does).
 *
 * A league-average batter facing a league-average pitcher gets back
 * `leagueRates` unchanged (both odds-ratios are 1). A true ace (every
 * category's allowed-rate below league average) pulls every category toward
 * outs; a masher facing a batting-practice arm pulls every category toward
 * damage.
 */
export function blendBatterPitcherVector(batterVector: OutcomeVector, pitcherVector: OutcomeVector, leagueRates: OutcomeVector): OutcomeVector {
  const combined: Partial<Record<Outcome, number>> = {};
  for (const key of OUTCOME_ORDER) {
    const oddsLeague = odds(leagueRates[key]);
    const orBatter = odds(batterVector[key]) / oddsLeague;
    const orPitcher = odds(pitcherVector[key]) / oddsLeague;
    const oddsCombined = oddsLeague * orBatter * orPitcher;
    combined[key] = oddsCombined / (1 + oddsCombined);
  }
  const total = OUTCOME_ORDER.reduce((s, k) => s + (combined[k] ?? 0), 0);
  const out: Partial<Record<Outcome, number>> = {};
  for (const key of OUTCOME_ORDER) out[key] = total > 0 ? (combined[key] ?? 0) / total : leagueRates[key];
  return makeOutcomeVector(out);
}

// ---------------------------------------------------------------------------
// Phase 4 — starter/bullpen handoff
// ---------------------------------------------------------------------------

/** ~4.3 batters faced per inning of work is a standard sabermetric rule of thumb (roughly 3 outs plus the extra baserunners a inning typically allows) — same role as gameModel.ts's own "~4.25 batters per inning" convention used to convert outs to innings for K Watch-style lines. */
const BATTERS_FACED_PER_INNING = 4.3;

/**
 * A stateful PA-count-based handoff — approximates "pull the starter after
 * roughly his average innings/start" without needing simulateHalfInning to
 * report real outs back to this closure (a bigger contract change this
 * phase doesn't need). `expectedInningsPerStart` × ~4.3 sets the batter
 * count the starter is expected to face before the bullpen (one single
 * blended vector, not per-reliever — see docs/mlb-sim-engine-plan.md §4)
 * takes over for the rest of the game.
 */
export function makeStarterBullpenStream(starterVector: OutcomeVector, bullpenVector: OutcomeVector, expectedInningsPerStart: number): () => OutcomeVector {
  const handoffAfterBatters = Math.max(1, Math.round(expectedInningsPerStart * BATTERS_FACED_PER_INNING));
  let faced = 0;
  return () => {
    faced += 1;
    return faced <= handoffAfterBatters ? starterVector : bullpenVector;
  };
}

// ---------------------------------------------------------------------------
// Phase 5 — park factors
// ---------------------------------------------------------------------------

/** HR, 2B, and 3B are the outcomes a park's dimensions/altitude/air density actually change — a walk or strikeout doesn't care how far the fences are. Singles are left alone too: v1's disclosed scope (parkFactors.ts's own factor is a combined-runs scalar, not HR-specific — see docs/mlb-sim-engine-plan.md §5's v2 note) targets the categories a park factor most plausibly moves, not every hit type. */
const PARK_SENSITIVE_OUTCOMES: Outcome[] = ['2B', '3B', 'HR'];

/**
 * Scales the park-sensitive categories by `parkFactor` (reusing the existing
 * single scalar from parkFactors.ts, applied here to specific outcomes
 * rather than uniformly to runs the way gameModel.ts's moneyline path uses
 * it), then renormalizes the whole vector back to a valid distribution — the
 * same shape as blendBatterPitcherVector's own scale-then-renormalize
 * pattern. `parkFactor = 1` (neutral park, or unknown venue) leaves the
 * vector completely unchanged.
 */
export function applyParkFactor(vector: OutcomeVector, parkFactor: number): OutcomeVector {
  if (parkFactor === 1) return vector;
  const adjusted: Partial<Record<Outcome, number>> = { ...vector };
  for (const key of PARK_SENSITIVE_OUTCOMES) adjusted[key] = vector[key] * parkFactor;
  const total = OUTCOME_ORDER.reduce((s, k) => s + (adjusted[k] ?? 0), 0);
  const out: Partial<Record<Outcome, number>> = {};
  for (const key of OUTCOME_ORDER) out[key] = total > 0 ? (adjusted[key] ?? 0) / total : vector[key];
  return makeOutcomeVector(out);
}

// ---------------------------------------------------------------------------
// Phase 6 — full-lineup-vs-pitching-staff stream (composes Phases 2-5)
// ---------------------------------------------------------------------------

export interface PrecomputedLineupVsPitching {
  vsStarter: OutcomeVector[];
  vsBullpen: OutcomeVector[];
  handoffAfterBatters: number;
}

/**
 * The expensive half: blends all 9 lineup slots against both the starter and
 * the bullpen, with park factor applied — 18 vectors, computed ONCE for a
 * given matchup regardless of how many of the N games get simulated against
 * it. Separated from the stream constructor below specifically so a caller
 * simulating thousands of games for the same matchup doesn't redo this work
 * on every single one of them.
 */
export function precomputeLineupVsPitching(
  lineupVectors: OutcomeVector[],
  starterVector: OutcomeVector,
  bullpenVector: OutcomeVector,
  leagueRates: OutcomeVector,
  expectedInningsPerStart: number,
  parkFactor: number,
): PrecomputedLineupVsPitching {
  if (lineupVectors.length === 0) throw new Error('precomputeLineupVsPitching: empty lineup');
  return {
    vsStarter: lineupVectors.map((v) => applyParkFactor(blendBatterPitcherVector(v, starterVector, leagueRates), parkFactor)),
    vsBullpen: lineupVectors.map((v) => applyParkFactor(blendBatterPitcherVector(v, bullpenVector, leagueRates), parkFactor)),
    handoffAfterBatters: Math.max(1, Math.round(expectedInningsPerStart * BATTERS_FACED_PER_INNING)),
  };
}

/**
 * The cheap half: a fresh, independently-stateful per-game stream from an
 * already-precomputed matchup — call this once per simulated game (its
 * battersFaced/orderIndex counters must start at 0 for each new game), reuse
 * the same `PrecomputedLineupVsPitching` across all N of them.
 */
export function makeLineupVsPitchingStream(precomputed: PrecomputedLineupVsPitching, lineupSize: number): () => OutcomeVector {
  const { vsStarter, vsBullpen, handoffAfterBatters } = precomputed;
  let battersFaced = 0;
  let orderIndex = 0;
  return () => {
    battersFaced += 1;
    const slot = orderIndex % lineupSize;
    orderIndex += 1;
    return battersFaced <= handoffAfterBatters ? vsStarter[slot] : vsBullpen[slot];
  };
}
