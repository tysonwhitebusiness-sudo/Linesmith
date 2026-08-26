"""MLB's candidate registry for the model-benchmarking harness — the
concrete list of ModelCandidates run_benchmark() evaluates for each
market. Every fit_fn/score_fn here closes over a shared httpx.AsyncClient
at construction time (the underlying model modules are themselves client-
agnostic; only this registry knows a real client needs to be threaded
through consistently for one benchmark run).
"""
import functools

import httpx

from predict import model_fit
from predict.logistic_regression import PredictionRecord, fit_logistic_regression, predict_prob
from predict.mlb_bradley_terry import bt_fit_fn, bt_score_fn
from predict.mlb_mlp import mlp_fit_fn, mlp_score_fn
from predict.mlb_stacking import stacking_fit_fn, stacking_score_fn
from predict.mlb_tree_models import TREE_MODEL_SPECS, tree_fit_fn, tree_score_fn
from predict.model_benchmark import ModelCandidate
from predict.walkforward import FitOutput


def _rows_to_xy(rows: list[model_fit.TrainingRow]) -> tuple[list[list[float]], list[float]]:
    return [r.features for r in rows], [float(r.actual) for r in rows]


async def _formula_fit_fn(client: httpx.AsyncClient, train_seasons: list[int]):
    """Candidate #0: the existing model_fit.py logistic-regression
    pipeline, run through the new walk-forward harness instead of its own
    single static split. If this candidate wins a benchmark run, it needs
    zero new live-wiring — it already writes straight into model_weights
    via the existing fit_moneyline_weights path (see run_walkforward.py's
    --activate dispatch)."""
    result = await model_fit.build_training_set(client, train_seasons)
    x, y = _rows_to_xy(result.moneyline_rows)
    fit = fit_logistic_regression(x, y)
    return FitOutput(model=fit, train_games=len(x))


async def _formula_score_fn(client: httpx.AsyncClient, model, val_season: int) -> list[PredictionRecord]:
    result = await model_fit.build_training_set(client, [val_season])
    x, y = _rows_to_xy(result.moneyline_rows)
    return [PredictionRecord(prob=predict_prob(row, model.weights, model.intercept), actual=y[i]) for i, row in enumerate(x)]


def moneyline_candidates(client: httpx.AsyncClient) -> list[ModelCandidate]:
    candidates = [
        ModelCandidate(name="formula", fit_fn=functools.partial(_formula_fit_fn, client), score_fn=functools.partial(_formula_score_fn, client)),
        ModelCandidate(name="bradley_terry", fit_fn=functools.partial(bt_fit_fn, client), score_fn=functools.partial(bt_score_fn, client)),
    ]
    for spec in TREE_MODEL_SPECS:
        candidates.append(
            ModelCandidate(
                name=spec.name,
                fit_fn=functools.partial(tree_fit_fn, client, spec.trainer),
                score_fn=functools.partial(tree_score_fn, client),
            )
        )
    candidates.append(ModelCandidate(name="mlp", fit_fn=functools.partial(mlp_fit_fn, client), score_fn=functools.partial(mlp_score_fn, client)))
    candidates.append(ModelCandidate(name="stacking", fit_fn=functools.partial(stacking_fit_fn, client), score_fn=functools.partial(stacking_score_fn, client)))
    return candidates


# total_candidates() deliberately NOT implemented yet — every fit_fn/score_fn
# above (except bradley_terry, itself excluded from totals) is wired to
# build_training_set(...).moneyline_rows and the 7-feature MONEYLINE_FEATURE_
# NAMES shape specifically. The total market has its own real feature rows
# (build_training_set(...).total_rows, TOTAL_FEATURE_NAMES's 8 features -
# venueDiff dropped, rawPoissonOverProb/lineMovement/bullpenEraCentered
# added) that every candidate would need its own totals-aware fit/score
# path for. Scoped out on purpose per the approved plan ("moneyline first,
# totals as the immediate next follow-up once this is proven") - do not
# add a version of this function that reuses moneyline_candidates() by
# just filtering out bradley_terry, since every remaining candidate would
# silently train on the wrong feature shape for this market.
