"""MLB's gradient-boosting ensemble candidates for the model benchmarking
harness — three real, separate libraries (matching the reference system's
own CatBoost/XGBoost/LightGBM set exactly, rather than one generic stand-in
via a single library), plus predict/mlb_mlp.py's neural net as the fourth
base model. All three reuse the EXACT SAME feature vectors
predict/model_fit.py's build_training_set already builds
(MONEYLINE_FEATURE_NAMES) — same 7 raw signals every non-Bradley-Terry
candidate consumes, so this is a fair architecture comparison, not also a
feature-engineering comparison.

Fixed, reasonable starting hyperparameters per library — NOT hyperparameter-
tuned in this pass (a nested-CV tuning loop is real future work, not
promised here).
"""
import pickle
from dataclasses import dataclass
from typing import Protocol

import httpx
from catboost import CatBoostClassifier
from lightgbm import LGBMClassifier
from xgboost import XGBClassifier

from predict import model_fit
from predict.logistic_regression import PredictionRecord
from predict.walkforward import FitOutput

_RANDOM_STATE = 42


class _Classifier(Protocol):
    def fit(self, x: list[list[float]], y: list[float]) -> "_Classifier": ...
    def predict_proba(self, x: list[list[float]]) -> list[list[float]]: ...


def fit_catboost(x: list[list[float]], y: list[float]) -> CatBoostClassifier:
    model = CatBoostClassifier(
        iterations=300,
        depth=4,
        learning_rate=0.05,
        l2_leaf_reg=3.0,
        loss_function="Logloss",
        random_seed=_RANDOM_STATE,
        verbose=False,
        allow_writing_files=False,  # CatBoost otherwise drops a catboost_info/ training-log directory in the process's cwd on every fit — a side effect with no use in this pipeline
    )
    model.fit(x, y)
    return model


def fit_xgboost(x: list[list[float]], y: list[float]) -> XGBClassifier:
    model = XGBClassifier(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        reg_lambda=1.0,
        eval_metric="logloss",
        random_state=_RANDOM_STATE,
    )
    model.fit(x, y)
    return model


def fit_lightgbm(x: list[list[float]], y: list[float]) -> LGBMClassifier:
    model = LGBMClassifier(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        reg_lambda=0.1,
        random_state=_RANDOM_STATE,
        verbose=-1,
    )
    model.fit(x, y)
    return model


def serialize_model(model: _Classifier) -> bytes:
    return pickle.dumps(model)


def deserialize_model(blob: bytes) -> _Classifier:
    """pickle is safe here specifically because model_artifacts.artifact_blob
    is service-role-written/internal-only, never derived from user input —
    same trust boundary model_weights.weights_json already has."""
    return pickle.loads(blob)


@dataclass
class TreeModelSpec:
    name: str
    trainer: "callable"  # (x, y) -> fitted classifier


TREE_MODEL_SPECS: list[TreeModelSpec] = [
    TreeModelSpec(name="catboost", trainer=fit_catboost),
    TreeModelSpec(name="xgboost", trainer=fit_xgboost),
    TreeModelSpec(name="lightgbm", trainer=fit_lightgbm),
]


def _rows_to_xy(rows: list[model_fit.TrainingRow]) -> tuple[list[list[float]], list[float]]:
    return [r.features for r in rows], [float(r.actual) for r in rows]


async def tree_fit_fn(client: httpx.AsyncClient, trainer, train_seasons: list[int]) -> FitOutput[_Classifier]:
    """Adapter to walkforward.py's FitOutput shape. `trainer` is one of
    fit_catboost/fit_xgboost/fit_lightgbm, closed over at registration time
    (see mlb_model_candidates.py) — this function itself is shared by all
    three so the identical build-training-set-then-fit shape isn't
    triplicated."""
    result = await model_fit.build_training_set(client, train_seasons)
    x, y = _rows_to_xy(result.moneyline_rows)
    model = trainer(x, y)
    return FitOutput(model=model, train_games=len(result.moneyline_rows))


async def tree_score_fn(client: httpx.AsyncClient, model: _Classifier, val_season: int) -> list[PredictionRecord]:
    result = await model_fit.build_training_set(client, [val_season])
    x, y = _rows_to_xy(result.moneyline_rows)
    if len(x) == 0:
        return []
    probs = model.predict_proba(x)
    # predict_proba returns [P(class=0), P(class=1)] columns for a binary
    # classifier in every one of these three libraries — index 1 is P(home
    # win), matching this framework's own actual=1-means-home-won
    # convention throughout (model_fit.py's TrainingRow.actual, game_pick_
    # lock.py's grading).
    return [PredictionRecord(prob=float(p[1]), actual=y[i]) for i, p in enumerate(probs)]
