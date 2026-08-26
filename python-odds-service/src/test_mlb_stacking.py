"""Standalone verification for predict/mlb_stacking.py. Monkeypatches
predict.model_fit.build_training_set with a synthetic, deterministic,
in-memory substitute — exercises the REAL stacking_fit_fn/stacking_score_fn
code path (they call model_fit.build_training_set by name, so patching the
module attribute redirects them) without paying the real MLB API + 300-
iteration-per-game sim cost this session already measured at ~13 real
minutes per season (the real ensemble gets exercised for real anyway
during the full CLI benchmark run in run_walkforward.py — this test proves
the out-of-fold DISCIPLINE, not live-data correctness). Same convention as
test_game_pick_lock.py.
"""
import asyncio
import random
import sys

sys.path.insert(0, "src")

from predict import model_fit
from predict.mlb_stacking import stacking_fit_fn, stacking_score_fn

_failures = 0


def check_true(label: str, condition: bool) -> None:
    global _failures
    if condition:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — condition was False")


def check_close(label: str, actual: float, expected: float, tol: float = 1e-9) -> None:
    global _failures
    if abs(actual - expected) <= tol:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r} (tol {tol})")


_seen_season_requests: list[tuple[int, ...]] = []


async def _fake_build_training_set(client, seasons: list[int]) -> model_fit.TrainingSetResult:
    _seen_season_requests.append(tuple(seasons))
    rng = random.Random(sum(seasons) * 1000 + len(seasons))
    rows = []
    # 40 synthetic games per season requested, real 7-feature shape.
    for season in seasons:
        for i in range(40):
            features = [rng.random() for _ in range(7)]
            actual = 1 if sum(features) > 3.5 else 0
            rows.append(model_fit.TrainingRow(features=features, actual=actual, date=f"{season}-06-{(i % 28) + 1:02d}", season=season, baseline_prob=0.5))
    return model_fit.TrainingSetResult(
        moneyline_rows=rows,
        market_coverage=model_fit.MarketCoverage(),
        total_rows=[],
        total_market_coverage=model_fit.MarketCoverage(),
        total_line_coverage=model_fit.LineCoverage(),
        line_movement_coverage=model_fit.MarketCoverage(),
        bullpen_coverage=model_fit.MarketCoverage(),
    )


async def test_out_of_fold_discipline_and_wiring() -> None:
    model_fit.build_training_set = _fake_build_training_set  # monkeypatch the module attribute stacking_fit_fn/score_fn call by name

    _seen_season_requests.clear()
    train_seasons = [2019, 2020, 2021, 2022]  # inner_val = 2022, inner_train = [2019,2020,2021]
    fit_output = await stacking_fit_fn(None, train_seasons)

    # Confirm the OOF split actually happened: the inner-train request
    # ([2019,2020,2021]) and the inner-val request ([2022]) are BOTH
    # present as SEPARATE calls, and neither equals the full train_seasons
    # request used afterward for the final base models — proves the
    # meta-model's training features came from a season the OOF base
    # models never trained on, not from a model scored on its own
    # training rows.
    check_true("inner-train request seen ([2019,2020,2021])", (2019, 2020, 2021) in _seen_season_requests)
    check_true("inner-val request seen ([2022], separate from inner-train)", (2022,) in _seen_season_requests)
    check_true("full-train_seasons request seen for final base models ([2019,2020,2021,2022])", (2019, 2020, 2021, 2022) in _seen_season_requests)
    check_true("model has 4 base models", len(fit_output.model.base_models) == 4)
    check_true("model has meta weights matching the 4 base models", len(fit_output.model.meta_weights) == 4)

    _seen_season_requests.clear()
    predictions = await stacking_score_fn(None, fit_output.model, 2023)
    check_true("score_fn requested the val season", (2023,) in _seen_season_requests)
    check_true("score_fn returned predictions", len(predictions) == 40)
    check_true("all scored probabilities in [0,1]", all(0.0 <= p.prob <= 1.0 for p in predictions))

    # Too-short train_seasons must be rejected — an inner OOF split needs
    # at least 2 seasons (one to train the base models on, one to score
    # them out-of-fold for the meta-fit).
    try:
        await stacking_fit_fn(None, [2023])
        check_true("stacking_fit_fn rejects a single-season train_seasons", False)
    except ValueError:
        check_true("stacking_fit_fn rejects a single-season train_seasons", True)


async def main() -> bool:
    original = model_fit.build_training_set
    try:
        await test_out_of_fold_discipline_and_wiring()
    finally:
        model_fit.build_training_set = original
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
