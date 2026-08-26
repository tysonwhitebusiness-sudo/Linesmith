"""MLB's neural-net candidate — scikit-learn's built-in MLPClassifier, no
separate deep-learning framework needed. Same shape as
predict/mlb_tree_models.py: reuses model_fit.build_training_set's existing
feature rows, fixed starting hyperparameters (not tuned in this pass).
"""
import pickle

import httpx
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

from predict import model_fit
from predict.logistic_regression import PredictionRecord
from predict.walkforward import FitOutput

_RANDOM_STATE = 42


class ScaledMLP:
    """MLPClassifier is sensitive to feature scale (unlike the tree
    models, which split on raw thresholds and don't care) — bundles a
    StandardScaler with the network so callers never have to remember to
    scale features consistently between fit and predict."""

    def __init__(self, scaler: StandardScaler, model: MLPClassifier):
        self.scaler = scaler
        self.model = model

    def predict_proba(self, x: list[list[float]]) -> list[list[float]]:
        return self.model.predict_proba(self.scaler.transform(x))


def fit_mlp(x: list[list[float]], y: list[float]) -> ScaledMLP:
    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(x)
    model = MLPClassifier(
        hidden_layer_sizes=(16, 8),
        activation="relu",
        alpha=0.01,
        learning_rate_init=0.005,
        max_iter=1000,
        random_state=_RANDOM_STATE,
    )
    model.fit(x_scaled, y)
    return ScaledMLP(scaler=scaler, model=model)


def serialize_mlp(model: ScaledMLP) -> bytes:
    return pickle.dumps(model)


def deserialize_mlp(blob: bytes) -> ScaledMLP:
    """Same trust boundary as mlb_tree_models.deserialize_model — pickle is
    safe here because model_artifacts.artifact_blob is service-role-written/
    internal-only, never derived from user input."""
    return pickle.loads(blob)


def _rows_to_xy(rows: list[model_fit.TrainingRow]) -> tuple[list[list[float]], list[float]]:
    return [r.features for r in rows], [float(r.actual) for r in rows]


async def mlp_fit_fn(client: httpx.AsyncClient, train_seasons: list[int]) -> FitOutput[ScaledMLP]:
    result = await model_fit.build_training_set(client, train_seasons)
    x, y = _rows_to_xy(result.moneyline_rows)
    model = fit_mlp(x, y)
    return FitOutput(model=model, train_games=len(result.moneyline_rows))


async def mlp_score_fn(client: httpx.AsyncClient, model: ScaledMLP, val_season: int) -> list[PredictionRecord]:
    result = await model_fit.build_training_set(client, [val_season])
    x, y = _rows_to_xy(result.moneyline_rows)
    if len(x) == 0:
        return []
    probs = model.predict_proba(x)
    return [PredictionRecord(prob=float(p[1]), actual=y[i]) for i, p in enumerate(probs)]
