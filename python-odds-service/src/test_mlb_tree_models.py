"""Standalone verification for predict/mlb_tree_models.py. Serialize/
deserialize round-trip on synthetic features (no network), then one real
fit against real 2023 season data for each of the three libraries (the
expensive model_fit.build_training_set call — real per-team stats, bullpen
ERAs, and a real sim-engine pass per game — is made ONCE and reused across
all three trainers, not once per library, since the underlying feature
rows don't depend on which tree library consumes them), confirming
training completes without exception and produces valid probabilities.
One direct tree_fit_fn/tree_score_fn call (the adapter functions
mlb_model_candidates.py will actually register) proves that wiring works
too, without re-paying the full live-data cost a third time. Same
convention as test_game_pick_lock.py.
"""
import asyncio
import sys

import httpx

sys.path.insert(0, "src")

from predict import model_fit
from predict.logistic_regression import PredictionRecord
from predict.mlb_tree_models import TREE_MODEL_SPECS, deserialize_model, serialize_model, tree_fit_fn, tree_score_fn

_failures = 0


def check_true(label: str, condition: bool) -> None:
    global _failures
    if condition:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — condition was False")


def test_serialize_roundtrip_synthetic() -> None:
    import random

    rng = random.Random(1)
    x = [[rng.random() for _ in range(7)] for _ in range(200)]
    y = [1.0 if sum(row) > 3.5 else 0.0 for row in x]

    for spec in TREE_MODEL_SPECS:
        model = spec.trainer(x, y)
        before = model.predict_proba(x[:10])
        blob = serialize_model(model)
        restored = deserialize_model(blob)
        after = restored.predict_proba(x[:10])
        check_true(f"{spec.name}: serialize/deserialize round-trip matches", all(abs(b[1] - a[1]) < 1e-9 for b, a in zip(before, after)))


async def test_live_fit_each_library_shared_data() -> None:
    async with httpx.AsyncClient() as client:
        print("building real training set for 2023 (real per-team stats + sim engine, may take a while)...")
        train_result = await model_fit.build_training_set(client, [2023])
        x_train = [r.features for r in train_result.moneyline_rows]
        y_train = [float(r.actual) for r in train_result.moneyline_rows]
        check_true(f"2023 training set has a plausible game count ({len(x_train)})", 2000 <= len(x_train) <= 2500)

        print("building real scoring set for 2022...")
        score_result = await model_fit.build_training_set(client, [2022])
        x_score = [r.features for r in score_result.moneyline_rows]
        y_score = [float(r.actual) for r in score_result.moneyline_rows]

        for spec in TREE_MODEL_SPECS:
            model = spec.trainer(x_train, y_train)
            probs = model.predict_proba(x_score)
            predictions = [PredictionRecord(prob=float(p[1]), actual=y_score[i]) for i, p in enumerate(probs)]
            check_true(f"{spec.name}: live fit+score against real data, all probs in [0,1]", all(0.0 <= p.prob <= 1.0 for p in predictions))
            check_true(f"{spec.name}: produced predictions for every scored game", len(predictions) == len(x_score))

        # Prove the actual adapter wiring (tree_fit_fn/tree_score_fn, what
        # mlb_model_candidates.py registers) also works end to end — just
        # once, reusing catboost's spec, not re-paying the full live cost
        # for all three again.
        catboost_spec = TREE_MODEL_SPECS[0]
        fit_output = await tree_fit_fn(client, catboost_spec.trainer, [2023])
        check_true("tree_fit_fn adapter produces a plausible train_games count", 2000 <= fit_output.train_games <= 2500)
        adapter_predictions = await tree_score_fn(client, fit_output.model, 2022)
        check_true("tree_score_fn adapter produces predictions", len(adapter_predictions) > 0)


async def main() -> bool:
    test_serialize_roundtrip_synthetic()
    await test_live_fit_each_library_shared_data()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
