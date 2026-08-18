/**
 * Hole Score Predictor — Phase A (see project memory's golf model gameplan).
 *
 * P(birdie-or-better) / P(par) / P(bogey-or-worse) for one golfer on one
 * upcoming hole, built entirely from data already live today: no fitted
 * weights yet (golf_hole_scores has no sample to fit against — this ships
 * the same day ingestion starts). Phase B replaces PRIOR_BY_PAR and
 * STROKES_TO_LOGODDS below with real coefficients once there's one, same
 * activation gate homeRunModel.ts uses (only goes live if it beats this
 * file's own Brier score on a holdout).
 *
 * Two real signals combine here:
 *  1. This week's field-observed scoring distribution on the hole (a
 *     Dirichlet-style posterior: a disclosed, well-documented par-based
 *     prior blended with actual observations via pseudo-counts, so a
 *     3-observation Tuesday sample doesn't overreact — same "shrink small
 *     samples" idea as lib/ui/heat.ts's dampenForSample).
 *  2. The golfer's own season SG:Total edge vs. the field, applied as a
 *     log-odds shift toward more birdies / fewer bogeys — same technique
 *     lib/sports/mlb/homeRunModel.ts's pitcherMatchupSignal uses to turn a
 *     rate delta into an additive log-odds feature.
 */

export interface HoleFieldObservation {
  relativeToPar: number;
}

export interface HoleModelInput {
  par: number | null;
  /** Every golfer's score on this hole this week so far, across all completed rounds — includes the subject golfer's own. */
  fieldObservations: HoleFieldObservation[];
  /** The subject golfer's own subset of the above, weighted extra (see PRIOR_WEIGHT/OWN_EXTRA_WEIGHT) since it's the most specific evidence available, thin as it usually is. */
  golferOwnObservations: HoleFieldObservation[];
  /** Season SG:Total, strokes gained per round — the subject golfer's. Null when unmatched/unavailable, in which case only the field distribution is used. */
  golferSgTotal: number | null;
  /** Average season SG:Total per round across the golfers who contributed `fieldObservations` — the baseline the skill shift is measured against. */
  fieldAvgSgTotal: number | null;
}

export interface HolePrediction {
  probBirdie: number;
  probPar: number;
  probBogey: number;
  /** Single-shot approximation (birdie ≈ -1, bogey ≈ +1) — doesn't separately weight eagles or doubles, a disclosed simplification. */
  expectedRelativeToPar: number;
  fieldSampleSize: number;
  basis: string[];
}

export type GolfCategory = 'birdie' | 'par' | 'bogey';
function categoryFor(relativeToPar: number): GolfCategory {
  if (relativeToPar < 0) return 'birdie';
  if (relativeToPar === 0) return 'par';
  return 'bogey';
}

/**
 * Approximate PGA Tour scoring-distribution-by-par, rounded from widely
 * published tour averages (birdie/par/bogey-or-worse rates run roughly
 * 13/71/16 on a par 3, 13/69/18 on a par 4, 34/53/13 on a par 5 — par 5s
 * play as the field's best birdie chance by a wide margin). A disclosed
 * prior, not fit against this app's own data — Phase B replaces it once
 * golf_hole_scores has enough rows to fit a real one per par.
 */
const PRIOR_BY_PAR: Record<3 | 4 | 5, { birdie: number; par: number; bogey: number }> = {
  3: { birdie: 0.13, par: 0.71, bogey: 0.16 },
  4: { birdie: 0.13, par: 0.69, bogey: 0.18 },
  5: { birdie: 0.34, par: 0.53, bogey: 0.13 },
};

/** How much a hole's par matters to a skill-based shift — a par 5's extra length/reachability gives real skill more room to show up than a short par 3 does. Disclosed relative weighting, not fit. */
const SKILL_WEIGHT_BY_PAR: Record<3 | 4 | 5, number> = { 3: 0.7, 4: 1.0, 5: 1.4 };

