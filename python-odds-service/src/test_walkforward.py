"""Standalone verification for predict/walkforward.py — no DB, no network,
synthetic fit_fn/score_fn over an in-memory dataset. Same convention as
test_game_pick_lock.py: local check()/check_close() helpers, a
module-level failure counter, run via `python src/test_walkforward.py`.
"""
import asyncio
import math
import sys

sys.path.insert(0, "src")

from predict.logistic_regression import PredictionRecord
from predict.walkforward import FitOutput, WalkforwardResult, brier, generate_expanding_folds, log_loss, run_walkforward

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r}")


def check_close(label: str, actual: float, expected: float, tol: float = 1e-9) -> None:
    global _failures
    if abs(actual - expected) <= tol:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r} (tol {tol})")


def check_true(label: str, condition: bool) -> None:
    global _failures
    if condition:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — condition was False")


def test_generate_expanding_folds() -> None:
    seasons = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023]
    folds = generate_expanding_folds(seasons, min_train_seasons=8)
    check("fold count (14 seasons, 8 warmup -> 6 folds)", len(folds), 6)
    check("fold 0 train seasons", folds[0].train_seasons, [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017])
    check("fold 0 val season", folds[0].val_season, 2018)
    check("fold 5 train seasons", folds[5].train_seasons, [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022])
    check("fold 5 val season", folds[5].val_season, 2023)

    try:
        generate_expanding_folds([2010, 2011], min_train_seasons=8)
        check_true("too-few-seasons raises ValueError", False)
    except ValueError:
        check_true("too-few-seasons raises ValueError", True)


def test_log_loss_and_brier() -> None:
    # 3-row synthetic set, hand-computed.
    preds = [
        PredictionRecord(prob=0.8, actual=1),
        PredictionRecord(prob=0.3, actual=0),
        PredictionRecord(prob=0.6, actual=1),
    ]
    expected_log_loss = -(math.log(0.8) + math.log(0.7) + math.log(0.6)) / 3
    check_close("log_loss hand-computed", log_loss(preds), expected_log_loss)

    expected_brier = ((0.8 - 1) ** 2 + (0.3 - 0) ** 2 + (0.6 - 1) ** 2) / 3
    check_close("brier hand-computed", brier(preds), expected_brier)

    # Clamping: a perfectly-wrong, fully-confident prediction must not
    # produce inf/NaN.
    extreme = [PredictionRecord(prob=1.0, actual=0.0)]
    result = log_loss(extreme)
    check_true("log_loss clamps extreme prob (finite)", math.isfinite(result))


async def test_run_walkforward_no_leakage_and_scoring() -> None:
    seen_train_seasons: list[list[int]] = []
    # A "model" here is just the fitted mean of y over the training rows —
    # trivial but enough to verify plumbing without any real ML.
    true_rate_by_season = {s: (0.5 + 0.02 * (s - 2010)) for s in range(2010, 2026)}

    async def fit_fn(train_seasons: list[int]) -> FitOutput[float]:
        seen_train_seasons.append(train_seasons)
        # "Fit" = average true rate across the training seasons (deterministic, no randomness).
        mean_rate = sum(true_rate_by_season[s] for s in train_seasons) / len(train_seasons)
        return FitOutput(model=mean_rate, train_games=len(train_seasons) * 100)

    async def score_fn(model: float, season: int) -> list[PredictionRecord]:
        rate = true_rate_by_season[season]
        # 10 synthetic games for this season, all sharing the fitted rate as
        # the prediction and the season's true rate as a proxy "outcome"
        # (rounded to produce a mix of 0/1 rather than a constant).
        return [PredictionRecord(prob=model, actual=1.0 if i < round(rate * 10) else 0.0) for i in range(10)]

    train_pool = list(range(2010, 2024))  # 2010..2023
    test_seasons = [2024, 2025]

    result = await run_walkforward(train_pool, test_seasons, min_train_seasons=8, fit_fn=fit_fn, score_fn=score_fn)

    check_true("result is WalkforwardResult", isinstance(result, WalkforwardResult))
    check("fold count", len(result.folds), 6)

    all_train_seasons_seen = [s for call in seen_train_seasons for s in call]
    check_true("fit_fn never saw a test_seasons value", not (set(all_train_seasons_seen) & set(test_seasons)))

    check("final_train_seasons is the full pool", result.final_train_seasons, train_pool)
    check("final_test_games (2 seasons x 10 games)", result.final_test_games, 20)
    check_true("final_test_log_loss is finite", math.isfinite(result.final_test_log_loss))
    check_true("mean_log_loss is finite", math.isfinite(result.mean_log_loss))

    # Overlap guard.
    try:
        await run_walkforward([2010, 2011, 2012, 2024], [2024, 2025], min_train_seasons=1, fit_fn=fit_fn, score_fn=score_fn)
        check_true("overlapping test_seasons raises ValueError", False)
    except ValueError:
        check_true("overlapping test_seasons raises ValueError", True)


async def test_score_fn_empty_raises() -> None:
    async def fit_fn(train_seasons: list[int]) -> FitOutput[None]:
        return FitOutput(model=None, train_games=1)

    async def score_fn(model: None, season: int) -> list[PredictionRecord]:
        return []

    try:
        await run_walkforward([2010, 2011, 2012], [2013], min_train_seasons=1, fit_fn=fit_fn, score_fn=score_fn)
        check_true("empty score_fn output raises ValueError", False)
    except ValueError:
        check_true("empty score_fn output raises ValueError", True)


async def main() -> bool:
    test_generate_expanding_folds()
    test_log_loss_and_brier()
    await test_run_walkforward_no_leakage_and_scoring()
    await test_score_fn_empty_raises()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
