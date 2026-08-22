"""Direct port of the prediction-relevant subset of lib/sports/golf/
adapter.ts — not a port of the whole file. Skips the display-only half
(grouped-with/live-matchup/past-matchup cards, ETA, split evidence,
subjectMeta assembly) the same way predict/prop_candidates.py skips
adapter.ts's MLB display half — this only builds what a `pick_history`-
equivalent write (golf_model_predictions/golf_tournament_predictions)
actually needs: per-golfer hole/round history and the "Phase A
prediction models" block that turns it into model probabilities.

Two disclosed adaptations:
- No PickCandidate object is built. `candidatesForGolfer`/
  `roundScoreCandidate`'s prediction-relevant output (history entries,
  category, consistency) is produced directly as plain dataclasses.
- Weather is resolved via golf_venues.py's exact-venue table only (see
  that module's own docstring for the disclosed city-level-geocode gap).
"""
import re
from dataclasses import dataclass, field

import httpx

import db
from predict.golf_espn import EspnGolfEvent, EspnGolfer
from predict.golf_models import (
    GolferProjection,
    HoleFieldObservation,
    HoleModelInput,
    RoundFieldObservation,
    RoundModelInput,
    TournamentModelInput,
    TournamentPrediction,
    field_baseline_bucket_probs,
    predict_hole_score,
    predict_round_score,
    predict_tournament,
    prior_hole_category_rate,
    ROUND_SCORE_SD,
)
from predict.golf_pgatour_stats import get_season_strokes_gained

_CUT_OUT_RE = re.compile(r"^(cut|wd|dq)$", re.IGNORECASE)


def _parse_relative_to_par(value: str | None) -> float | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if trimmed in ("", "-"):
        return None
    if trimmed.upper() == "E":
        return 0.0
    try:
        return float(trimmed.replace("+", ""))
    except ValueError:
        return None


def _category_for(relative_to_par: float) -> str:
    if relative_to_par < 0:
        return "birdie"
    if relative_to_par == 0:
        return "par"
    return "bogey"


def _modal_category(entries: list["GolfHistoryEntry"]) -> str:
    counts: dict[str, int] = {}
    for e in entries:
        counts[e.category] = counts.get(e.category, 0) + 1
    best = "par"
    best_count = -1
    for category, count in counts.items():
        if count > best_count:
            best = category
            best_count = count
    return best


@dataclass
class GolfHistoryEntry:
    period: int
    category: str  # 'birdie' | 'par' | 'bogey'
    relative_to_par: float


def _consistent_category(entries: list[GolfHistoryEntry]) -> tuple[bool, str]:
    if not entries:
        return True, "par"
    consistent = all(e.category == entries[0].category for e in entries)
    return consistent, (entries[0].category if consistent else _modal_category(entries))


def _hole_history_for(golfer: EspnGolfer, hole: int, course) -> list[GolfHistoryEntry]:
    """History for hole N is that golfer's score on hole N in each round
    with data — the round currently in progress contributes only the
    holes already played."""
    entries: list[GolfHistoryEntry] = []
    for round_ in golfer.rounds:
        hole_score = next((h for h in round_.holes if h.hole == hole), None)
        if hole_score is None:
            continue
        relative = _parse_relative_to_par(hole_score.relative_to_par)
        # Fall back to course par only when the feed omitted the
        # relative value — recovers real hole history the prediction
        # sample would otherwise silently lose, not a display concern.
        if relative is None and hole_score.strokes is not None and course is not None:
            par = next((h.shots_to_par for h in course.holes if h.number == hole), None)
            if par:
                relative = hole_score.strokes - par
        if relative is None:
            continue
        entries.append(GolfHistoryEntry(period=round_.period, category=_category_for(relative), relative_to_par=relative))
    return entries


def _round_history_for(golfer: EspnGolfer, course_par: float | None) -> list[GolfHistoryEntry]:
    """One entry per round *completed* so far this week."""
    if course_par is None:
        return []
    entries: list[GolfHistoryEntry] = []
    for round_ in golfer.rounds:
        holes_played = sum(1 for h in round_.holes if h.strokes is not None)
        if round_.total is None or round_.total <= 0 or holes_played < 18:
            continue
        relative = round_.total - course_par
        entries.append(GolfHistoryEntry(period=round_.period, category=_category_for(relative), relative_to_par=relative))
    return entries


def _next_round(history: list[GolfHistoryEntry]) -> int:
    """Only the round currently ahead of this golfer is a real
    "prediction" worth grading — a hole/round already in history is
    hindsight, not a forecast."""
    return (max(e.period for e in history) + 1) if history else 1


@dataclass
class GolfPredictionsSummary:
    hole_round_predictions_logged: int
    tournament_predictions_logged: int
    tournament_prediction: TournamentPrediction | None


