"""Phase 4 gate — "The activation gate refuses a real bad model. Actually run
`fit-weights` with a deliberately weak feature set and paste the refusal. A gate
that has never rejected anything is not known to work."

This runs the REAL `fit_moneyline_weights` — the real training-set build, the
real logistic fit, the real activation decision — with the feature vector
replaced by a constant. A constant feature carries no information by
construction, so the fitted model cannot beat the baseline it is scored against,
and `activated` must come back False.

WHY A CONSTANT FEATURE RATHER THAN A SMALL SAMPLE. "Train on one season" would
also probably fail, but *probably* is not a gate: it could pass by luck and the
run would prove nothing. A constant feature makes the model provably
uninformative, so a `True` here is unambiguously a broken gate rather than an
unlucky draw.

Nothing is written: `fit_moneyline_weights` persists through
`db.write_model_weights`, which is monkeypatched to a no-op capture so this
cannot leave a junk row in `model_weights` or disturb the live active version.

Run from python-odds-service/:
    python -u ../scripts/gate/phase-4-weak-model-refused.py
"""
import asyncio
import sys

sys.path.insert(0, "src")

import httpx

import db  # noqa: E402
from predict import model_fit  # noqa: E402

TRAIN_SEASONS = [2023, 2024]
HOLDOUT_SEASONS = [2025]


async def main() -> int:
    captured = {}

    async def fake_write(model_input, activate):
        """Capture instead of persisting. Returns a row shaped enough for the
        caller, which only stores it on the summary."""
        captured["activate"] = activate
        captured["input"] = model_input
        return db.ModelWeightsRow(
            id=-1, sport=model_input.sport, market=model_input.market, version=-1,
            feature_names=list(model_input.feature_names), weights=list(model_input.weights),
            intercept=model_input.intercept, train_games=model_input.train_games,
            train_brier=model_input.train_brier, holdout_games=model_input.holdout_games,
            holdout_brier=model_input.holdout_brier,
            baseline_holdout_brier=model_input.baseline_holdout_brier,
            active=False, fitted_at="1970-01-01T00:00:00+00:00",
            covariance=None, train_seasons=None, holdout_seasons=None, shadow=True,
        )

    # The "deliberately weak feature set": every feature zeroed. The fit can
    # then learn only an intercept — i.e. the base rate — which carries no
    # game-specific information at all. Everything else stays real: the training
    # set build, the Brier computations, and the activation decision.
    real_fit = model_fit.fit_logistic_regression

    def weak_fit(x, y, *args, **kwargs):
        return real_fit([[0.0] * len(row) for row in x], y, *args, **kwargs)

    real_write = db.write_model_weights
    db.write_model_weights = fake_write
    model_fit.fit_logistic_regression = weak_fit

    try:
        print("running the REAL fit_moneyline_weights with a constant feature vector...", flush=True)
        print(f"  train seasons {TRAIN_SEASONS} | holdout {HOLDOUT_SEASONS}", flush=True)
        async with httpx.AsyncClient() as client:
            summary = await model_fit.fit_moneyline_weights(client, TRAIN_SEASONS, HOLDOUT_SEASONS)

        print()
        print(f"  train games          {summary.train_games}")
        print(f"  holdout games        {summary.holdout_games}")
        print(f"  holdout Brier        {summary.holdout_brier:.6f}")
        print(f"  baseline holdout     {summary.baseline_holdout_brier:.6f}")
        print(f"  ACTIVATED            {summary.activated}")
        print()
        ok = summary.activated is False
        print("PASS — the gate refused it" if ok else "FAIL — a weak model was ACTIVATED")
        print(f"(write_model_weights was called with activate={captured.get('activate')}; nothing persisted)")
        return 0 if ok else 1
    finally:
        db.write_model_weights = real_write
        model_fit.fit_logistic_regression = real_fit


sys.exit(asyncio.run(main()))
