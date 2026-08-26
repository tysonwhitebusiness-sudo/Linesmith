"""Sport-agnostic walk-forward cross-validation harness. No baseball, no
sport-specific anything in this file — it operates purely on season
numbers and caller-supplied fit/score callbacks.

Generalizes the single static train/holdout split model_fit.py's own
fit_moneyline_weights/fit_total_weights already do (caller passes fixed
train_seasons/holdout_seasons lists) into real multiple-fold expanding-
window walk-forward CV, matching the reference methodology audited this
session: fold i trains on an ever-growing prefix of seasons and validates
on the next one, never touching the final held-out test seasons until one
last pass at the very end.

Deliberately reuses PredictionRecord from logistic_regression.py (the
{prob, actual} shape that module's own brier_score already reads) rather
than inventing a second one, so any existing brier_score caller and this
module's log_loss both score the exact same object.
"""
import math
from dataclasses import dataclass
from typing import Awaitable, Callable, Generic, TypeVar

from predict.logistic_regression import PredictionRecord, brier_score

ModelT = TypeVar("ModelT")


@dataclass
class FitOutput(Generic[ModelT]):
    model: ModelT
    train_games: int


@dataclass
class Fold:
    fold_index: int
    train_seasons: list[int]
    val_season: int


@dataclass
class FoldResult:
    fold_index: int
    train_seasons: list[int]
    val_season: int
    train_games: int
    val_games: int
    log_loss: float
    brier_score: float


@dataclass
class WalkforwardResult:
    folds: list[FoldResult]
    mean_log_loss: float
    mean_brier_score: float
    test_seasons: list[int]
    final_train_seasons: list[int]
    final_train_games: int
    final_test_games: int
    final_test_log_loss: float
    final_test_brier_score: float


def generate_expanding_folds(train_pool_seasons: list[int], min_train_seasons: int) -> list[Fold]:
    """train_pool_seasons: ascending, already EXCLUDING the final held-out
    test seasons (those never appear here — only in run_walkforward's
    separate final-test pass). Fold i trains on
    train_pool_seasons[0 : min_train_seasons+i], validates on
    train_pool_seasons[min_train_seasons+i] — one fold per season after the
    first `min_train_seasons` warmup seasons. Raises ValueError if there
    isn't at least one full season left to validate against after warmup,
    rather than silently returning an empty fold list a caller might not
    notice."""
    if min_train_seasons < 1:
        raise ValueError(f"min_train_seasons must be >= 1, got {min_train_seasons}")
    if len(train_pool_seasons) <= min_train_seasons:
        raise ValueError(
            f"train_pool_seasons has {len(train_pool_seasons)} season(s), needs more than "
            f"min_train_seasons ({min_train_seasons}) to produce at least one fold"
        )
    folds: list[Fold] = []
    for i, val_season in enumerate(train_pool_seasons[min_train_seasons:]):
        train_seasons = train_pool_seasons[: min_train_seasons + i]
        folds.append(Fold(fold_index=i, train_seasons=train_seasons, val_season=val_season))
    return folds


def log_loss(predictions: list[PredictionRecord], eps: float = 1e-15) -> float:
    """-mean(y*log(p) + (1-y)*log(1-p)), clamped to [eps, 1-eps] so a
    perfectly-wrong-and-confident prediction doesn't produce -inf/NaN and
    silently poison a mean/comparison downstream. This is the reference
    system's own model-selection metric; logistic_regression.py only has
    brier_score today, which stays the activation-gate metric for
    model_fit.py's existing candidates (unchanged), while log_loss is the
    new selection metric model_benchmark.py's multi-candidate ranking and
    calibration.py's method-selection both use instead."""
    if len(predictions) == 0:
        return float("nan")
    total = 0.0
    for p in predictions:
        prob = min(max(p.prob, eps), 1 - eps)
        total += -(p.actual * math.log(prob) + (1 - p.actual) * math.log(1 - prob))
    return total / len(predictions)


def brier(predictions: list[PredictionRecord]) -> float:
    """Thin re-export so every caller in this module (and its own callers)
    imports both scoring functions from one place instead of reaching into
    logistic_regression.py directly for one and walkforward.py for the
    other."""
    return brier_score(predictions)


async def run_walkforward(
    train_pool_seasons: list[int],
    test_seasons: list[int],
    min_train_seasons: int,
    fit_fn: Callable[[list[int]], Awaitable[FitOutput[ModelT]]],
    score_fn: Callable[[ModelT, int], Awaitable[list[PredictionRecord]]],
) -> WalkforwardResult:
    """Runs generate_expanding_folds, calling fit_fn(train_seasons) then
    score_fn(model, val_season) per fold — fit_fn is never called on
    anything overlapping test_seasons during the fold loop. After all
    folds, fits ONE final model on the full train_pool_seasons (every
    season available for training, CV folds included) and scores it
    against test_seasons (concatenated into one prediction list) — that
    final number, not the per-fold numbers, is what an activation decision
    should be based on; per-fold numbers are diagnostic/reporting only.

    test_seasons must not overlap train_pool_seasons — checked explicitly
    rather than left to silently corrupt the final-test number."""
    overlap = set(train_pool_seasons) & set(test_seasons)
    if overlap:
        raise ValueError(f"test_seasons overlaps train_pool_seasons: {sorted(overlap)} — the final test score would be contaminated")

    folds = generate_expanding_folds(train_pool_seasons, min_train_seasons)

    fold_results: list[FoldResult] = []
    for fold in folds:
        fit_output = await fit_fn(fold.train_seasons)
        predictions = await score_fn(fit_output.model, fold.val_season)
        if len(predictions) == 0:
            raise ValueError(f"fold {fold.fold_index}: score_fn returned 0 predictions for val_season={fold.val_season} — every fold must produce at least one scored prediction")
        fold_results.append(
            FoldResult(
                fold_index=fold.fold_index,
                train_seasons=fold.train_seasons,
                val_season=fold.val_season,
                train_games=fit_output.train_games,
                val_games=len(predictions),
                log_loss=log_loss(predictions),
                brier_score=brier(predictions),
            )
        )

    final_fit_output = await fit_fn(train_pool_seasons)
    final_predictions: list[PredictionRecord] = []
    for season in test_seasons:
        final_predictions.extend(await score_fn(final_fit_output.model, season))
    if len(final_predictions) == 0:
        raise ValueError(f"final test pass: score_fn returned 0 predictions across test_seasons={test_seasons}")

    mean_log_loss = sum(f.log_loss for f in fold_results) / len(fold_results)
    mean_brier = sum(f.brier_score for f in fold_results) / len(fold_results)

    return WalkforwardResult(
        folds=fold_results,
        mean_log_loss=mean_log_loss,
        mean_brier_score=mean_brier,
        test_seasons=test_seasons,
        final_train_seasons=train_pool_seasons,
        final_train_games=final_fit_output.train_games,
        final_test_games=len(final_predictions),
        final_test_log_loss=log_loss(final_predictions),
        final_test_brier_score=brier(final_predictions),
    )
