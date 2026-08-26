"""Standalone verification for predict/calibration.py. PAVA/Platt math
checked against hand-computed values (no DB), then one real DB round-trip
through model_calibration using an obviously-fake sport, cleaned up after.
Same convention as test_game_pick_lock.py.
"""
import asyncio
import sys

sys.path.insert(0, "src")

import db
from predict.calibration import IsotonicParams, PlattParams, apply_calibration, apply_isotonic, apply_platt, fit_and_select_calibration, fit_isotonic, fit_platt
from predict.logistic_regression import PredictionRecord

TEST_SPORT = "test-calibration-harness-do-not-use"
TEST_MARKET = "moneyline"

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r}")


def check_close(label: str, actual: float, expected: float, tol: float = 1e-6) -> None:
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


def test_pava_known_violation() -> None:
    # Classic hand-verifiable case: naive per-point means [0, 1, 0, 1, 1]
    # violate monotonicity at index 1->2 (1 > 0); PAVA should pool indices
    # 1 and 2 into one block of mean 0.5, leaving the others untouched.
    raw_probs = [0.1, 0.2, 0.3, 0.4, 0.5]
    outcomes = [0.0, 1.0, 0.0, 1.0, 1.0]
    params = fit_isotonic(raw_probs, outcomes)
    check("isotonic x breakpoints", params.x, [0.1, 0.2, 0.3, 0.4, 0.5])
    expected_y = [0.0, 0.5, 0.5, 1.0, 1.0]
    for x, y, expected in zip(params.x, params.y, expected_y):
        check_close(f"isotonic y at x={x}", y, expected)


def test_calibration_monotonicity() -> None:
    raw_probs = [0.05, 0.15, 0.25, 0.35, 0.5, 0.6, 0.7, 0.85, 0.95]
    # Roughly-increasing outcome rate with real noise, not perfectly clean.
    outcomes = [0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0]

    platt = fit_platt(raw_probs, outcomes)
    isotonic = fit_isotonic(raw_probs, outcomes)

    sweep = [i / 200 for i in range(1, 200)]
    platt_vals = [apply_platt(p, platt) for p in sweep]
    isotonic_vals = [apply_isotonic(p, isotonic) for p in sweep]

    check_true("platt calibration is monotonically non-decreasing", all(platt_vals[i] <= platt_vals[i + 1] + 1e-9 for i in range(len(platt_vals) - 1)))
    check_true("isotonic calibration is monotonically non-decreasing", all(isotonic_vals[i] <= isotonic_vals[i + 1] + 1e-9 for i in range(len(isotonic_vals) - 1)))

    check_true("platt output stays in [0,1]", all(0.0 <= v <= 1.0 for v in platt_vals))
    check_true("isotonic output stays in [0,1]", all(0.0 <= v <= 1.0 for v in isotonic_vals))


def test_apply_calibration_none_passthrough() -> None:
    check_close("apply_calibration(None) is a no-op", apply_calibration(0.42, None), 0.42)


async def test_fit_and_select_live_roundtrip() -> None:
    # A clearly overconfident raw model (always predicts 0.9 or 0.1 but the
    # real rate is closer to 0.7/0.3) — calibration should genuinely help,
    # so this also exercises the activation gate on a case expected to win.
    train_records = [PredictionRecord(prob=0.9, actual=1.0 if i < 14 else 0.0) for i in range(20)] + [
        PredictionRecord(prob=0.1, actual=1.0 if i < 6 else 0.0) for i in range(20)
    ]
    holdout_records = [PredictionRecord(prob=0.9, actual=1.0 if i < 7 else 0.0) for i in range(10)] + [
        PredictionRecord(prob=0.1, actual=1.0 if i < 3 else 0.0) for i in range(10)
    ]

    summary = await fit_and_select_calibration(TEST_SPORT, TEST_MARKET, train_records, holdout_records)
    check_true("fit_and_select_calibration method is platt or isotonic", summary.method in ("platt", "isotonic"))
    check("saved_row.sport", summary.saved_row.sport, TEST_SPORT)
    check("saved_row.active matches activated", summary.saved_row.active, summary.activated)

    fetched = await db.get_active_calibration(TEST_SPORT, TEST_MARKET)
    if summary.activated:
        check_true("get_active_calibration returns the row we just wrote", fetched is not None and fetched.version == summary.saved_row.version)
    else:
        print(f"INFO: this fit did not activate (holdout_log_loss={summary.holdout_log_loss:.4f} >= baseline={summary.baseline_holdout_log_loss:.4f}) — get_active_calibration correctly returns whatever was already active, not asserted further")


async def cleanup() -> None:
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM model_calibration WHERE sport = $1", TEST_SPORT)
    print(f"\ncleanup: {result}")


async def main() -> bool:
    test_pava_known_violation()
    test_calibration_monotonicity()
    test_apply_calibration_none_passthrough()
    try:
        await test_fit_and_select_live_roundtrip()
    finally:
        await cleanup()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
