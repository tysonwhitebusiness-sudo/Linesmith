"""M2, fit 1 — calibrate the generic Elo baseline's moneyline probability.

Runs exactly the method pre-registered in docs/design/m2-fit-preregistration.md,
which was committed before this file existed:

    data       game_picks where source='generic_elo' and ml_outcome in (win,loss)
    method     walk-forward by commence_time; each pick is predicted by a Platt
               fit over EVERY EARLIER graded pick, so no pick contributes to its
               own score; the first 50 are used for fitting only, never scored
    minimum    200 graded picks for the sport
    PASS       mean log loss improves by >= 0.002 AND ECE is not worse
    on PASS    write an active model_calibration row (sport, 'moneyline')
    on FAIL    persist nothing; the raw probability keeps serving

This changes the NUMBER, never the pick: Platt scaling is monotone, so the side
with the higher probability is the same side afterwards. It does not promote
anything either — the register's gate is CLV, measured by modelGateJob.

    .venv/Scripts/python.exe fit_generic_calibration.py            # report only
    .venv/Scripts/python.exe fit_generic_calibration.py --apply    # + persist a PASS
    .venv/Scripts/python.exe fit_generic_calibration.py --sport cfb
"""
from __future__ import annotations

import argparse
import asyncio
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                    # noqa: E402
from predict.logistic_regression import fit_logistic_regression   # noqa: E402
from predict.platt_calibration import _logit, apply_platt         # noqa: E402


def fit_platt(pairs: list[tuple[float, int]]) -> tuple[float, float]:
    """Platt is a logistic regression on the model's own log-odds — the same
    one `predict/platt_calibration.fit_for` runs for prop markets. Reused rather
    than re-derived so a calibration means the same thing everywhere."""
    fit = fit_logistic_regression([[_logit(p)] for p, _ in pairs], [float(y) for _, y in pairs])
    return fit.weights[0], fit.intercept

MIN_SAMPLE = 200          # pre-registered
MIN_FIT_ROWS = 50         # pre-registered: nothing is scored on fewer than this
LOGLOSS_GAIN = 0.002      # pre-registered
BINS = 10


def _clip(p: float) -> float:
    return min(1 - 1e-6, max(1e-6, p))


def log_loss(pairs: list[tuple[float, int]]) -> float:
    return -sum(y * math.log(_clip(p)) + (1 - y) * math.log(1 - _clip(p)) for p, y in pairs) / len(pairs)


def ece(pairs: list[tuple[float, int]]) -> float:
    """Expected calibration error, 10 equal-width bins."""
    total = len(pairs)
    err = 0.0
    for b in range(BINS):
        lo, hi = b / BINS, (b + 1) / BINS
        bucket = [(p, y) for p, y in pairs if (p >= lo and p < hi) or (b == BINS - 1 and p == 1.0)]
        if not bucket:
            continue
        conf = sum(p for p, _ in bucket) / len(bucket)
        acc = sum(y for _, y in bucket) / len(bucket)
        err += (len(bucket) / total) * abs(conf - acc)
    return err


async def load(sport: str) -> list[tuple[str, float, int]]:
    """(commence_time, captured probability, won) for every graded pick."""
    pool = await db.get_pool()
    rows = await pool.fetch(
        """
        SELECT commence_time,
               COALESCE(ml_final_prob, ml_initial_prob) AS prob,
               ml_outcome
          FROM game_picks
         WHERE source = 'generic_elo' AND sport = $1
           AND ml_outcome IN ('win', 'loss')
           AND COALESCE(ml_final_prob, ml_initial_prob) IS NOT NULL
         ORDER BY commence_time
        """,
        sport,
    )
    return [(str(r["commence_time"]), float(r["prob"]), 1 if r["ml_outcome"] == "win" else 0) for r in rows]


def walk_forward(data: list[tuple[str, float, int]]) -> tuple[list[tuple[float, int]], list[tuple[float, int]]]:
    """Returns (raw scored pairs, calibrated scored pairs) — out of sample."""
    raw: list[tuple[float, int]] = []
    cal: list[tuple[float, int]] = []
    for i in range(MIN_FIT_ROWS, len(data)):
        history = data[:i]
        p, y = data[i][1], data[i][2]
        a, b = fit_platt([(h[1], h[2]) for h in history])
        raw.append((p, y))
        cal.append((apply_platt(p, a, b), y))
    return raw, cal


async def main(sports: list[str], apply: bool) -> int:
    print(f"\n{'=' * 78}\nM2 fit 1 — calibration of the generic Elo baseline\n{'=' * 78}")
    print(f"  pre-registered: min {MIN_SAMPLE} graded picks, walk-forward, PASS needs")
    print(f"  log-loss gain >= {LOGLOSS_GAIN} and ECE no worse.\n")
    any_pass = False
    for sport in sports:
        data = await load(sport)
        print(f"  {sport}: {len(data)} graded moneyline picks")
        if len(data) < MIN_SAMPLE:
            print(f"      SKIP — under the pre-registered minimum of {MIN_SAMPLE}\n")
            continue
        raw, cal = walk_forward(data)
        raw_ll, cal_ll = log_loss(raw), log_loss(cal)
        raw_ece, cal_ece = ece(raw), ece(cal)
        gain = raw_ll - cal_ll
        hit = sum(y for _, y in raw) / len(raw)
        mean_p = sum(p for p, _ in raw) / len(raw)
        passed = gain >= LOGLOSS_GAIN and cal_ece <= raw_ece
        print(f"      scored {len(raw)} out of sample (first {MIN_FIT_ROWS} used for fitting only)")
        print(f"      the model says {100 * mean_p:.1f}% on average; those picks won {100 * hit:.1f}%")
        print(f"      log loss   raw {raw_ll:.5f}  ->  calibrated {cal_ll:.5f}   (gain {gain:+.5f})")
        print(f"      ECE        raw {raw_ece:.5f}  ->  calibrated {cal_ece:.5f}")
        print(f"      verdict    {'PASS' if passed else 'FAIL'} — {'persist' if passed else 'keep the raw probability'}")
        if passed:
            any_pass = True
            if apply:
                a, b = fit_platt([(p, y) for _, p, y in data])
                await db.write_calibration(
                    db.CalibrationInput(
                        sport=sport, market="moneyline", method="platt",
                        params={"a": a, "b": b, "method_note": "walk-forward scored, M2 fit 1"},
                        train_games=len(data), train_log_loss=cal_ll,
                        holdout_games=len(raw), holdout_log_loss=cal_ll,
                        baseline_holdout_log_loss=raw_ll,
                    ),
                    activate=True,
                )
                print(f"      written to model_calibration (active): A={a:.4f} B={b:.4f}")
        print()
    if not apply:
        print("  REPORT ONLY. Nothing written. Re-run with --apply to persist a PASS.\n")
    return 0 if not any_pass or apply else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sport", action="append", dest="sports")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.sports or ["cfb", "nfl", "nhl", "soccer"], a.apply)))