/** How many pseudo-observations the par-based prior counts as, before real field data starts outweighing it — 6 real observations roughly matches the prior's own confidence. */
const PRIOR_WEIGHT = 6;
/** Extra weight (on top of the 1x already counted within fieldObservations) given to the golfer's own scores on this exact hole — more specific evidence, still a thin sample almost always. */
const OWN_EXTRA_WEIGHT = 2;
/** 1 stroke of hole-level skill edge (already down-weighted by SKILL_WEIGHT_BY_PAR/18) shifts birdie/bogey log-odds by this much — a disclosed, reasonable v1 constant, not fit. Phase B replaces it with a real fitted coefficient. */
const STROKES_TO_LOGODDS = 2.2;

function clampProb(p: number): number {
  return Math.min(0.98, Math.max(0.01, p));
}
function logOdds(p: number): number {
  const c = clampProb(p);
  return Math.log(c / (1 - c));
}
function fromLogOdds(lo: number): number {
  return 1 / (1 + Math.exp(-lo));
}

function priorFor(par: number | null) {
  if (par === 3 || par === 4 || par === 5) return PRIOR_BY_PAR[par];
  return PRIOR_BY_PAR[4]; // par 4 is the tour's modal hole — the least-wrong default when par is unknown.
}

/**
 * The par-based prior alone, before any field-observation or skill
 * adjustment — the "league rate" a candidate's model conviction is measured
 * against (see propScore.ts's `M` component: modelProb vs. leagueRate,
 * discounted by sample size). Exported so adapter.ts can attach both
 * numbers to a candidate without duplicating PRIOR_BY_PAR.
 */
export function priorHoleCategoryRate(par: number | null, category: GolfCategory): number {
  return priorFor(par)[category];
}

export function predictHoleScore(input: HoleModelInput): HolePrediction {
  const par = input.par;
  const prior = priorFor(par);
  const basis: string[] = [];

  // Dirichlet-style blend: prior-as-pseudo-counts + real observations.
  const counts = {
    birdie: prior.birdie * PRIOR_WEIGHT,
    par: prior.par * PRIOR_WEIGHT,
    bogey: prior.bogey * PRIOR_WEIGHT,
  };
  for (const obs of input.fieldObservations) counts[categoryFor(obs.relativeToPar)] += 1;
  basis.push(`Field: ${input.fieldObservations.length} observations this week (par ${par ?? 'unknown'} prior blended in at weight ${PRIOR_WEIGHT})`);

  if (input.golferOwnObservations.length > 0) {
    for (const obs of input.golferOwnObservations) counts[categoryFor(obs.relativeToPar)] += OWN_EXTRA_WEIGHT;
    basis.push(`This golfer's own hole history this week: ${input.golferOwnObservations.length} round(s), weighted ${OWN_EXTRA_WEIGHT}x`);
  }

  const total = counts.birdie + counts.par + counts.bogey;
  let probBirdie = counts.birdie / total;
  let probPar = counts.par / total;
  let probBogey = counts.bogey / total;

  if (input.golferSgTotal != null && input.fieldAvgSgTotal != null) {
    const skillDeltaPerRound = input.golferSgTotal - input.fieldAvgSgTotal;
    const weight = SKILL_WEIGHT_BY_PAR[(par === 3 || par === 5 ? par : 4) as 3 | 4 | 5];
    const perHoleSkillDelta = (skillDeltaPerRound / 18) * weight;
    const shift = perHoleSkillDelta * STROKES_TO_LOGODDS;

    probBirdie = fromLogOdds(logOdds(probBirdie) + shift);
    probBogey = fromLogOdds(logOdds(probBogey) - shift);
    probPar = Math.max(0.02, 1 - probBirdie - probBogey);

    basis.push(`Skill: ${skillDeltaPerRound >= 0 ? '+' : ''}${skillDeltaPerRound.toFixed(2)} SG/round vs. field average, hole-weighted for par ${par ?? 4}`);
  } else {
    basis.push('Skill: no season SG:Total available for this golfer — field distribution only.');
  }

  const sum = probBirdie + probPar + probBogey;
  probBirdie /= sum;
  probPar /= sum;
  probBogey /= sum;

  return {
    probBirdie,
    probPar,
    probBogey,
    expectedRelativeToPar: -probBirdie + probBogey,
    fieldSampleSize: input.fieldObservations.length,
    basis,
  };
}
