"""Standalone verification for predict/staking.py. Kelly math checked
against hand-computed values (no DB), bootstrap significance checked
against synthetic all-win vs. breakeven-coinflip samples with a seeded
RNG, then one real DB round-trip through game_picks/attach_moneyline_price/
attach_moneyline_kelly_stake using an obviously-fake sport, cleaned up
after. Same convention as test_game_pick_lock.py.
"""
import asyncio
import random
import sys

sys.path.insert(0, "src")

import db
from predict.staking import bootstrap_roi_ci, cap_exposure, kelly_fraction, min_edge_gate

TEST_SPORT = "test-staking-harness-do-not-use"
TEST_GAME_ID = "test-staking-game-1"

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


def test_kelly_fraction() -> None:
    # decimal_odds=2.0 (even money, +100), prob=0.6: full kelly = (0.6*1 - 0.4)/1 = 0.2, quarter = 0.05
    check_close("kelly_fraction, clear edge", kelly_fraction(0.6, 2.0, fraction=0.25), 0.05)

    # No edge at all (prob exactly matches implied prob for these odds: 1/2.0=0.5) -> 0
    check_close("kelly_fraction, no edge", kelly_fraction(0.5, 2.0, fraction=0.25), 0.0)

    # Negative edge (prob below implied) must clamp to exactly 0, never negative.
    check_close("kelly_fraction, negative edge clamps to 0", kelly_fraction(0.3, 2.0, fraction=0.25), 0.0)

    try:
        kelly_fraction(0.5, 1.0)
        check_true("kelly_fraction rejects decimal_odds<=1", False)
    except ValueError:
        check_true("kelly_fraction rejects decimal_odds<=1", True)


def test_cap_exposure() -> None:
    check_close("cap_exposure under cap passes through", cap_exposure(0.03, max_fraction=0.05), 0.03)
    check_close("cap_exposure over cap clamps", cap_exposure(0.20, max_fraction=0.05), 0.05)
    check_close("cap_exposure negative clamps to 0", cap_exposure(-0.1, max_fraction=0.05), 0.0)


def test_min_edge_gate() -> None:
    # decimal_odds=2.0 -> implied_prob=0.5. prob=0.55 -> edge=0.05 >= 0.02 -> True.
    check_true("min_edge_gate true for real edge", min_edge_gate(0.55, 2.0, min_edge=0.02))
    # prob=0.51 -> edge=0.01 < 0.02 -> False.
    check_true("min_edge_gate false for thin edge", not min_edge_gate(0.51, 2.0, min_edge=0.02))


def test_bootstrap_roi_ci() -> None:
    rng = random.Random(42)
    all_winning = [(0.05, 2.0, True) for _ in range(50)]
    result = bootstrap_roi_ci(all_winning, iterations=1000, rng=rng)
    check_close("all-winning picks: real ROI", result.roi, 1.0)
    check_true("all-winning picks: CI excludes 0 (significant)", result.significant)
    check_true("all-winning picks: ci_lower > 0", result.ci_lower > 0)

    rng2 = random.Random(7)
    coin_flip = [(0.05, 2.0, (i % 2 == 0)) for i in range(50)]
    result2 = bootstrap_roi_ci(coin_flip, iterations=1000, rng=rng2)
    check_close("breakeven picks: real ROI near 0", result2.roi, 0.0, tol=1e-6)
    check_true("breakeven picks: not flagged significant", not result2.significant)

    try:
        bootstrap_roi_ci([])
        check_true("bootstrap_roi_ci rejects empty input", False)
    except ValueError:
        check_true("bootstrap_roi_ci rejects empty input", True)


async def test_live_attach_roundtrip() -> None:
    await db.ensure_game_pick_row(
        db.GamePickIdentity(
            sport=TEST_SPORT,
            game_id=TEST_GAME_ID,
            home_team_id=None,
            away_team_id=None,
            home_team_name="Test Home",
            away_team_name="Test Away",
            matchup="Test Away @ Test Home",
            commence_time=None,
        )
    )
    await db.capture_moneyline_pick(
        db.MoneylinePickCapture(sport=TEST_SPORT, game_id=TEST_GAME_ID, slot="initial", side="home", prob=0.6, late=False)
    )
    await db.attach_moneyline_price(TEST_SPORT, TEST_GAME_ID, "initial", "home", -150)

    decimal_odds = 100 / 150 + 1  # -150 american -> decimal
    stake = cap_exposure(kelly_fraction(0.6, decimal_odds))
    significant = True  # not exercising the bootstrap here, just the write path
    await db.attach_moneyline_kelly_stake(TEST_SPORT, TEST_GAME_ID, "initial", "home", stake, significant)

    row = await db.get_game_pick(TEST_SPORT, TEST_GAME_ID)
    check_true("row exists after capture+attach", row is not None)
    check_close("ml_initial_kelly_stake_fraction persisted", row.ml_initial_kelly_stake_fraction, stake)
    check("ml_initial_edge_significant persisted", row.ml_initial_edge_significant, True)

    # Idempotency: a second attach with a different stake must NOT overwrite.
    await db.attach_moneyline_kelly_stake(TEST_SPORT, TEST_GAME_ID, "initial", "home", 0.99, False)
    row2 = await db.get_game_pick(TEST_SPORT, TEST_GAME_ID)
    check_close("second attach does not overwrite (idempotent)", row2.ml_initial_kelly_stake_fraction, stake)


async def cleanup() -> None:
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM game_picks WHERE sport = $1", TEST_SPORT)
    print(f"\ncleanup: {result}")


async def main() -> bool:
    test_kelly_fraction()
    test_cap_exposure()
    test_min_edge_gate()
    test_bootstrap_roi_ci()
    try:
        await test_live_attach_roundtrip()
    finally:
        await cleanup()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
