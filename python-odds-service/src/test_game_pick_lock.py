"""Verifies game_pick_lock.py's capture/grade cycle against the REAL
game_picks table in Postgres — not a mock. Same precedent as
test_write_prop_odds.py: an obviously-fake sport ('test_harness_do_not_use')
and game ids so these rows can never collide with a real game, and deletes
everything it wrote at the end regardless of pass/fail.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import db
from predict.game_pick_lock import (
    FinishedGameInput,
    MoneylineDiagnostics,
    MoneylineLockInput,
    TotalLockInput,
    grade_finished_game_picks,
    run_moneyline_lock_cycle,
    run_total_lock_cycle,
)

TEST_SPORT = "test_harness_do_not_use"
GAME_A = "test-game-a"  # commence time far in the future -> initial only
GAME_B = "test-game-b"  # commence time in the past -> initial + final
GAME_C = "test-game-c"  # grading only
_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def check_close(label: str, actual, expected, tol=1e-9) -> None:
    global _failures
    if actual is not None and abs(actual - expected) <= tol:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected ~{expected!r}")


async def cleanup():
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM game_picks WHERE sport = $1", TEST_SPORT)
    print(f"\ncleanup: {result}")


def diag() -> MoneylineDiagnostics:
    return MoneylineDiagnostics(
        raw_log5_home_win_prob=0.58,
        home_venue_edge=0.02,
        away_venue_edge=-0.01,
        home_recent_edge=0.01,
        away_recent_edge=-0.02,
        raw_home_recent_edge=0.025,
        raw_away_recent_edge=-0.05,
        park_factor=1.05,
    )


async def main():
    try:
        now = datetime(2026, 8, 21, 12, 0, 0, tzinfo=timezone.utc)  # 7:00am CT — past the 6am initial window

        print("=== run_moneyline_lock_cycle: initial-only game (commence far in future) ===")
        far_future = (now + timedelta(hours=10)).isoformat()  # well beyond 3h-before threshold
        ml_games = [
            MoneylineLockInput(
                game_id=GAME_A,
                home_team_id=147,
                away_team_id=119,
                home_team_name="Yankees",
                away_team_name="Dodgers",
                matchup="LAD @ NYY",
                commence_time=far_future,
                is_pre_game=True,
                home_win_prob=0.55,
                away_win_prob=0.45,
                diagnostics=diag(),
                market_home_prob=0.60,
                elo_home_prob=0.52,
                prob_lower_home=0.48,
                prob_upper_home=0.62,
            )
        ]
        await run_moneyline_lock_cycle(TEST_SPORT, ml_games, now)
        row_a = await db.get_game_pick(TEST_SPORT, GAME_A)
        check("row A created", row_a is not None, True)
        check("ml_initial_side captured", row_a.ml_initial_side if row_a else None, "home")
        check("ml_final_side NOT captured (not yet due)", row_a.ml_final_side if row_a else "wrong", None)
        # `now` is 12:00 UTC = 7:00am CDT on this date — 40min past the 6:00am
        # window, outside the 20min grace period, so this SHOULD read late.
        check("ml_initial_late is True (7am CDT is 40min past the 6am window)", row_a.ml_initial_late if row_a else None, True)

        # Verify the blend math independently: market blends in first at
        # MARKET_BLEND_WEIGHT=0.5, then Elo nudges at ELO_BLEND_WEIGHT=0.2.
        after_market = (1 - 0.5) * 0.55 + 0.5 * 0.60  # 0.575
        blended = (1 - 0.2) * after_market + 0.2 * 0.52  # 0.564
        check_close("ml_initial_prob matches the market+Elo blend", row_a.ml_initial_prob if row_a else None, blended)
        features = json.loads(row_a.initial_ml_features_json) if row_a else {}
        check_close("features_json blendedHomeProb matches", features.get("blendedHomeProb"), blended)
        check("features_json carries raw diagnostics", features.get("rawLog5HomeWinProb"), 0.58)

        print("\n=== run_moneyline_lock_cycle: re-run -> initial slot never moves ===")
        ml_games[0].home_win_prob = 0.10  # wildly different model output
        await run_moneyline_lock_cycle(TEST_SPORT, ml_games, now)
        row_a2 = await db.get_game_pick(TEST_SPORT, GAME_A)
        check_close("ml_initial_prob UNCHANGED despite a wildly different re-run", row_a2.ml_initial_prob if row_a2 else None, blended)

        print("\n=== run_moneyline_lock_cycle: final-lock-due game (commence in the past) ===")
        near_past = (now - timedelta(hours=2)).isoformat()  # commence 2h ago -> 3h-before threshold already passed -> due
        ml_games_b = [
            MoneylineLockInput(
                game_id=GAME_B,
                home_team_id=119,
                away_team_id=147,
                home_team_name="Dodgers",
                away_team_name="Yankees",
                matchup="NYY @ LAD",
                commence_time=near_past,
                is_pre_game=True,
                home_win_prob=0.40,
                away_win_prob=0.60,
                diagnostics=diag(),
                market_home_prob=None,
                elo_home_prob=None,
                prob_lower_home=None,
                prob_upper_home=None,
            )
        ]
        await run_moneyline_lock_cycle(TEST_SPORT, ml_games_b, now)
        row_b = await db.get_game_pick(TEST_SPORT, GAME_B)
        check("ml_initial_side captured for game B", row_b.ml_initial_side if row_b else None, "away")
        check("ml_final_side ALSO captured (final lock due)", row_b.ml_final_side if row_b else None, "away")
        check("ml_final_late True (threshold passed well over 20min grace)", row_b.ml_final_late if row_b else None, True)
        check_close("no market/Elo -> prob is the raw model prob", row_b.ml_final_prob if row_b else None, 0.60)

        print("\n=== run_total_lock_cycle: total capture + blend ===")
        total_games = [
            TotalLockInput(
                game_id=GAME_A,
                home_team_id=147,
                away_team_id=119,
                home_team_name="Yankees",
                away_team_name="Dodgers",
                matchup="LAD @ NYY",
                commence_time=far_future,
                is_pre_game=True,
                line=8.5,
                over_prob=0.53,
                market_over_prob=0.47,
                prob_lower_over=None,
                prob_upper_over=None,
            )
        ]
        await run_total_lock_cycle(TEST_SPORT, total_games, now)
        row_a3 = await db.get_game_pick(TEST_SPORT, GAME_A)
        expected_total_blend = (1 - 0.5) * 0.53 + 0.5 * 0.47  # 0.5 exactly -> side stays 'over' (>=0.5)
        check("total_initial_side captured", row_a3.total_initial_side if row_a3 else None, "over")
        check_close("total_initial_prob matches blend", row_a3.total_initial_prob if row_a3 else None, expected_total_blend)
        check_close("total_initial_line stored", row_a3.total_initial_line if row_a3 else None, 8.5)

        print("\n=== grade_finished_game_picks: grades against the FINAL pick (game B) ===")
        finished = [FinishedGameInput(game_id=GAME_B, is_final=True, home_score=3, away_score=7)]
        await grade_finished_game_picks(TEST_SPORT, finished)
        row_b2 = await db.get_game_pick(TEST_SPORT, GAME_B)
        check("graded_at set", row_b2.graded_at is not None if row_b2 else False, True)
        check("ml_outcome is win (picked away, away won)", row_b2.ml_outcome if row_b2 else None, "win")

        print("\n=== grade_finished_game_picks: idempotent re-grade is a no-op ===")
        await grade_finished_game_picks(TEST_SPORT, finished)
        row_b3 = await db.get_game_pick(TEST_SPORT, GAME_B)
        check("graded_at unchanged on re-grade", row_b3.graded_at if row_b3 else None, row_b2.graded_at if row_b2 else None)

        print("\n=== grade_finished_game_picks: no row on record -> no-op, no crash ===")
        await grade_finished_game_picks(TEST_SPORT, [FinishedGameInput(game_id=GAME_C, is_final=True, home_score=2, away_score=1)])
        row_c = await db.get_game_pick(TEST_SPORT, GAME_C)
        check("no row created for a game with no prior capture", row_c, None)

        print("\n=== grade_finished_game_picks: tied game -> no-op (no outcome to grade) ===")
        # Re-use game A (only has an initial ml capture, no final) with a tied score.
        await grade_finished_game_picks(TEST_SPORT, [FinishedGameInput(game_id=GAME_A, is_final=True, home_score=4, away_score=4)])
        row_a4 = await db.get_game_pick(TEST_SPORT, GAME_A)
        check("game A still ungraded (tie has no winner)", row_a4.graded_at if row_a4 else "missing", None)

        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await cleanup()
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
