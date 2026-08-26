"""MLB's stacking meta-model — the fifth ensemble candidate, combining the
four base models (CatBoost/XGBoost/LightGBM/MLP; Bradley-Terry excluded,
different feature shape) via a small logistic regression trained on their
out-of-fold predictions, matching the reference methodology audited this
session.

Self-contained ModelCandidate: fit_fn/score_fn here don't thread anything
special through model_benchmark.py's generic harness — stacking is just
another candidate with its own fit/score pair, keeping the shared harness
itself completely unaware that one candidate happens to be built from
others.

Genuine out-of-fold discipline, not leakage: base models used to GENERATE
the meta-model's training features are fit on an inner-train split and
scored on a held-out inner-val season they never saw — the meta-model
never trains on predictions from a model that already saw those same
rows. Separately, once the meta-model's combination weights are fixed, the
base models actually used at SCORE time are refit on the full
train_seasons (all data available to this fold) — more data only helps a
base model's own accuracy and doesn't reintroduce leakage, since the meta-
weights themselves were already learned from honest out-of-fold data.
"""
from dataclasses import dataclass

import httpx

from predict import model_fit
from predict.logistic_regression import PredictionRecord, fit_logistic_regression, predict_prob
from predict.mlb_mlp import fit_mlp
from predict.mlb_tree_models import fit_catboost, fit_lightgbm, fit_xgboost
from predict.walkforward import FitOutput

_BASE_MODEL_NAMES = ("catboost", "xgboost", "lightgbm", "mlp")


@dataclass
class StackingModel:
    base_models: dict  # name -> fitted classifier (has .predict_proba)
    meta_weights: list[float]
    meta_intercept: float


def _rows_to_xy(rows: list[model_fit.TrainingRow]) -> tuple[list[list[float]], list[float]]:
    return [r.features for r in rows], [float(r.actual) for r in rows]


def _fit_base_models(x: list[list[float]], y: list[float]) -> dict:
    return {
        "catboost": fit_catboost(x, y),
        "xgboost": fit_xgboost(x, y),
        "lightgbm": fit_lightgbm(x, y),
        "mlp": fit_mlp(x, y),
    }


def _base_probs_for_row(base_models: dict, row: list[float]) -> list[float]:
    return [float(base_models[name].predict_proba([row])[0][1]) for name in _BASE_MODEL_NAMES]


async def stacking_fit_fn(client: httpx.AsyncClient, train_seasons: list[int]) -> FitOutput[StackingModel]:
    if len(train_seasons) < 2:
        raise ValueError(f"stacking_fit_fn: needs at least 2 train_seasons (one for the inner train split, one for the inner out-of-fold val split), got {train_seasons}")

    inner_train_seasons = train_seasons[:-1]
    inner_val_season = train_seasons[-1]

    inner_train_result = await model_fit.build_training_set(client, inner_train_seasons)
    x_inner_train, y_inner_train = _rows_to_xy(inner_train_result.moneyline_rows)
    oof_base_models = _fit_base_models(x_inner_train, y_inner_train)

    inner_val_result = await model_fit.build_training_set(client, [inner_val_season])
    x_inner_val, y_inner_val = _rows_to_xy(inner_val_result.moneyline_rows)

    meta_features = [_base_probs_for_row(oof_base_models, row) for row in x_inner_val]
    meta_fit = fit_logistic_regression(meta_features, y_inner_val)

    # Base models actually used at score time: refit on ALL of
    # train_seasons (the full data this fold has available), not just the
    # inner-train slice used to generate honest out-of-fold predictions
    # above. The meta-weights were already learned from genuinely
    # out-of-fold data, so refitting the base models on more data here
    # doesn't reintroduce leakage into the meta-fit itself.
    full_result = await model_fit.build_training_set(client, train_seasons)
    x_full, y_full = _rows_to_xy(full_result.moneyline_rows)
    final_base_models = _fit_base_models(x_full, y_full)

    model = StackingModel(base_models=final_base_models, meta_weights=meta_fit.weights, meta_intercept=meta_fit.intercept)
    return FitOutput(model=model, train_games=len(x_full))


async def stacking_score_fn(client: httpx.AsyncClient, model: StackingModel, val_season: int) -> list[PredictionRecord]:
    result = await model_fit.build_training_set(client, [val_season])
    x, y = _rows_to_xy(result.moneyline_rows)
    predictions = []
    for i, row in enumerate(x):
        base_probs = _base_probs_for_row(model.base_models, row)
        meta_prob = predict_prob(base_probs, model.meta_weights, model.meta_intercept)
        predictions.append(PredictionRecord(prob=meta_prob, actual=y[i]))
    return predictions
