"""Sport-agnostic probability calibration: Platt scaling and isotonic
regression, empirically selected by whichever scores lower held-out
log-loss (matching the reference methodology audited this session), with
persistence via model_calibration (a sibling to model_weights — see that
table's migration comment for why it isn't a column on model_weights
instead).

Deliberately no baseball, no golf, nothing sport-specific — this module
takes (raw_prob, outcome) pairs and a (sport, market) label to persist
under, nothing more.
"""
from dataclasses import dataclass
from datetime import datetime, timezone

import db
from predict.logistic_regression import PredictionRecord, fit_logistic_regression, predict_prob
from predict.walkforward import log_loss

_EPS = 1e-15


def _logit(p: float) -> float:
    clamped = min(max(p, _EPS), 1 - _EPS)
    import math

    return math.log(clamped / (1 - clamped))


@dataclass
class PlattParams:
    a: float
    b: float


def fit_platt(raw_probs: list[float], outcomes: list[float]) -> PlattParams:
    """logit(raw_prob) as the SOLE feature fed into the existing
    fit_logistic_regression — a 1-feature reuse of the already-fitted,
    already-tested gradient-descent fitter, not a new optimizer.
    calibrated = sigmoid(a * logit(raw_prob) + b)."""
    x = [[_logit(p)] for p in raw_probs]
    fit = fit_logistic_regression(x, outcomes)
    return PlattParams(a=fit.weights[0], b=fit.intercept)


def apply_platt(raw_prob: float, params: PlattParams) -> float:
    return predict_prob([_logit(raw_prob)], [params.a], params.b)


@dataclass
class IsotonicParams:
    x: list[float]  # ascending breakpoints (raw prob)
    y: list[float]  # non-decreasing calibrated values, same length as x


def fit_isotonic(raw_probs: list[float], outcomes: list[float]) -> IsotonicParams:
    """Pool Adjacent Violators Algorithm (PAVA) — hand-rolled, no existing
    precedent in this codebase to reuse (numpy/scipy aren't available to
    every module here, and this one deliberately stays consistent with
    that even though calibration.py's sibling tree-model files do pull in
    real ML libraries — PAVA is simple enough not to need one).

    Sort (raw_prob, outcome) ascending by raw_prob into unit-weight blocks;
    repeatedly merge any adjacent pair of blocks whose means violate
    monotonicity (merged block's value = weighted mean, weight = sum of
    weights) until no violation remains. Standard stack-based O(n) pass
    after an O(n log n) sort."""
    if len(raw_probs) != len(outcomes):
        raise ValueError(f"fit_isotonic: raw_probs ({len(raw_probs)}) and outcomes ({len(outcomes)}) must be the same length")
    if len(raw_probs) == 0:
        raise ValueError("fit_isotonic: at least one (raw_prob, outcome) pair is required")

    pairs = sorted(zip(raw_probs, outcomes), key=lambda t: t[0])

    # Each stack entry: [x_min, x_max, weighted_sum_y, weight].
    stack: list[list[float]] = []
    for x, y in pairs:
        block = [x, x, y, 1.0]
        stack.append(block)
        while len(stack) >= 2 and (stack[-2][2] / stack[-2][3]) > (stack[-1][2] / stack[-1][3]):
            b = stack.pop()
            a = stack.pop()
            merged = [a[0], b[1], a[2] + b[2], a[3] + b[3]]
            stack.append(merged)

    xs: list[float] = []
    ys: list[float] = []
    for x_min, x_max, weighted_sum_y, weight in stack:
        mean_y = weighted_sum_y / weight
        # Emit both endpoints of the block at the same mean value so
        # apply_isotonic's piecewise-linear interpolation is flat across
        # a merged block rather than sloping between its raw x_min/x_max.
        xs.append(x_min)
        ys.append(mean_y)
        if x_max != x_min:
            xs.append(x_max)
            ys.append(mean_y)

    return IsotonicParams(x=xs, y=ys)