async def compute_and_log_golf_predictions(client: httpx.AsyncClient, event: EspnGolfEvent, wind_mph: float | None) -> GolfPredictionsSummary:
    """The "Phase A prediction models" block: attaches model_prob/
    league_rate onto each hole/round-score history and logs it for
    grading later. Wrapped so a model failure never breaks the caller's
    own error handling — see jobs.py's golf job for the outer try/except."""
    course = event.course
    subjects = [(g.id, g.name) for g in event.golfers]
    sg_result = await get_season_strokes_gained(client, subjects, _season_of(event))
    sg_by_espn_id = {g.espn_id: g.avg_per_round for g in sg_result if g.espn_id is not None}
    matched_sg = [v for v in sg_by_espn_id.values() if v is not None]
    field_avg_sg_total = (sum(matched_sg) / len(matched_sg)) if matched_sg else None

    prediction_log_rows: list[db.GolfModelPredictionInput] = []

    # ---- Hole dimensions (hole-1 .. hole-18) ----
    for hole in range(1, 19):
        par = next((h.shots_to_par for h in (course.holes if course else []) if h.number == hole), None)
        per_golfer_history: dict[str, list[GolfHistoryEntry]] = {}
        for golfer in event.golfers:
            history = _hole_history_for(golfer, hole, course)
            if history:
                per_golfer_history[golfer.id] = history

        if not per_golfer_history:
            continue

        field_observations = [HoleFieldObservation(e.relative_to_par) for entries in per_golfer_history.values() for e in entries]

        for golfer in event.golfers:
            history = per_golfer_history.get(golfer.id)
            if not history:
                continue
            golfer_sg_total = sg_by_espn_id.get(golfer.id)
            own_observations = [HoleFieldObservation(e.relative_to_par) for e in history]
            prediction = predict_hole_score(HoleModelInput(par=int(par) if par is not None else None, field_observations=field_observations, golfer_own_observations=own_observations, golfer_sg_total=golfer_sg_total, field_avg_sg_total=field_avg_sg_total))

            _consistent, category = _consistent_category(history)
            model_prob = {"birdie": prediction.prob_birdie, "par": prediction.prob_par, "bogey": prediction.prob_bogey}[category]
            league_rate = prior_hole_category_rate(int(par) if par is not None else None, category)
            prediction_log_rows.append(
                db.GolfModelPredictionInput(
                    event_id=event.id,
                    espn_id=golfer.id,
                    dimension=f"hole-{hole}",
                    round=_next_round(history),
                    category=category,
                    predicted_prob=model_prob,
                    league_rate=league_rate,
                )
            )

    # ---- Round-score dimension + tournament winner ----
    course_par = course.shots_to_par if course else None
    per_golfer_round_history: dict[str, list[GolfHistoryEntry]] = {}
    for golfer in event.golfers:
        history = _round_history_for(golfer, course_par)
        if history:
            per_golfer_round_history[golfer.id] = history

    tournament_prediction: TournamentPrediction | None = None
    tournament_predictions_logged = 0

    if per_golfer_round_history:
        round_field_observations = [RoundFieldObservation(e.relative_to_par) for entries in per_golfer_round_history.values() for e in entries]
        league_buckets = field_baseline_bucket_probs(round_field_observations)

        for golfer in event.golfers:
            history = per_golfer_round_history.get(golfer.id)
            if not history:
                continue
            golfer_sg_total = sg_by_espn_id.get(golfer.id)
            own_observations = [RoundFieldObservation(e.relative_to_par) for e in history]
            prediction = predict_round_score(RoundModelInput(field_observations=round_field_observations, golfer_own_observations=own_observations, golfer_sg_total=golfer_sg_total, field_avg_sg_total=field_avg_sg_total, wind_mph=wind_mph))

            _consistent, category = _consistent_category(history)
            model_prob = {"birdie": prediction.prob_under_par, "par": prediction.prob_even_par, "bogey": prediction.prob_over_par}[category]
            league_rate = {"birdie": league_buckets.prob_under_par, "par": league_buckets.prob_even_par, "bogey": league_buckets.prob_over_par}[category]
            prediction_log_rows.append(
                db.GolfModelPredictionInput(
                    event_id=event.id,
                    espn_id=golfer.id,
                    dimension="round-score",
                    round=_next_round(history),
                    category=category,
                    predicted_prob=model_prob,
                    league_rate=league_rate,
                )
            )

        # Tournament winner — one sim for the whole field.
        projections: list[GolferProjection] = []
        for golfer in event.golfers:
            position = golfer.status.position_display_name
            if position is not None and _CUT_OUT_RE.match(position.strip()):
                continue
            history = per_golfer_round_history.get(golfer.id, [])
            completed_rounds = [e.relative_to_par for e in sorted(history, key=lambda e: e.period)]
            golfer_sg_total = sg_by_espn_id.get(golfer.id)
            projection_pred = predict_round_score(RoundModelInput(field_observations=round_field_observations, golfer_own_observations=[RoundFieldObservation(r) for r in completed_rounds], golfer_sg_total=golfer_sg_total, field_avg_sg_total=field_avg_sg_total, wind_mph=wind_mph))
            projections.append(GolferProjection(espn_id=golfer.id, completed_rounds=completed_rounds, projected_round_mean=projection_pred.expected_relative_to_par))

        if projections:
            rounds_in_progress = max((len(p.completed_rounds) for p in projections), default=0)
            tournament_prediction = predict_tournament(
                TournamentModelInput(
                    golfers=projections,
                    total_rounds=4,
                    # The real cut already happened once round 3 is
                    # underway — the CUT/WD/DQ filter above already
                    # reflects who actually survived.
                    cut_size=None if rounds_in_progress >= 2 else 65,
                    cut_after_round=2,
                    iterations=3000,
                    round_score_sd=ROUND_SCORE_SD,
                )
            )
            written = await db.log_golf_tournament_predictions(
                [
                    db.GolfTournamentPredictionInput(event_id=event.id, espn_id=o.espn_id, prob_win=o.prob_win, prob_top5=o.prob_top5, prob_top10=o.prob_top10, prob_made_cut=o.prob_made_cut)
                    for o in tournament_prediction.outcomes
                ]
            )
            tournament_predictions_logged = written

    hole_round_written = await db.log_golf_model_predictions(prediction_log_rows)

    return GolfPredictionsSummary(hole_round_predictions_logged=hole_round_written, tournament_predictions_logged=tournament_predictions_logged, tournament_prediction=tournament_prediction)


def _season_of(event: EspnGolfEvent) -> int:
    from predict.statsapi import eastern_date

    return int(eastern_date()[:4])
