"""An inverted calibration cannot reach a board.

Phase 3.0 of docs/master-plan-2026-09-06.md (2026-09-06).

WHAT THIS PROTECTS. `platt(p, a, b)` is sigmoid(a * logit(p) + b). When `a` is
negative the curve is mirrored, so a LOWER raw probability comes out HIGHER —
the model's ordering is inverted at serving time regardless of how well it
ordered when it was fitted. MLB `pitcher-outs` shipped exactly that way:

    a = -0.0649, probability_ok = True, board line 16.5 outs

    Luis Torrens    proj  2.00 outs -> P 65.1%      (a position player)
    Jhonny Pereda   proj  2.20 outs -> P 64.0%      (a backup catcher)
    a real starter  proj 16.00 outs -> P ~50.1%

Those three held the top of the ENTIRE cross-market board, because Scan ranks on
`calibrated P(over) - league baseline` and the inversion rewards the smallest
projection. Measured on the live board 2026-09-06.

WHY THE FIT MISSED IT. `fit_mlb_props.py` gated on `ordering_monotone`, which is
measured on the PROJECTION (quintiles of expected value against realised
outcome), and on ECE/worst-bucket, both measured at each row's OWN market line.
A market can order its projections perfectly and calibrate well at market lines
and still invert at the fixed line the board serves. Nothing asked the one
question the board depends on.

The fix is in two independent places on purpose, and this file covers both:
  - `fit_mlb_props.py` refuses `probability_ok` when the fitted slope is not
    positive, so a new inverted fit is never persisted as servable; and
  - `count_prop_engine.probability_is_servable`, which both serving pipes call,
    so a row ALREADY persisted (or written by any future fitter) still cannot
    reach a board inverted.

THE NHL TRAP, which this file exists to keep shut. MLB stores `calibration_a`
and serves through `platt`; NHL stores `temperature` and serves through
`temper`, the a = 1/T special case. A guard that read only `calibration_a`
would have silently blanked all four NHL markets, since NHL rows carry no such
key. The slope is derived from whichever key is present.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from predict import count_prop_engine as eng  # noqa: E402

_failures = 0


def check(label, got, want):
    global _failures
    ok = got == want
    if not ok:
        _failures += 1
    print(f"{'PASS' if ok else 'FAIL'}: {label}" + ("" if ok else f"  got {got!r}, want {want!r}"))


def test_the_measured_inversion_is_refused():
    """The exact row that shipped, with its real fitted parameters."""
    pitcher_outs = {"probability_ok": True, "calibration_a": -0.0649,
                    "calibration_b": 0.0061}
    check("pitcher-outs as it shipped is not servable",
          eng.probability_is_servable(pitcher_outs), False)

    # ...and demonstrate WHY, through the real platt, at the real board line.
    # A tiny raw probability is what a 2-out reliever gets against a 16.5 line.
    a, b = -0.0649, 0.0061
    reliever = eng.platt(0.001, a, b)   # raw ~0 -> should stay ~0
    starter = eng.platt(0.50, a, b)     # raw 0.5 -> should stay ~0.5
    check("the inverted curve really does put the reliever above the starter",
          reliever > starter, True)
    check("and it is not a rounding artifact — the gap is large",
          round(reliever - starter, 2) >= 0.10, True)


def test_healthy_markets_are_untouched():
    """Every market that was serving a sane probability keeps it.

    Real fitted slopes, read off `model_calibration` on 2026-09-06.
    """
    for market, a in (("hits", 0.9236), ("singles", 0.9470), ("runs", 0.8684),
                      ("rbis", 0.8512), ("stolen-bases", 0.7676),
                      ("hits-runs-rbis", 0.5453), ("pitcher-walks-allowed", 0.3966),
                      ("pitcher-strikeouts", 0.1044)):
        check(f"{market} (a={a:+.4f}) still serves a probability",
              eng.probability_is_servable({"probability_ok": True, "calibration_a": a}),
              True)


def test_nhl_temperature_rows_still_serve():
    """The trap: NHL carries `temperature`, never `calibration_a`."""
    for market, t in (("shots-on-goal", 1.46), ("assists", 1.16),
                      ("points", 1.16), ("hits", 2.51)):
        cal = {"probability_ok": True, "temperature": t}
        check(f"nhl {market} (T={t}) still serves a probability",
              eng.probability_is_servable(cal), True)
        check(f"nhl {market} slope is derived as 1/T",
              round(eng.effective_calibration_slope(cal), 6), round(1.0 / t, 6))


def test_the_fit_verdict_is_still_respected():
    """The guard ADDS to `probability_ok`; it never overrides a No."""
    check("a market the fit rejected stays rejected even with a great slope",
          eng.probability_is_servable({"probability_ok": False, "calibration_a": 0.9}),
          False)


def test_degenerate_rows_are_not_treated_as_flat():
    """No calibration is not the same as a flat one, and must not serve."""
    check("a zero slope is refused (the curve carries no ordering at all)",
          eng.probability_is_servable({"probability_ok": True, "calibration_a": 0.0}), False)
    check("T=0 is undefined, not infinite slope",
          eng.probability_is_servable({"probability_ok": True, "temperature": 0.0}), False)
    check("a row naming no calibration this engine can apply is refused",
          eng.probability_is_servable({"probability_ok": True}), False)
    check("and its slope is None rather than a number",
          eng.effective_calibration_slope({"probability_ok": True}), None)
    check("a non-numeric slope is refused rather than raising",
          eng.probability_is_servable({"probability_ok": True, "calibration_a": None}), False)


def test_both_serving_pipes_actually_call_the_guard():
    """A guard nothing calls is not a guard.

    Asserted against the source of both pipes rather than by running them,
    which would need a live slate and a database.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    for pipe in ("mlb_prop_serving.py", "nhl_prop_serving.py"):
        src = open(os.path.join(here, "predict", pipe), encoding="utf-8").read()
        check(f"{pipe} gates on probability_is_servable",
              "eng.probability_is_servable(cal)" in src, True)
        check(f"{pipe} no longer reads probability_ok directly for this decision",
              'show_prob = bool(cal.get("probability_ok"))' in src, False)


def test_the_fitter_refuses_to_persist_an_inverted_slope():
    """The other half of the fix, asserted at its source."""
    root = os.path.dirname(here := os.path.dirname(os.path.abspath(__file__)))
    src = open(os.path.join(root, "fit_mlb_props.py"), encoding="utf-8").read()
    check("fit_mlb_props computes slope_ok", "slope_ok = cal_a > 0.0" in src, True)
    check("and probability_ok depends on it",
          "prob_ok = bool(monotone and slope_ok" in src, True)


def main() -> bool:
    test_the_measured_inversion_is_refused()
    test_healthy_markets_are_untouched()
    test_nhl_temperature_rows_still_serve()
    test_the_fit_verdict_is_still_respected()
    test_degenerate_rows_are_not_treated_as_flat()
    test_both_serving_pipes_actually_call_the_guard()
    test_the_fitter_refuses_to_persist_an_inverted_slope()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
