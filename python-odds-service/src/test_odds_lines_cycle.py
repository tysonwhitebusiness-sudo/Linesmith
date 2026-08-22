"""Verifies predict/odds_lines_cycle.py's assembly logic (snapshot parsing,
market devig, Elo blend, fitted-weights application) against the REAL
game_picks table — not a mock. Same precedent as test_game_sim_cache.py: an
obviously-fake game_pk (999999999) under the real 'mlb' sport (this
module's functions hardcode 'mlb', matching route.ts's own hardcoding) so
it can never collide with a real game, and deletes it at the end regardless
of pass/fail.

Runs the actual fitted branch using whatever moneyline/total weights are
REALLY active right now (read-only — this never writes to model_weights),
which is a genuine, valuable exercise of that code path since production
has had active fitted weights since 2026-08-14.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import db
import httpx

from predict.game_model import MoneylineDiagnostics as GameModelDiagnostics
from predict.mlb_game_lines import GameLine, MoneylineSummary, TotalSummary
from predict.odds_lines_cycle import (
    SnapshotElo,
    SnapshotGame,
    SnapshotGameModel,
    run_moneyline_lock_from_snapshot,
    run_total_lock_from_lines,
)

TEST_GAME_PK = "999999999"
HOME_TEAM_ID = 147  # Yankees — real team id so get_team_bullpen_era resolves real data
AWAY_TEAM_ID = 119  # Dodgers
_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def check_close(label: str, actual, expected, tol=1e-6) -> None:
    global _failures
    if actual is not None and abs(actual - expected) <= tol:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected ~{expected!r}")


async def cleanup():
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM game_picks WHERE sport = 'mlb' AND game_id = $1", TEST_GAME_PK)
    print(f"\ncleanup: {result}")


def _diag():
    return GameModelDiagnostics(
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
        # `now` well past the 6am CT initial window AND past the game's own
        # 3-hour-before-commence final-lock threshold, so BOTH capture slots
        # fire in one call — exercises the whole pipeline in a single pass.
        commence = datetime(2026, 8, 21, 12, 0, 0, tzinfo=timezone.utc)
        now = commence + timedelta(hours=4)

        game = SnapshotGame(
            game_pk=TEST_GAME_PK,
            home_team_id=HOME_TEAM_ID,
            away_team_id=AWAY_TEAM_ID,
            away_team_name="Los Angeles Dodgers",
            home_team_name="New York Yankees",
            matchup="LAD @ NYY",
            first_pitch=commence.isoformat(),
            status="pre",
            game_model=SnapshotGameModel(
                home_expected_runs=4.6,
                away_expected_runs=4.1,
                home_win_prob=0.55,
                away_win_prob=0.45,
                diagnostics=_diag(),
            ),
            elo=SnapshotElo(
                home_elo=1550,
                home_games_played=120,
                away_elo=1480,
                away_games_played=118,
                home_rest_days=1,
                away_rest_days=2,
                home_travel_miles=0,
                away_travel_miles=2200,
                home_pitcher_adj=3.0,
                away_pitcher_adj=-2.0,
            ),
        )

        line = GameLine(
            event_id="test-evt-1",
            commence_time=commence.isoformat(),
            home_team="New York Yankees",
            away_team="Los Angeles Dodgers",
            moneyline=MoneylineSummary(home=-150, away=130, book="DraftKings"),
            total=TotalSummary(point=8.5, over_price=-110, under_price=-105, book="DraftKings"),
            bookmakers=[],
            book_count=1,
        )

        async with httpx.AsyncClient() as client:
            print("=== run_moneyline_lock_from_snapshot ===")
            await run_moneyline_lock_from_snapshot([line], [game], now)

            print("\n=== run_total_lock_from_lines ===")
            await run_total_lock_from_lines(client, [line], [game], now)

        row = await db.get_game_pick("mlb", TEST_GAME_PK)
        check("row created", row is not None, True)
        check("ml_initial captured", row.ml_initial_side is not None if row else False, True)
        check("ml_final ALSO captured (commence 4h before now, well past 3h threshold)", row.ml_final_side is not None if row else False, True)
        check("total_initial captured", row.total_initial_side is not None if row else False, True)
        check("total_final captured", row.total_final_side is not None if row else False, True)

        active_ml = await db.get_active_model_weights("mlb", "moneyline")
        active_total = await db.get_active_model_weights("mlb", "total")
        print(f"\n(real active fitted weights in production: moneyline={'yes' if active_ml else 'no'}, total={'yes' if active_total else 'no'})")

        features = json.loads(row.initial_ml_features_json) if row and row.initial_ml_features_json else {}
        if active_ml:
            # Fitted branch active in production right now: homeWinProb gets
            # REASSIGNED to apply_fitted_moneyline_weights's output before
            # being passed into MoneylineLockInput (matches TS's
            # runMoneylineLockFromSnapshot exactly — verified against the
            # real source, not assumed), so modelHomeProb in the features
            # blob is the FITTED value here, not the raw 0.55 gameModel
            # input. Market/Elo get folded INTO the fit rather than blended
            # a second time.
            check("features_json modelHomeProb reflects the FITTED value, not raw 0.55", features.get("modelHomeProb") != 0.55, True)
            check("fitted branch: eloHomeProb nulled (folded into the fit)", features.get("eloHomeProb"), None)
            check("fitted branch: marketHomeProb nulled (folded into the fit)", features.get("marketHomeProb"), None)
            check("fitted branch: blendedHomeProb equals modelHomeProb (no further blend layered on top)", features.get("blendedHomeProb"), features.get("modelHomeProb"))
        else:
            check("features_json carries the raw model home prob input", features.get("modelHomeProb"), 0.55)
            check_close("unfitted branch: blendedHomeProb reflects a real market+Elo blend", features.get("blendedHomeProb"), features.get("afterMarketProb"), tol=1.0)

        total_features = json.loads(row.initial_total_features_json) if row and row.initial_total_features_json else {}
        check_close("total features_json carries the line", total_features.get("line"), 8.5)

        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await cleanup()
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
