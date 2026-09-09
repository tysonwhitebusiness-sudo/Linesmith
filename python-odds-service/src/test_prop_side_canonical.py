"""`side` must satisfy prop_odds_side_valid before it reaches the database.

2026-09-09: `refreshTennisAtpJob` died with

    CheckViolationError: new row for relation "prop_odds" violates check
    constraint "prop_odds_side_valid"
    DETAIL: Failing row contains (..., aces, null, away, fanduel, 186, ...)

`write_prop_odds` uses `executemany`, which is ONE statement — a single bad
value discards the entire batch, so one stray row cost every tennis prop that
cycle. The value came from SharpAPI emitting a two-way `away` selection beside
real props; it only became reachable when pagination started reading past page
one, which is where those rows sit.

Canonicalising at the shared writer rather than in each of the six producers is
the same rule task 5.3 applied to `canonical_bookmaker`, and for the same
reason: a producer that forgets takes down the batch.
"""
import sys
sys.path.insert(0, "src")
from db import canonical_prop_side, PROP_SIDE_VALID


def check(name, got, want):
    assert got == want, f"FAIL {name}: got {got!r}, want {want!r}"
    print(f"PASS  {name}")


def test_valid_sides_survive_untouched():
    for s in ("over", "under", "other"):
        check(f"{s!r} passes through", canonical_prop_side(s), s)


def test_the_row_that_took_tennis_down():
    check("'away' -> 'other' instead of killing the batch",
          canonical_prop_side("away"), "other")


def test_case_and_whitespace_normalised():
    check("' OVER ' -> 'over'", canonical_prop_side(" OVER "), "over")
    check("'Under' -> 'under'", canonical_prop_side("Under"), "under")


def test_nothing_can_escape_the_constraint():
    """The property that matters: no input produces an invalid value."""
    for v in ("away", "home", "yes", "no", "", "  ", None, 0, 123, [], {}, "OvEr"):
        got = canonical_prop_side(v)
        assert got in PROP_SIDE_VALID, f"{v!r} produced {got!r}, outside the constraint"
    print("PASS  no input of any type escapes prop_odds_side_valid")


def test_unknown_is_bucketed_not_dropped():
    """A row we cannot grade is still a price someone posted — `other` keeps it,
    and `other` is SharpAPI's own label for a line-less selection."""
    assert canonical_prop_side("away") is not None
    print("PASS  unrecognised sides are bucketed, never dropped")


for fn in [test_valid_sides_survive_untouched, test_the_row_that_took_tennis_down,
           test_case_and_whitespace_normalised, test_nothing_can_escape_the_constraint,
           test_unknown_is_bucketed_not_dropped]:
    fn()
print("\nall prop-side canonicalisation checks passed")
