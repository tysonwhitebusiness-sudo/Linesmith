/**
 * Grades golf's logged Phase A predictions against real outcomes as they
 * land — the other half of "how is it performing" (see project memory's
 * golf model gameplan). Every poll logs a prediction (adapter.ts); this
 * checks whether any logged prediction now has a matching real result in
 * golf_hole_scores/golf_round_scores/golf_tournament_results and, if so,
 * freezes a hit/Brier-score verdict onto it. A prediction graded once never
 * changes again — the DB layer (client.ts's `WHERE graded_at IS NULL`
 * upsert guard) already prevents a later poll from silently overwriting it.
 *
 * Brier score: (predicted_prob - actual)^2, actual ∈ {0, 1} — the standard
 * proper scoring rule for a probability forecast. Lower is better; 0.25 is
 * what a coin-flip forecaster scores on a 50/50 event, so a real model
 * should read meaningfully below that once there's a sample.
 */

import {
  findGradeableHolePredictions,
  writeGradedHolePredictions,
  findGradeableTournamentPredictions,
  writeGradedTournamentPredictions,
  logSystemEvent,
  type GradedHolePredictionInput,
  type GradedTournamentPredictionInput,
} from '../../../db/client';

/** '1' -> 1, 'T3' -> 3, 'CUT'/'WD'/'DQ'/null -> null (never top-anything). */
function positionRank(position: string | null): number | null {
  if (!position) return null;
  const n = Number(position.replace(/^T/i, ''));
  return Number.isFinite(n) ? n : null;
}

export function gradeGolfHoleRoundPredictions(): { graded: number } {
  try {
    const gradeable = findGradeableHolePredictions();
    if (gradeable.length === 0) return { graded: 0 };

    const rows: GradedHolePredictionInput[] = gradeable.map((p) => {
      const hit = p.actualCategory === p.category ? 1 : 0;
      const brierComponent = (p.predictedProb - hit) ** 2;
      return { id: p.id, hit, actualCategory: p.actualCategory, brierComponent };
    });
    writeGradedHolePredictions(rows);
    return { graded: rows.length };
  } catch (err) {
    logSystemEvent({
      level: 'error',
      source: 'golf/models/grading',
      message: 'Failed to grade hole/round predictions',
      detail: err instanceof Error ? err.message : String(err),
    });
    return { graded: 0 };
  }
}

export function gradeGolfTournamentPredictions(): { graded: number } {
  try {
    const gradeable = findGradeableTournamentPredictions();
    if (gradeable.length === 0) return { graded: 0 };

    const rows: GradedTournamentPredictionInput[] = gradeable.map((p) => {
      const rank = positionRank(p.position);
      const won: 0 | 1 = rank === 1 ? 1 : 0;
      const top5: 0 | 1 = rank != null && rank <= 5 ? 1 : 0;
      const top10: 0 | 1 = rank != null && rank <= 10 ? 1 : 0;
      const madeCut: 0 | 1 = p.madeCut ? 1 : 0;
      return {
        eventId: p.eventId,
        espnId: p.espnId,
        won,
        top5,
        top10,
        madeCut,
        brierWin: (p.probWin - won) ** 2,
        brierTop5: (p.probTop5 - top5) ** 2,
        brierTop10: (p.probTop10 - top10) ** 2,
        brierMadeCut: (p.probMadeCut - madeCut) ** 2,
      };
    });
    writeGradedTournamentPredictions(rows);
    return { graded: rows.length };
  } catch (err) {
    logSystemEvent({
      level: 'error',
      source: 'golf/models/grading',
      message: 'Failed to grade tournament predictions',
      detail: err instanceof Error ? err.message : String(err),
    });
    return { graded: 0 };
  }
}

export function gradeAllGolfPredictions(): { holeRound: number; tournament: number } {
  const holeRound = gradeGolfHoleRoundPredictions();
  const tournament = gradeGolfTournamentPredictions();
  return { holeRound: holeRound.graded, tournament: tournament.graded };
}
