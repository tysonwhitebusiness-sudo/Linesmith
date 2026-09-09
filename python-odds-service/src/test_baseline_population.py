"""The cross-market ranking anchor must describe the population it is subtracted
from. Phase 4.7, 2026-09-09.

WHAT WENT WRONG. `league_baseline_for` counted every historical appearance by
tonight's pitchers. 38.3% of `pitcher-hits-allowed`'s baseline rows were RELIEF
outings (p10 = 3 outs, p25 = 7 outs) where clearing a starter's line is close to
impossible, so the baseline read 38.2% where the matched population reads 59.1%.
Scan ranks on `P(over) - baseline`, so all 35 pitchers were handed a fake
+18.3pt edge and swept the top 19 rows of the MLB board. The MODEL was fine:
55.9% served against 59.1% actual.

These tests pin the two halves that matter, because a fix that corrected the
pitcher market by moving the batter markets would not be a fix.
"""
import sys
from datetime import date

sys.path.insert(0, "src")
from predict.mlb_prop_serving import league_baseline_for

AS_OF = date(2026, 9, 9)
D1, D2, D3, D4 = (date(2026, 9, i) for i in (1, 2, 3, 4))
SUBJECTS = {"p1": "g1"}

#              (game_date, athlete_id, stat, volume)
# Two starts over the line, two relief outings under it. Unfiltered this is
# 2/4 = 50%; starts-only it is 2/2 = 100% — the same shape as the real defect.
GAMES = [
    (D1, "p1", 7.0, 18.0),   # start,  over 4.5
    (D2, "p1", 1.0, 3.0),    # relief, under
    (D3, "p1", 6.0, 17.0),   # start,  over 4.5
    (D4, "p1", 0.0, 2.0),    # relief, under
]
STARTS = {(D1, "p1"), (D3, "p1")}


def check(name, got, want):
    assert got == want, f"FAIL {name}: got {got!r}, want {want!r}"
    print(f"PASS  {name}")


def test_unfiltered_counts_every_appearance():
    check("no eligible set -> every appearance counts",
          league_baseline_for(GAMES, SUBJECTS, 4.5, AS_OF), 0.5)


def test_eligible_set_narrows_to_starts():
    check("eligible set -> only starts count",
          league_baseline_for(GAMES, SUBJECTS, 4.5, AS_OF, eligible=STARTS), 1.0)


def test_relief_dilution_is_the_defect():
    """The bug in one assertion: relief rows drag the anchor down, which is what
    manufactured the +18pt edge."""
    all_app = league_baseline_for(GAMES, SUBJECTS, 4.5, AS_OF)
    starts = league_baseline_for(GAMES, SUBJECTS, 4.5, AS_OF, eligible=STARTS)
    assert all_app < starts, "relief appearances must dilute the baseline downward"
    print(f"PASS  relief dilutes the anchor ({all_app:.0%} vs {starts:.0%})")


def test_batter_path_is_a_no_op():
    """`eligible=None` is the batter path, and it must be EXACTLY the old
    behaviour — the property volume-weighting and percentile cuts both failed."""
    check("eligible=None is byte-identical to the pre-fix call",
          league_baseline_for(GAMES, SUBJECTS, 4.5, AS_OF, eligible=None),
          league_baseline_for(GAMES, SUBJECTS, 4.5, AS_OF))


def test_empty_eligible_yields_none_not_zero():
    """No comparable appearance is 'unknown', not 'never happens'. Returning 0.0
    would make every player look maximally strong against a zero anchor."""
    check("no eligible rows -> None",
          league_baseline_for(GAMES, SUBJECTS, 4.5, AS_OF, eligible=set()), None)


def test_leakage_guard_still_holds():
    future = GAMES + [(date(2026, 9, 20), "p1", 9.0, 18.0)]
    check("rows on/after as_of are excluded",
          league_baseline_for(future, SUBJECTS, 4.5, AS_OF, eligible=STARTS), 1.0)


for fn in list(globals().values()):
    if callable(fn) and getattr(fn, "__name__", "").startswith("test_"):
        fn()
print("\nall baseline-population checks passed")


# --- the tripwire ----------------------------------------------------------
from predict.mlb_prop_serving import _market_edge_diagnostics, ServedProjection


def _sp(dim, prob, base):
    return ServedProjection(athlete_id="a", game_id="g", dimension=dim,
                            projection=1.0, projected_volume=1.0,
                            games_of_history=10, league_rate=0.3,
                            line=4.5, model_prob=prob, league_baseline=base)


def test_healthy_market_raises_nothing():
    served = [_sp("hits", 0.61, 0.62), _sp("hits", 0.60, 0.62), _sp("hits", 0.63, 0.62)]
    edges, warns = _market_edge_diagnostics(served)
    check("healthy market -> no warning", warns, [])
    assert abs(edges["hits"]) < 0.05, edges


def test_displaced_market_trips():
    """The real defect's shape: every row plausible alone, whole market shifted."""
    served = [_sp("pitcher-hits-allowed", p, 0.382) for p in (0.553, 0.559, 0.585)]
    edges, warns = _market_edge_diagnostics(served)
    assert len(warns) == 1, warns
    assert "pitcher-hits-allowed" in warns[0]
    print(f"PASS  displaced market trips ({edges['pitcher-hits-allowed']:+.1%})")


def test_rows_without_a_probability_are_ignored():
    served = [_sp("nfl-ish", None, None), _sp("hits", 0.61, 0.62)]
    edges, warns = _market_edge_diagnostics(served)
    check("no-probability rows excluded", sorted(edges), ["hits"])
    check("and raise no warning", warns, [])


for name in ("test_healthy_market_raises_nothing", "test_displaced_market_trips",
             "test_rows_without_a_probability_are_ignored"):
    globals()[name]()
print("all tripwire checks passed")
