/**
 * Prop Score v1 — a single 0-100 rating + letter grade per prop, built
 * entirely from data already flowing today: the Beta-Binomial posterior
 * (edgeModel.ts), a genuine live two-sided book price when one exists
 * (liveEdge.ts), the candidate's own trailing-performance corroboration
 * (goodBets.ts), and matchup favorability. No new ingestion, no waiting on
 * historical market-odds accumulation — see the approved plan.
 *
 * Deliberately does NOT fold in market trust (see marketTrust.ts) as a
 * multiplicative term. An earlier design did exactly that and it broke: a
 * market's live Brier Skill Score can clamp all the way to -1 on a small
 * sample (`doubles`, BSS -11% at n=100), which zeroes the whole score
 * (`raw * (1 + T) = raw * 0 = 0`) regardless of how strong the individual
 * prop's own evidence is — punishing one specific pick for its market's
 * still-thin collective track record. Market trust is shown as a separate
 * badge (marketTrust.ts) instead; a caller should suppress the score
 * entirely for an `excluded` market rather than let this function grade it.
 *
 * Weights and scale constants below are v1, hand-set — same disclosed-guess
 * status as edgeModel.ts's `MATCHUP_SHIFT_WEIGHT`/`PRIOR_STRENGTH`. This
 * batch locks a score into `pick_history` at first-surfaced time
 * specifically so there's real graded history to fit these against later.
 */

import type { PickCandidate } from '../../core/types';
import { priorStrength } from './edgeModel';
import { candidateGoodBetSignals, performanceMatchDetails, type GoodBetInput } from '../goodBets';
import type { CandidateEdgeInfo } from './liveEdge';

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Normalizes a raw ΔM = (p_model - leagueRate) edge, discounted by posterior confidence — a 15-point shift is roughly the ceiling this maps to ±1. */
const SCALE_M = 0.15;
/** Normalizes a raw live book edge (model prob - devigged market prob) — a 10-point edge maps to ±1. */
const SCALE_E = 0.1;
/** Flat bonus added to `P` when ≥2 independent performance tracks clear, on top of the single best track's own margin. */
const MULTI_TRACK_BONUS = 0.15;
/** `X` — matchup is corroborating only, never load-bearing on its own, same one-directional design as goodBets.ts's `qualifiesByMatchup`. */
const MATCHUP_BONUS = 0.3;

const WEIGHT_M = 0.3;
const WEIGHT_E = 0.35;
const WEIGHT_P = 0.25;
const WEIGHT_X = 0.1;

export type PropScoreGrade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D';

const GRADE_TIERS: Array<[minScore: number, grade: PropScoreGrade]> = [
  [85, 'A+'],
  [75, 'A'],
  [68, 'B+'],
  [62, 'B'],
  [56, 'C+'],
  [50, 'C'],
  [0, 'D'],
];

export function gradeForScore(score: number): PropScoreGrade {
  return GRADE_TIERS.find(([min]) => score >= min)?.[1] ?? 'D';
}

export interface PropScoreComponents {
  /** Model conviction — posterior probability's distance from league rate, discounted by sample-size confidence. */
  M: number;
  /** Live book edge, normalized — null when no genuine two-sided live price exists (not the same as a confirmed-zero edge; weight is redistributed over M/P/X instead). */
  E: number | null;
  /** Performance corroboration — best trailing-window margin, plus a bonus for multiple independently-clearing tracks. */
  P: number;
  /** Matchup corroboration — flat bonus when favorable, 0 otherwise. */
  X: number;
}

export interface PropScore {
  score: number;
  grade: PropScoreGrade;
  components: PropScoreComponents;
  hasLiveEdge: boolean;
  /** Compact "why" — which performance tracks corroborated, same short/long text ScanTable's Reason pill already uses. */
  performanceLabel: string | null;
  performanceDetail: string | null;
}

function performanceComponent(candidate: PickCandidate): { P: number; label: string | null; detail: string | null } {
  const input: GoodBetInput = {
    edge: null,
    marketProb: null,
    sampleSize: candidate.sampleSize,
    dimension: candidate.dimension,
    ...candidateGoodBetSignals(candidate),
  };
  const matches = performanceMatchDetails(input);
  if (matches.length === 0) return { P: 0, label: null, detail: null };
  const bestMargin = Math.max(...matches.map((m) => m.margin));
  const bonus = matches.length >= 2 ? MULTI_TRACK_BONUS : 0;
  return {
    P: clamp(bestMargin + bonus, 0, 1),
    label: matches.map((m) => m.short).join(', '),
    detail: matches.map((m) => m.long).join('; '),
  };
}

/**
 * `edgeInfo` should come from `resolveCandidateEdge` (liveEdge.ts) —
 * whatever price/staleness gating that function already applies (genuine
 * two-sided price, <10 min old) is trusted as-is here, not re-checked.
 * Returns null when there's no model probability at all to build a score
 * from (the Beta posterior never ran for this candidate) — same "absent,
 * not fabricated" rule the rest of this app already follows for a number it
 * can't stand behind.
 */
export function computePropScore(candidate: PickCandidate, edgeInfo: CandidateEdgeInfo): PropScore | null {
  const m = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
  // `typeof NaN === 'number'` — a plain `== null` check lets a degenerate
  // upstream NaN (e.g. a Beta posterior computed from a zero-length window)
  // slip through and poison every downstream component. Reject it the same
  // as a missing value: no score, not a fabricated NaN one.
  const modelProbRaw = typeof m.modelProb === 'number' ? m.modelProb : null;
  if (modelProbRaw == null || !Number.isFinite(modelProbRaw)) return null;
  const modelProb = modelProbRaw;

  const leagueRateRaw = typeof m.leagueRate === 'number' ? m.leagueRate : modelProb;
  const leagueRate = Number.isFinite(leagueRateRaw) ? leagueRateRaw : modelProb;
  const sampleSizeRaw = typeof m.modelSampleSize === 'number' ? m.modelSampleSize : 0;
  const sampleSize = Number.isFinite(sampleSizeRaw) ? sampleSizeRaw : 0;
  const n0 = priorStrength(candidate.dimension);
  const kappa = sampleSize / (sampleSize + n0);
  const deltaM = modelProb - leagueRate;
  const M = clamp((deltaM * kappa) / SCALE_M, -1, 1);

  const E = edgeInfo.edge != null ? clamp(edgeInfo.edge / SCALE_E, -1, 1) : null;

  const { P, label: performanceLabel, detail: performanceDetail } = performanceComponent(candidate);

  const matchupFavorable = typeof m.matchupFavorable === 'boolean' ? m.matchupFavorable : null;
  const X = matchupFavorable === true ? MATCHUP_BONUS : 0;

  let raw: number;
  if (E != null) {
    raw = WEIGHT_M * M + WEIGHT_E * E + WEIGHT_P * P + WEIGHT_X * X;
  } else {
    // No genuine live price — redistribute E's weight over the other three
    // proportionally rather than treat "no price" as "confirmed zero edge."
    const remaining = 1 - WEIGHT_E;
    raw = (WEIGHT_M / remaining) * M + (WEIGHT_P / remaining) * P + (WEIGHT_X / remaining) * X;
  }

  const score = Math.round(50 + 50 * clamp(raw, -1, 1));
  return {
    score,
    grade: gradeForScore(score),
    components: { M, E, P, X },
    hasLiveEdge: E != null,
    performanceLabel,
    performanceDetail,
  };
}
