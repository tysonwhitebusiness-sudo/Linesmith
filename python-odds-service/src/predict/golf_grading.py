"""Direct port of lib/sports/golf/models/grading.ts — not a
reimplementation.

Grades golf's logged Phase A predictions against real outcomes as they
land. Every poll logs a prediction (predict/golf_candidates.py); this
checks whether any logged prediction now has a matching real result in
golf_hole_scores/golf_round_scores/golf_tournament_results and, if so,
freezes a hit/Brier-score verdict onto it. A prediction graded once never
changes again — db.py's `WHERE graded_at IS NULL` upsert guard already
prevents a later poll from silently overwriting it.

Brier score: (predicted_prob - actual)^2, actual in {0, 1} — the standard
proper scoring rule for a probability forecast. Lower is better; 0.25 is
what a coin-flip forecaster scores on a 50/50 event.
"""
import re

import db

_POSITION_T_RE = re.compile(r"^T", re.IGNORECASE)


def _position_rank(position: str | None) -> int | None:
    """'1' -> 1, 'T3' -> 3, 'CUT'/'WD'/'DQ'/None -> None (never top-anything)."""
    if not position:
        return None
    try:
        return int(_POSITION_T_RE.sub("", position))
    except ValueError:
        return None


async def grade_golf_hole_round_predictions() -> int:
    try:
        gradeable = await db.find_gradeable_hole_predictions()
        if not gradeable:
            return 0

        rows = []
        for p in gradeable:
            hit = 1 if p.actual_category == p.category else 0
            brier_component = (p.predicted_prob - hit) ** 2
            rows.append(db.GradedHolePredictionInput(id=p.id, hit=hit, actual_category=p.actual_category, brier_component=brier_component))
        await db.write_graded_hole_predictions(rows)
        return len(rows)
    except Exception as err:  # noqa: BLE001
        await db.log_system_event("error", "golf/models/grading", "Failed to grade hole/round predictions", str(err))
        return 0


async def grade_golf_tournament_predictions() -> int:
    try:
        gradeable = await db.find_gradeable_tournament_predictions()
        if not gradeable:
            return 0

        rows = []
        for p in gradeable:
            rank = _position_rank(p.position)
            won = 1 if rank == 1 else 0
            top5 = 1 if rank is not None and rank <= 5 else 0
            top10 = 1 if rank is not None and rank <= 10 else 0
            made_cut = 1 if p.made_cut else 0
            rows.append(
                db.GradedTournamentPredictionInput(
                    event_id=p.event_id,
                    espn_id=p.espn_id,
                    won=won,
                    top5=top5,
                    top10=top10,
                    made_cut=made_cut,
                    brier_win=(p.prob_win - won) ** 2,
                    brier_top5=(p.prob_top5 - top5) ** 2,
                    brier_top10=(p.prob_top10 - top10) ** 2,
                    brier_made_cut=(p.prob_made_cut - made_cut) ** 2,
                )
            )
        await db.write_graded_tournament_predictions(rows)
        return len(rows)
    except Exception as err:  # noqa: BLE001
        await db.log_system_event("error", "golf/models/grading", "Failed to grade tournament predictions", str(err))
        return 0


async def grade_all_golf_predictions() -> dict:
    hole_round = await grade_golf_hole_round_predictions()
    tournament = await grade_golf_tournament_predictions()
    return {"holeRound": hole_round, "tournament": tournament}
