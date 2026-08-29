"""Phase 4.3 — Platt calibration corrects over-confidence without reordering.

Audit finding P3 H1: `model_calibration` and `model_artifacts` are empty, and
probabilities are systematically over-confident.

Two properties matter and both are asserted here:

  1. It must FIX over-confidence. Platt fits
     `sigmoid(A * logit(p) + B)`; A < 1 shrinks predictions toward the base
     rate, which is exactly what an over-confident model needs.

  2. It must NOT change the ranking. Platt is monotone, so it cannot. That is
     load-bearing given Q1 — prop grades may return only as RANKING — so a
     calibration that reordered anything would break the single property the
     audit found actually works.

Pure functions, no network, no database, so this runs in CI (Q20).

Run with:  python -u src/test_platt_calibration.py
"""
import sys

sys.path.insert(0, "src")

from predict.platt_calibration import (  # noqa: E402
    HOLDOUT_FRACTION,
    MIN_ROWS_FOR_CALIBRATION,
    _log_loss,
    _logit,
    _sigmoid,
    apply_platt,
)

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


def close(label: str, actual: float, expected: float, eps: float = 1e-9) -> None:
    global _failures
    ok = abs(actual - expected) < eps
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual:.8f}, want {expected:.8f})"))


def test_identity_calibration_is_a_no_op():
    print("\n4.3: A=1, B=0 leaves every probability untouched")
    for p in (0.05, 0.25, 0.5, 0.75, 0.95):
        close(f"p={p}", apply_platt(p, 1.0, 0.0), p, eps=1e-6)


def test_a_below_one_shrinks_toward_the_middle():
    """The correction over-confidence actually needs. These are the real fitted
    values from the live run: mlb/hits-runs-rbis came back A=0.3707."""
    print("\n4.3: A < 1 pulls extreme predictions toward the base rate")
    a, b = 0.3707, 0.0
    for p in (0.90, 0.80, 0.20, 0.10):
        cal = apply_platt(p, a, b)
        moved_inward = abs(cal - 0.5) < abs(p - 0.5)
        check(f"p={p} -> {cal:.4f} is less extreme", moved_inward, True)


def test_a_above_one_sharpens():
    """The opposite direction must work too, or the first test would pass for a
    function that simply returns 0.5. mlb/total-bases fitted A=1.3028."""
    print("\n4.3: A > 1 sharpens an under-confident model")
    a, b = 1.3028, 0.0
    for p in (0.80, 0.20):
        cal = apply_platt(p, a, b)
        check(f"p={p} -> {cal:.4f} is more extreme", abs(cal - 0.5) > abs(p - 0.5), True)


def test_calibration_never_reorders():
    """Q1 makes this load-bearing: prop grades may return only as RANKING, so a
    calibration that changed the order would break the one thing that works."""
    print("\n4.3: monotone — ranking is preserved exactly")
    probs = [0.05, 0.17, 0.33, 0.50, 0.62, 0.78, 0.91]
    for a, b in ((0.3707, -0.2919), (1.3028, 0.1612), (0.8890, -0.0457)):
        cal = [apply_platt(p, a, b) for p in probs]
        check(f"A={a} B={b}: order unchanged", cal, sorted(cal))
        check(f"A={a} B={b}: strictly increasing", all(x < y for x, y in zip(cal, cal[1:])), True)


def test_b_shifts_the_base_rate():
    print("\n4.3: B moves the base rate")
    check("negative B lowers a 50/50", apply_platt(0.5, 1.0, -0.6448) < 0.5, True)
    check("positive B raises a 50/50", apply_platt(0.5, 1.0, 0.1612) > 0.5, True)
    close("B alone at p=0.5 is sigmoid(B)", apply_platt(0.5, 1.0, 0.25), _sigmoid(0.25), eps=1e-6)


def test_output_is_always_a_probability():
    print("\n4.3: output stays inside (0, 1) for any input")
    for p in (0.0, 1e-12, 0.5, 1 - 1e-12, 1.0):
        for a, b in ((0.37, -0.65), (1.3, 0.16), (5.0, 3.0)):
            v = apply_platt(p, a, b)
            check(f"p={p} A={a} B={b} in range", 0.0 < v < 1.0, True)


def test_log_loss_behaves():
    print("\n4.3: the scoring function used to accept or reject a fit")
    check("a perfect prediction scores ~0", round(_log_loss([(1.0, 1.0), (0.0, 0.0)]), 4), 0.0)
    worse = _log_loss([(0.1, 1.0)])
    better = _log_loss([(0.9, 1.0)])
    check("being right scores lower than being wrong", better < worse, True)


def test_the_guards_are_what_the_decisions_say():
    print("\n4.3: thresholds match the standing decisions")
    check("Q32's minimum sample is 200", MIN_ROWS_FOR_CALIBRATION, 200)
    check("holdout is a real fraction", 0 < HOLDOUT_FRACTION < 1, True)
    close("logit/sigmoid round-trip", _sigmoid(_logit(0.37)), 0.37, eps=1e-6)


def main() -> bool:
    test_identity_calibration_is_a_no_op()
    test_a_below_one_shrinks_toward_the_middle()
    test_a_above_one_sharpens()
    test_calibration_never_reorders()
    test_b_shifts_the_base_rate()
    test_output_is_always_a_probability()
    test_log_loss_behaves()
    test_the_guards_are_what_the_decisions_say()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
