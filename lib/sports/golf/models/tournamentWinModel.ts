/**
 * Tournament Winner / Ranking Model — Phase A (see project memory's golf
 * model gameplan). P(win) / P(top 5) / P(top 10) / P(made cut) for every
 * golfer in the field, via Monte Carlo simulation — the same architectural
 * role lib/sports/mlb/simEngine.ts/simGame.ts play for a single game,
 * scaled up to a 4-round tournament with a cut in the middle.
 *
 * Each iteration plays the tournament forward one round at a time:
 *  - A round the golfer has already played uses their real score.
 *  - A round not yet played is drawn from Normal(projectedRoundMean,
 *    roundScoreSd) — projectedRoundMean comes from roundScoreModel.ts's own
 *    skill/field/weather estimate, so this model doesn't duplicate that
 *    logic, just samples around it many times.
 *  - After `cutAfterRound`, only the `cutSize` lowest running totals stay
 *    "active" for the remaining rounds — everyone else is out for that
 *    iteration (probMadeCut tracks how often a golfer survives across all
 *    iterations).
 * Repeated thousands of times, the fraction of iterations a golfer finishes
 * 1st / top 5 / top 10 / past the cut IS the probability — no closed-form
 * formula could capture "who's still in it after a cut" any other way.
 *
 * No fitted weights here to begin with — same "ships day one, Phase B
 * refines it" position as the other two models. What Phase B changes here
 * specifically: roundScoreSd (a single global constant today) becomes a
 * per-golfer or per-course figure once golf_tournament_results has enough
 * finishes to measure real variance from, and the cut-size/tie handling
 * below (a disclosed simplification — ties are broken arbitrarily by sort
 * order rather than modeled as shared cut lines) gets a proper treatment.
 */

import { sampleNormal } from '../../../core/normalDist';

export interface GolferProjection {
  espnId: string;
  /** This golfer's own relative-to-par score for each round already completed this tournament, in order (R1, R2, ...). A round with any real data (even a live in-progress partial total) counts as "completed" here — simulating the remainder of an in-progress round would need hole-level modeling, out of scope for a round-level sim. */
  completedRounds: number[];
  /** Expected relative-to-par for a round this golfer hasn't played yet — roundScoreModel.ts's own expectedRelativeToPar for this golfer. */
  projectedRoundMean: number;
}

export interface TournamentModelInput {
  golfers: GolferProjection[];
  totalRounds: number;
  /** How many golfers survive the cut — top N by running total, ties broken by sort order (disclosed simplification, see file header). Null skips cut modeling entirely (e.g. the real cut already happened and the caller has already filtered the field to survivors). */
  cutSize: number | null;
  /** Which round the cut applies after — 2 for a standard 4-round stroke-play event. */
  cutAfterRound: number;
  iterations: number;
  roundScoreSd: number;
  /** Injectable for deterministic tests; defaults to Math.random via sampleNormal. */
  rng?: () => number;
}

export interface GolferTournamentOutcome {
  espnId: string;
  probWin: number;
  probTop5: number;
  probTop10: number;
  probMadeCut: number;
  expectedFinalScore: number;
}

export interface TournamentPrediction {
  outcomes: GolferTournamentOutcome[];
  iterations: number;
  basis: string[];
}

export function predictTournament(input: TournamentModelInput): TournamentPrediction {
  const { golfers, totalRounds, cutSize, cutAfterRound, iterations, roundScoreSd, rng } = input;
  const n = golfers.length;

  const wins = new Array(n).fill(0);
  const top5s = new Array(n).fill(0);
  const top10s = new Array(n).fill(0);
  const madeCuts = new Array(n).fill(0);
  const scoreSum = new Array(n).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    const running = new Array(n).fill(0);
    let active = golfers.map((_, i) => i);
    let cutApplied = cutSize === null;

    for (let round = 1; round <= totalRounds; round++) {
      for (const i of active) {
        const g = golfers[i];
        const played = g.completedRounds[round - 1];
        running[i] += played != null ? played : sampleNormal(g.projectedRoundMean, roundScoreSd, rng);
      }

      if (!cutApplied && round === cutAfterRound) {
        active = [...active].sort((a, b) => running[a] - running[b]).slice(0, cutSize ?? active.length);
        cutApplied = true;
      }
    }

    for (const i of active) madeCuts[i] += 1;
    for (const i of active) scoreSum[i] += running[i];

    const ranked = [...active].sort((a, b) => running[a] - running[b]);
    if (ranked.length > 0) wins[ranked[0]] += 1;
    for (const i of ranked.slice(0, 5)) top5s[i] += 1;
    for (const i of ranked.slice(0, 10)) top10s[i] += 1;
  }

  const outcomes: GolferTournamentOutcome[] = golfers.map((g, i) => ({
    espnId: g.espnId,
    probWin: wins[i] / iterations,
    probTop5: top5s[i] / iterations,
    probTop10: top10s[i] / iterations,
    probMadeCut: madeCuts[i] / iterations,
    expectedFinalScore: madeCuts[i] > 0 ? scoreSum[i] / madeCuts[i] : NaN,
  }));
  outcomes.sort((a, b) => b.probWin - a.probWin);

  return {
    outcomes,
    iterations,
    basis: [
      `${n} golfers, ${iterations.toLocaleString()} simulated tournaments`,
      cutSize != null ? `Cut modeled: top ${cutSize} after round ${cutAfterRound}` : 'No cut modeled (already applied or not requested)',
      `Round-to-round score SD: ${roundScoreSd} strokes (disclosed constant, not yet fit)`,
    ],
  };
}
