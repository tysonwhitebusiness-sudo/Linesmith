"""Standalone verification for predict/model_benchmark.py — two trivial
synthetic candidates (one deterministically better) run through
run_benchmark against an obviously-fake sport, confirming correct ranking
and real walkforward_results rows, cleaned up after. Same convention as
test_game_pick_lock.py.
"""
import asyncio
import sys

sys.path.insert(0, "src")

import db
from predict.logistic_regression import PredictionRecord
from predict.model_benchmark import ModelCandidate, run_benchmark
from predict.walkforward import FitOutput

TEST_SPORT = "test-model-benchmark-harness-do-not-use"
TEST_MARKET = "moneyline"

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r}")


def check_true(label: str, condition: bool) -> None:
    global _failures
    if condition:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — condition was False")


# True outcome rate per synthetic season — deterministic, no randomness.
_TRUE_RATE = {s: (0.5 + 0.02 * (s - 2010)) for s in range(2010, 2026)}


def _synthetic_games(season: int) -> list[float]:
    """10 synthetic outcomes for a season, mixing 0/1 to match _TRUE_RATE."""
    rate = _TRUE_RATE[season]
    n_ones = round(rate * 10)
    return [1.0] * n_ones + [0.0] * (10 - n_ones)


async def _good_fit_fn(train_seasons: list[int]) -> FitOutput[float]:
    # "Fits" by computing the real mean rate across training seasons — an
    # accurate model.
    mean_rate = sum(_TRUE_RATE[s] for s in train_seasons) / len(train_seasons)
    return FitOutput(model=mean_rate, train_games=len(train_seasons) * 10)


async def _good_score_fn(model: float, season: int) -> list[PredictionRecord]:
    outcomes = _synthetic_games(season)
    return [PredictionRecord(prob=model, actual=o) for o in outcomes]


async def _bad_fit_fn(train_seasons: list[int]) -> FitOutput[float]:
    # Deliberately, confidently wrong — always predicts 0.5 regardless of
    # the real rate having drifted well away from 0.5 by the test seasons.
    return FitOutput(model=0.5, train_games=len(train_seasons) * 10)


async def _bad_score_fn(model: float, season: int) -> list[PredictionRecord]:
    outcomes = _synthetic_games(season)
    return [PredictionRecord(prob=model, actual=o) for o in outcomes]


async def test_ranking_and_persistence() -> None:
    candidates = [
        ModelCandidate(name="bad-constant", fit_fn=_bad_fit_fn, score_fn=_bad_score_fn),
        ModelCandidate(name="good-fitted", fit_fn=_good_fit_fn, score_fn=_good_score_fn),
    ]
    train_pool = list(range(2010, 2024))  # 2010..2023
    test_seasons = [2024, 2025]  # rates 0.78/0.80 — far from 0.5, "good-fitted" should win clearly

    results = await run_benchmark(TEST_SPORT, TEST_MARKET, candidates, train_pool, test_seasons, min_train_seasons=8)

    check("2 candidates ranked", len(results), 2)
    check("best candidate is good-fitted", results[0].name, "good-fitted")
    check_true("good-fitted final_test_log_loss < bad-constant's", results[0].walkforward.final_test_log_loss < results[1].walkforward.final_test_log_loss)

    pool = await db.get_pool()
    rows = await pool.fetch("SELECT model_name, fold_index, is_final_test FROM walkforward_results WHERE sport = $1 AND market = $2 ORDER BY model_name, is_final_test, fold_index", TEST_SPORT, TEST_MARKET)
    names = {r["model_name"] for r in rows}
    check("both candidates wrote rows", names, {"bad-constant", "good-fitted"})

    per_model_final = [r for r in rows if r["is_final_test"]]
    check("2 final-test rows (one per candidate)", len(per_model_final), 2)
    per_model_folds = [r for r in rows if not r["is_final_test"]]
    check("6 CV-fold rows per candidate x 2 candidates", len(per_model_folds), 12)


async def cleanup() -> None:
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM walkforward_results WHERE sport = $1", TEST_SPORT)
    print(f"\ncleanup: {result}")


async def main() -> bool:
    try:
        await test_ranking_and_persistence()
    finally:
        await cleanup()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
