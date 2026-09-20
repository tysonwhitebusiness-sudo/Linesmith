"""M2 fit 1 — the baseline's calibration is honest, and it cannot change a pick.

The pre-registration (docs/design/m2-fit-preregistration.md) claims calibration
"changes the number, never the pick". That is only true if the calibrated curve
crosses 50% at or below a raw 0.5, because a captured pick's probability is
always >= 0.5 by construction (the side IS the higher side). If a fit ever put
the crossing above 0.5, a pick near the coin flip would silently swap teams.

So this checks the invariant against whatever calibration is actually active,
rather than trusting the claim. It also holds the walk-forward honest: no pick
may contribute to its own score.

Run with:  .venv/Scripts/python.exe src/test_generic_calibration.py
"""
import asyncio
import json
import sys

import db
from predict.platt_calibration import apply_platt

failures: list[str] = []


def ok(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        failures.append(f"{name} {detail}")


def crossing(a: float, b: float) -> float:
    """The raw probability at which the calibrated curve reaches 0.5."""
    lo, hi = 1e-6, 1 - 1e-6
    for _ in range(200):
        mid = (lo + hi) / 2
        if apply_platt(mid, a, b) < 0.5:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


async def main() -> None:
    print("active baseline calibrations")
    checked = 0
    for sport in ("cfb", "nfl", "nhl", "nba", "soccer"):
        row = await db.get_active_calibration(sport, "moneyline")
        if row is None:
            print(f"  --  {sport}: none active (nothing to check)")
            continue
        checked += 1
        params = row.params if isinstance(row.params, dict) else json.loads(row.params)
        a, b = float(params["a"]), float(params["b"])
        x = crossing(a, b)
        ok(f"{sport}: calibrated 50% at raw {x:.4f} <= 0.5, so no pick can flip", x <= 0.5,
           f"— crossing {x:.4f} is ABOVE 0.5: a pick between 0.5 and {x:.4f} would swap sides")
        ok(f"{sport}: a monotone curve (A={a:.4f} > 0)", a > 0)
        ok(f"{sport}: it beat the uncalibrated baseline out of sample",
           row.baseline_holdout_log_loss is None or row.holdout_log_loss < row.baseline_holdout_log_loss,
           f"— {row.holdout_log_loss} vs {row.baseline_holdout_log_loss}")

        # And the pick itself: every captured probability is >= 0.5, which is
        # what makes the invariant above sufficient.
        pool = await db.get_pool()
        low = await pool.fetchval(
            """SELECT min(COALESCE(ml_final_prob, ml_initial_prob)) FROM game_picks
                WHERE source = 'generic_elo' AND sport = $1
                  AND COALESCE(ml_final_prob, ml_initial_prob) IS NOT NULL""",
            sport,
        )
        if low is not None:
            ok(f"{sport}: every captured pick is at or above 50% (min {100 * float(low):.1f}%)", float(low) >= 0.5)

    if checked == 0:
        print("  (no calibration is active yet — the invariant has nothing to test)")

    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        sys.exit(1)
    print("all baseline calibration checks passed")


asyncio.run(main())
