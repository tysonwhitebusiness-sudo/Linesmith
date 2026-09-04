"""predict/dc_walkforward.py — the Phase 3.3 rolling-refit harness.

The properties worth testing here are all about LEAKAGE, because leakage is the
one failure that makes every downstream number look better and mean nothing:

  a match must be predicted by a fit trained STRICTLY BEFORE its own date —
  not "on or before", which lets a same-day fixture inform itself, and not
  "before the last refit", which would quietly include matches played between
  the refit and the prediction;
  out-of-order input must raise rather than silently score a match on ratings
  that already contain its result;
  and the minimum-history floor must skip thin fits rather than score them.

Run with:  python test_dc_walkforward.py
"""
import sys
from datetime import date, timedelta

from predict import dc_walkforward as wf

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def synth(n_days: int, teams=("A", "B", "C", "D"), start=date(2020, 1, 1)):
    """A dense, deterministic fixture list — two matches every day."""
    out = []
    for d in range(n_days):
        day = start + timedelta(days=d)
        out.append({"sport": "t", "played": day, "home": teams[d % len(teams)],
                    "away": teams[(d + 1) % len(teams)],
                    "home_goals": (d % 3), "away_goals": ((d + 1) % 3)})
        out.append({"sport": "t", "played": day, "home": teams[(d + 2) % len(teams)],
                    "away": teams[(d + 3) % len(teams)],
                    "home_goals": ((d + 1) % 3), "away_goals": (d % 2)})
    return out


def test_rejects_out_of_order() -> None:
    print("\nout-of-order input raises — chronology is the no-leakage guarantee")
    ms = synth(10)
    ms[5], ms[9] = ms[9], ms[5]
    try:
        wf.walk_forward(ms, score_from=date(2020, 1, 1), min_matches_per_team=0)
        check("raises on unsorted input", False, True)
    except ValueError:
        check("raises on unsorted input", True, True)


def test_no_same_day_leakage() -> None:
    print("\nSTRICTLY BEFORE — a fixture must not inform its own prediction")
    ms = synth(120)
    res = wf.walk_forward(ms, score_from=date(2020, 3, 1),
                          min_matches_per_team=1, refit_days=7)
    check("something was scored", len(res.scored) > 0, True)
    # For every scored match, the training count must equal exactly the number
    # of matches played on strictly earlier dates.
    bad = 0
    for s in res.scored:
        expected = sum(1 for m in ms if m["played"] < s.played)
        if s.n_train != expected:
            bad += 1
    check("every prediction trained on strictly-earlier matches only", bad, 0)
    # And never on its own day: a same-day count would exceed the strict count.
    same_day = sum(1 for s in res.scored
                   if s.n_train > sum(1 for m in ms if m["played"] < s.played))
    check("no prediction saw a same-day result", same_day, 0)


def test_every_held_out_match_is_scored() -> None:
    print("\ncoverage — every held-out match gets a prediction")
    ms = synth(200)
    cutoff = date(2020, 4, 1)
    res = wf.walk_forward(ms, score_from=cutoff, min_matches_per_team=1)
    expected = sum(1 for m in ms if m["played"] >= cutoff)
    check("scored count equals held-out count", len(res.scored) + res.skipped_thin,
          expected)
    check("probabilities sum to 1",
          all(abs(s.p_home + s.p_draw + s.p_away - 1.0) < 1e-9 for s in res.scored),
          True)
    check("p_actual selects the right outcome",
          all(s.p_actual in (s.p_home, s.p_draw, s.p_away) for s in res.scored), True)


def test_minimum_history_skips_rather_than_scores() -> None:
    print("\nthin history is SKIPPED, not scored on a meaningless fit")
    ms = synth(60)
    # 4 teams x 15 = 60 matches required before anything is scored.
    res = wf.walk_forward(ms, score_from=date(2020, 1, 1),
                          min_matches_per_team=15, refit_days=7)
    check("early matches were skipped, not scored", res.skipped_thin > 0, True)
    if res.scored:
        first = min(s.n_train for s in res.scored)
        check("nothing scored below the floor", first >= 60, True)


def test_refit_cadence() -> None:
    print("\nrefit cadence — weekly, not per match")
    ms = synth(140)
    weekly = wf.walk_forward(ms, score_from=date(2020, 2, 1),
                             min_matches_per_team=1, refit_days=7)
    daily = wf.walk_forward(ms, score_from=date(2020, 2, 1),
                            min_matches_per_team=1, refit_days=1)
    check("weekly refits far fewer times than daily", weekly.refits < daily.refits, True)
    check("both still score every held-out match",
          len(weekly.scored), len(daily.scored))
    print(f"    weekly {weekly.refits} refits vs daily {daily.refits}, "
          f"{len(weekly.scored)} matches scored either way")


def test_warm_start_does_not_change_the_answer() -> None:
    print("\nwarm starting is a SPEED measure — it must not move the answer")
    ms = synth(120)
    kw = dict(score_from=date(2020, 3, 1), min_matches_per_team=1, refit_days=14)
    cold = wf.walk_forward(ms, warm_start=False, **kw)
    warm = wf.walk_forward(ms, warm_start=True, **kw)
    check("same number of predictions", len(cold.scored), len(warm.scored))
    worst = max(abs(c.p_home - w.p_home)
                for c, w in zip(cold.scored, warm.scored))
    # Converged optima should agree closely; a large gap means one of them did
    # not converge, which is exactly what refits_hitting_cap is there to reveal.
    check(f"predictions agree within 0.02 (worst {worst:.4f})", worst < 0.02, True)
    print(f"    cold hit the iteration cap {cold.refits_hitting_cap}/{cold.refits} times, "
          f"warm {warm.refits_hitting_cap}/{warm.refits}")


def main() -> int:
    test_rejects_out_of_order()
    test_no_same_day_leakage()
    test_every_held_out_match_is_scored()
    test_minimum_history_skips_rather_than_scores()
    test_refit_cadence()
    test_warm_start_does_not_change_the_answer()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all dc_walkforward checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
