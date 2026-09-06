"""Phase 1.2 — the count-prop engine still produces NHL's verified numbers.

`count_prop_engine.py` was extracted from `nhl_props.py` in 5.3 so MLB and NHL
could not grow two implementations of one idea. NHL was deliberately left on the
original at that point, so this file's job was to assert the two agreed
bit-for-bit and fail if they ever drifted.

**Phase 1.2 of docs/master-plan-2026-09-06.md (2026-09-06) removed the second
implementation**, which is what the identity assertion was protecting against.
`nhl_props` now binds the shared engine (`MINUTES_PER_GAME = 18.0`) instead of
carrying its own copy of `shrunk_rate`/`project`/`PlayerHistory`/`nb_prob_over`.

That is a strictly better outcome than the test passing, but it retires the
comparison — there is no longer a second thing to compare against. So this file
becomes a REGRESSION PIN instead: `src/nhl_props_golden.json` holds values
computed by the pre-migration `nhl_props`, recorded before the deletion, and
this asserts the engine still reproduces them.

The pin is what makes the migration checkable rather than merely plausible. NHL's
fitted parameters, its persisted `model_calibration` verdicts and the board it
serves were all produced by the code these numbers came from; if the engine ever
stops reproducing them, every one of those results silently stops meaning what it
said.

Two tolerances, for the reason 5.3 measured:
  - projections are EXACT. `shrunk_rate`, `PlayerHistory` and `project` were
    bit-identical between the two implementations, so any difference at all is a
    real regression.
  - `nb_prob_over` is exact for finite dispersion and bounded at the Poisson
    limit, where the engine takes the exact limit and `nhl_props` evaluated the
    negative binomial at a very large r. 5.3 measured that gap at 2.72e-6; this
    holds it under 1e-5, four orders below the fit's own gate tolerance.

Run from python-odds-service/:
    python test_count_prop_engine.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from predict import count_prop_engine as eng  # noqa: E402
from predict import nhl_props as npx  # noqa: E402

GOLDEN = os.path.join(os.path.dirname(__file__), "src", "nhl_props_golden.json")
POISSON_LIMIT_TOLERANCE = 1e-5

FAIL = 0


def check(name, a, b=True) -> None:
    global FAIL
    if a != b:
        FAIL += 1
        print(f"  FAIL {name}: {a!r} != {b!r}")


def close(name, a, b, tol) -> None:
    global FAIL
    if abs(a - b) > tol:
        FAIL += 1
        print(f"  FAIL {name}: {a!r} vs {b!r} (>{tol})")


def test_the_golden_projections_still_reproduce() -> None:
    """Every projection the pre-migration NHL engine produced, reproduced
    exactly through the shared engine's NHL binding.

    The file carries the raw (events, volume) game draws rather than a seed to
    replay. That is deliberate and was learned the hard way: the first version
    of this pin regenerated the histories from `random.Random(20260906)`, and the
    recorder had consumed extra draws per trial that the replay did not, so the
    histories silently diverged and 5,875 checks failed on a migration that was
    in fact numerically exact. A fixture that depends on reproducing a
    generator's exact call sequence is a fixture that fails for reasons unrelated
    to what it tests.

    Feeding the draws back through `PlayerHistory.add` still pins that method's
    own bookkeeping and the volume-window slice, so a change to the recent-volume
    buffer moves these numbers even if the arithmetic is untouched.
    """
    golden = json.load(open(GOLDEN, encoding="utf-8"))
    hists = []
    for draws in golden["histories"]:
        h = npx.PlayerHistory()
        for ev, vol in draws:
            h.add(ev, vol)
        hists.append(h)
    proj = golden["projections"]
    print(f"projections — {len(proj)} pinned values must reproduce EXACTLY")
    for g in proj:
        h = hists[g["trial"]]
        check(f"games(trial={g['trial']})", h.games, g["games"])
        p = npx.project(h, g["lr"], g["lt"], k=g["k"], toi_window=g["w"])
        label = f"trial={g['trial']},w={g['w']},k={g['k']}"
        check(f"expected({label})", repr(p.expected), g["expected"])
        check(f"volume({label})", repr(p.projected_volume), g["volume"])
        check(f"rate({label})", repr(p.rate_per_chance), g["rate"])
    print(f"  {len(proj)} projections checked")


def test_the_golden_probabilities_stay_within_the_measured_bound() -> None:
    golden = json.load(open(GOLDEN, encoding="utf-8"))
    nb = golden["probabilities"]
    print(f"nb_prob_over — {len(nb)} pinned probabilities")
    worst = 0.0
    for g in nb:
        got = npx.nb_prob_over(g["line"], float(g["mean"]), g["disp"])
        want = float(g["p"])
        worst = max(worst, abs(got - want))
        close(f"nb_prob_over(line={g['line']},disp={g['disp']})", got, want,
              POISSON_LIMIT_TOLERANCE)
    print(f"  worst deviation {worst:.3e} (bound {POISSON_LIMIT_TOLERANCE:.0e})")


def test_nhl_binds_the_engine_rather_than_reimplementing_it() -> None:
    """The structural claim, not just the numeric one.

    A future edit could reintroduce a private copy in `nhl_props` and still pass
    the golden pin on the day it was written. This asserts the binding itself:
    NHL's types must BE the engine's, and its `project` must delegate with 18.0
    supplied.
    """
    print("nhl_props binds the engine")
    check("PlayerHistory is the engine's", npx.PlayerHistory is eng.PlayerHistory)
    check("Projection is the engine's", npx.Projection is eng.Projection)
    check("nb_prob_over is the engine's", npx.nb_prob_over is eng.nb_prob_over)
    check("minutes-per-game is NHL's own constant", npx.MINUTES_PER_GAME, 18.0)

    h = npx.PlayerHistory()
    for _ in range(25):
        h.add(2.0, 17.0)
    direct = eng.project(h, 0.13, 18.5, k=10.0, volume_window=5,
                         volume_per_game=npx.MINUTES_PER_GAME)
    bound = npx.project(h, 0.13, 18.5, k=10.0, toi_window=5)
    check("project delegates with 18.0 bound",
          repr(bound.expected), repr(direct.expected))
    check("shrunk_rate delegates too",
          repr(npx.shrunk_rate(50.0, 425.0, 0.13, 10.0)),
          repr(eng.shrunk_rate(50.0, 425.0, 0.13, 10.0, 18.0)))


def test_the_multiplier_hook_is_still_inert_for_nhl() -> None:
    """MLB's park-factor hook scales the RATE, not the volume, and NHL passes
    1.0. Kept from the 5.3 version of this file — it is the one engine behaviour
    NHL does not exercise, so nothing else would catch it changing."""
    print("multiplier hook")
    h = eng.PlayerHistory()
    for _ in range(30):
        h.add(1.0, 4.0)
    base = eng.project(h, 0.25, 4.0, k=10.0)
    same = eng.project(h, 0.25, 4.0, k=10.0, multiplier=1.0)
    check("multiplier 1.0 is a no-op", base.expected, same.expected)
    up = eng.project(h, 0.25, 4.0, k=10.0, multiplier=1.10)
    check("multiplier scales expected", round(up.expected, 12),
          round(base.expected * 1.10, 12))
    check("multiplier does NOT change volume", up.projected_volume,
          base.projected_volume)


def main() -> int:
    test_the_golden_projections_still_reproduce()
    test_the_golden_probabilities_stay_within_the_measured_bound()
    test_nhl_binds_the_engine_rather_than_reimplementing_it()
    test_the_multiplier_hook_is_still_inert_for_nhl()
    print(f"\n{'FAILED ' + str(FAIL) if FAIL else 'PASS'} — the engine still "
          f"reproduces NHL's verified numbers")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
