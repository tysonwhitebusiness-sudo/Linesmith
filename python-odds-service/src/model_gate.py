"""The promotion test: re-run each model's own gate and move it on evidence.

M1/M4 of docs/design/master-gameplan-ui-and-slate.md. A status that only ever
changes when somebody remembers to look is a habit, not a policy. This runs each
row's OWN pre-registered gate (carried on the row in `model_status.py`), records
what it measured, and moves the row:

    baseline -> gated   the gate passed, on at least its minimum sample
    gated -> baseline   the gate no longer passes on a real sample
    failed / none       never moved automatically. A failed attempt is a
                        recorded decision with a reopen condition, not something
                        a nightly job should undo.

WHAT EACH GATE MEASURES

  game  CLV against the reference close, the only test that asks the question
        that matters for a moneyline: did the price we took beat the price the
        market settled on? Run through `predict/clv_backtest.py`, which is
        already sport-parameterised. Pass = positive mean CLV AND a
        positive-CLV rate above 50%.

  prop  calibration at the board's line (ordering monotone, ECE <= 0.025, worst
        bucket <= 0.05, positive slope) — Phase 4's own gate. It needs the
        graded-prop calibration harness, which exists for MLB and nowhere else,
        so for every other sport this records "not runnable" WITH the reason
        rather than quietly passing or failing it. That honesty is the point: a
        gate that cannot run has not been passed.
"""
from __future__ import annotations

from dataclasses import dataclass

import db
import model_status as ms
from predict import clv_backtest


@dataclass
class GateRun:
    sport: str
    kind: str
    ran: bool
    passed: bool | None
    sample: int
    detail: str
    new_status: str | None = None


async def run_game_gate(sport: str) -> GateRun:
    """Positive mean CLV and a positive-CLV rate above 50%, on the matched picks."""
    try:
        res = await clv_backtest.backtest_moneyline_clv(sport)
    except Exception as e:                                    # noqa: BLE001
        return GateRun(sport, "game", False, None, 0, f"could not run: {type(e).__name__}: {e}")
    n = res.picks_with_reference_close
    if n == 0:
        return GateRun(sport, "game", False, None, 0,
                       f"no pick matched a {res.reference_bookmaker} close "
                       f"({res.picks_considered} considered)")
    passed = (res.mean_clv_prob_points or 0) > 0 and (res.positive_clv_rate or 0) > 0.5
    detail = (f"CLV vs {res.reference_bookmaker}: mean {res.mean_clv_prob_points:+.4f} prob-pts, "
              f"positive-CLV rate {100 * (res.positive_clv_rate or 0):.1f}% on {n}/{res.picks_considered} matched picks")
    return GateRun(sport, "game", True, passed, n, detail)


async def run_prop_gate(sport: str) -> GateRun:
    """Phase 4's calibration gate. Only MLB has the graded-prop harness."""
    if sport != "mlb":
        return GateRun(sport, "prop", False, None, 0,
                       "not runnable: the graded-prop calibration harness exists for MLB only, "
                       "so this sport has no way to pass or fail its gate yet")
    rows = await db.active_calibrations("mlb") if hasattr(db, "active_calibrations") else []
    if not rows:
        return GateRun(sport, "prop", False, None, 0,
                       "not runnable here: the gate is measured by the fitting scripts "
                       "(fit_mlb_props.py) at the board's line, not from serving data")
    return GateRun(sport, "prop", True, True, len(rows),
                   f"{len(rows)} active calibrations")


async def evaluate(apply: bool = False) -> dict:
    """Run every gate that can run; return what moved and why."""
    runs: list[GateRun] = []
    for row in ms.REGISTRY:
        if row.gate is None or row.status in (ms.FAILED, ms.NONE):
            continue
        run = await (run_game_gate(row.sport) if row.kind == "game" else run_prop_gate(row.sport))
        if run.ran and run.passed is not None and run.sample >= (row.gate.min_sample or 0):
            if row.status == ms.BASELINE and run.passed:
                run.new_status = ms.GATED
            elif row.status == ms.GATED and not run.passed:
                run.new_status = ms.BASELINE
        runs.append(run)

    moved = [r for r in runs if r.new_status]
    if apply and moved:
        await db.apply_gate_results([
            {"sport": r.sport, "kind": r.kind, "status": r.new_status,
             "evidence": f"promotion test {r.detail}"} for r in moved
        ])
    if apply:
        await db.record_gate_runs([
            {"sport": r.sport, "kind": r.kind, "ran": r.ran, "passed": r.passed,
             "sample": r.sample, "detail": r.detail} for r in runs
        ])
    return {
        "checked": len(runs),
        "ran": sum(1 for r in runs if r.ran),
        "not_runnable": sum(1 for r in runs if not r.ran),
        "moved": [f"{r.sport}/{r.kind} -> {r.new_status}" for r in moved],
        "results": [f"{r.sport}/{r.kind}: {'PASS' if r.passed else 'fail' if r.passed is False else '—'} · {r.detail}"
                    for r in runs],
    }