def apply_isotonic(raw_prob: float, params: IsotonicParams) -> float:
    """Piecewise-linear interpolation between fitted breakpoints; clamps to
    the first/last y outside the fitted x range rather than extrapolating."""
    xs, ys = params.x, params.y
    if raw_prob <= xs[0]:
        return ys[0]
    if raw_prob >= xs[-1]:
        return ys[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= raw_prob <= xs[i + 1]:
            if xs[i + 1] == xs[i]:
                return ys[i]
            t = (raw_prob - xs[i]) / (xs[i + 1] - xs[i])
            return ys[i] + t * (ys[i + 1] - ys[i])
    return ys[-1]  # unreachable given the bounds checks above; defensive only


@dataclass
class CalibrationFitSummary:
    method: str
    train_games: int
    holdout_games: int
    train_log_loss: float
    holdout_log_loss: float
    baseline_holdout_log_loss: float
    activated: bool
    saved_row: db.CalibrationRow


async def fit_and_select_calibration(
    sport: str,
    market: str,
    train_records: list[PredictionRecord],
    holdout_records: list[PredictionRecord],
) -> CalibrationFitSummary:
    """Fits BOTH platt and isotonic on train_records; scores both on
    holdout_records; selects whichever has the lower holdout log-loss
    (empirical selection, matching the reference methodology rather than
    assuming one always wins). Activation gate: activated =
    calibrated_holdout_log_loss < baseline_holdout_log_loss, where baseline
    is the RAW (uncalibrated) holdout log_loss — same strictly-less-than,
    no-margin convention model_fit.py's own Brier gate already uses.
    Always writes via db.write_calibration(..., activated), win or lose,
    matching model_weights's "persist every attempt" convention."""
    if len(train_records) == 0 or len(holdout_records) == 0:
        raise ValueError(f"fit_and_select_calibration: train_records ({len(train_records)}) and holdout_records ({len(holdout_records)}) must both be non-empty")

    train_raw = [r.prob for r in train_records]
    train_outcomes = [r.actual for r in train_records]

    platt_params = fit_platt(train_raw, train_outcomes)
    isotonic_params = fit_isotonic(train_raw, train_outcomes)

    baseline_holdout_log_loss = log_loss(holdout_records)

    platt_holdout_preds = [PredictionRecord(prob=apply_platt(r.prob, platt_params), actual=r.actual) for r in holdout_records]
    isotonic_holdout_preds = [PredictionRecord(prob=apply_isotonic(r.prob, isotonic_params), actual=r.actual) for r in holdout_records]

    platt_holdout_log_loss = log_loss(platt_holdout_preds)
    isotonic_holdout_log_loss = log_loss(isotonic_holdout_preds)

    if platt_holdout_log_loss <= isotonic_holdout_log_loss:
        method, params = "platt", {"a": platt_params.a, "b": platt_params.b}
        holdout_log_loss = platt_holdout_log_loss
        train_preds = [PredictionRecord(prob=apply_platt(r.prob, platt_params), actual=r.actual) for r in train_records]
    else:
        method, params = "isotonic", {"x": isotonic_params.x, "y": isotonic_params.y}
        holdout_log_loss = isotonic_holdout_log_loss
        train_preds = [PredictionRecord(prob=apply_isotonic(r.prob, isotonic_params), actual=r.actual) for r in train_records]

    train_log_loss = log_loss(train_preds)
    activated = holdout_log_loss < baseline_holdout_log_loss

    saved_row = await db.write_calibration(
        db.CalibrationInput(
            sport=sport,
            market=market,
            method=method,
            params=params,
            train_games=len(train_records),
            train_log_loss=train_log_loss,
            holdout_games=len(holdout_records),
            holdout_log_loss=holdout_log_loss,
            baseline_holdout_log_loss=baseline_holdout_log_loss,
        ),
        activate=activated,
    )

    return CalibrationFitSummary(
        method=method,
        train_games=len(train_records),
        holdout_games=len(holdout_records),
        train_log_loss=train_log_loss,
        holdout_log_loss=holdout_log_loss,
        baseline_holdout_log_loss=baseline_holdout_log_loss,
        activated=activated,
        saved_row=saved_row,
    )


def apply_calibration(raw_prob: float, row: "db.CalibrationRow | None") -> float:
    """row=None -> raw_prob unchanged (graceful no-op, matching the
    existing convention elsewhere that get_active_model_weights(...)=None
    just falls back to the hand-coded formula rather than erroring)."""
    if row is None:
        return raw_prob
    if row.method == "platt":
        return apply_platt(raw_prob, PlattParams(a=row.params["a"], b=row.params["b"]))
    if row.method == "isotonic":
        return apply_isotonic(raw_prob, IsotonicParams(x=row.params["x"], y=row.params["y"]))
    raise ValueError(f"apply_calibration: unknown calibration method {row.method!r}")
