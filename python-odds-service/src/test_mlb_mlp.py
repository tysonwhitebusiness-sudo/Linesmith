"""Standalone verification for predict/mlb_mlp.py. Serialize/deserialize
round-trip on synthetic features (no network), then one real fit+score
against real season data via the actual mlp_fit_fn/mlp_score_fn adapters.
Same convention as test_game_pick_lock.py.
"""
import asyncio
import sys

import httpx

sys.path.insert(0, "src")

from predict.mlb_mlp import deserialize_mlp, fit_mlp, mlp_fit_fn, mlp_score_fn, serialize_mlp

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

    rng = random.Random(2)
    x = [[rng.random() for _ in range(7)] for _ in range(200)]
    y = [1.0 if sum(row) > 3.5 else 0.0 for row in x]

    model = fit_mlp(x, y)
    before = model.predict_proba(x[:10])
    blob = serialize_mlp(model)
    restored = deserialize_mlp(blob)
    after = restored.predict_proba(x[:10])
    check_true("mlp: serialize/deserialize round-trip matches", all(abs(b[1] - a[1]) < 1e-9 for b, a in zip(before, after)))


async def test_live_fit_and_score() -> None:
    async with httpx.AsyncClient() as client:
        print("building real training set for 2023 (real per-team stats + sim engine, may take a while)...")
        fit_output = await mlp_fit_fn(client, [2023])
        check_true(f"mlp: live fit against 2023 produced a plausible game count ({fit_output.train_games})", 2000 <= fit_output.train_games <= 2500)

        print("building real scoring set for 2022...")
        predictions = await mlp_score_fn(client, fit_output.model, 2022)
        check_true(f"mlp: live score against 2022 returned predictions ({len(predictions)})", len(predictions) > 0)
        check_true("mlp: all scored probabilities in [0,1]", all(0.0 <= p.prob <= 1.0 for p in predictions))


async def main() -> bool:
    test_serialize_roundtrip_synthetic()
    await test_live_fit_and_score()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
