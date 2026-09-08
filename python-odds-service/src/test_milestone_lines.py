"""A milestone line means "L or more", and treating it as an ordinary line is
an off-by-one that fails silently.

Phase 3.2 of docs/master-plan-2026-09-06.md (2026-09-07).

WHAT THIS PROTECTS. Almost every prop line in this archive is a HALF-INTEGER
meaning "strictly more than": 0.5 hits means >= 1 hit. A handful of schemes
instead post an INTEGER MILESTONE meaning "L or more": a home-run line of 1
means >= 1 home run, which is the SAME event as an ordinary 0.5 line, not the
same as ">1".

Measured on `Home Runs Milestones` (2026-09-07, n=31,238 rows joined to real
outcomes):

    P(hr >= line)  = 0.1119     <- the correct reading
    P(hr >  line)  = 0.0069     <- what an ordinary-line reading gives

and on the known-good half-integer scheme, `Total Home Runs Hit` at line 0.5:

    P(hr > 0.5)    = 0.1170

0.1119 against 0.1170 is the same event measured on two schemes. 0.0069 is "two
or more home runs" — a market roughly sixteen times rarer, and nothing about it
would look wrong on inspection. It would simply train the model on the wrong
question and calibrate confidently to it.

WHY IT MATTERS BEYOND ONE MARKET. This is exactly the trap the master plan
already records for NFL in Phase 6 ("Milestone alt-lines are off by one: a line
of 2.0 means over 1.5"). MLB has five such schemes in `prop_odds_archive`
covering the whole 2026 season — home runs, batter strikeouts, batter walks,
stolen bases, strikeouts thrown — roughly 148,000 rows. Only home runs is wired
up (Phase 3.2); the rest are recorded in the plan, unclaimed. Whoever wires the
next one will do it through `MarketSpec.milestone_names`, and this file is what
stops them doing it through `names`.

An audit at the time confirmed NO market was ingesting an integer-line scheme
through `names`, so no historical fit was corrupted by this. That is a fact
worth re-checking rather than assuming, which is what
`test_no_integer_scheme_is_treated_as_an_ordinary_line` does.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from predict import mlb_props as mp  # noqa: E402

_failures = 0


def check(label, got, want):
    global _failures
    ok = got == want
    if not ok:
        _failures += 1
    print(f"{'PASS' if ok else 'FAIL'}: {label}" + ("" if ok else f"  got {got!r}, want {want!r}"))


class _FakeConn:
    """Stands in for asyncpg so the conversion can be tested without a database."""

    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, _sql, *_args):
        return self._rows


def _row(type_name, line, aid="1", gd="2026-05-01", actual=None):
    return {"game_date": gd, "athlete_id": aid, "line": line,
            "over_price": None, "under_price": None, "type_name": type_name}


def _load(rows, spec, outcomes):
    import fit_mlb_props as F
    games = [(gd, aid, stat, 1.0) for gd, aid, stat in outcomes]
    return asyncio.run(F.load_props(_FakeConn(rows), spec, {"1": "1", "2": "2"}, games))


def test_an_integer_milestone_is_shifted_to_a_half_integer():
    spec = next(s for s in mp.MARKETS if s.slug == "home-runs")
    # One milestone row (line 1 == ">=1 HR") and one ordinary row (line 0.5).
    out = _load([_row("Home Runs Milestones", 1.0), _row("Total Home Runs Hit", 0.5)],
                spec, [("2026-05-01", "1", 1.0)])
    lines = sorted(r[2] for r in out)
    check("both rows survive", len(out), 2)
    check("the milestone line 1 becomes 0.5, matching the ordinary scheme",
          lines, [0.5, 0.5])
    # ...and therefore both settle the SAME way on the same outcome.
    check("both rows agree the batter went over with 1 HR",
          [r[5] > r[2] for r in out], [True, True])


def test_the_off_by_one_would_have_flipped_the_outcome():
    """The bug this prevents, demonstrated rather than described."""
    spec = next(s for s in mp.MARKETS if s.slug == "home-runs")
    out = _load([_row("Home Runs Milestones", 1.0)], spec, [("2026-05-01", "1", 1.0)])
    line = out[0][2]
    check("converted: a 1-HR game is OVER", 1.0 > line, True)
    check("unconverted, the same game would read as UNDER", 1.0 > 1.0, False)


def test_a_non_integer_under_a_milestone_name_is_skipped_not_shifted():
    """Shifting an already-half-integer line would CREATE the off-by-one."""
    spec = next(s for s in mp.MARKETS if s.slug == "home-runs")
    out = _load([_row("Home Runs Milestones", 0.5)], spec, [("2026-05-01", "1", 1.0)])
    check("a half-integer milestone row is dropped rather than guessed at",
          len(out), 0)


def test_milestone_names_are_disjoint_from_names():
    """A name in both would be queried once and converted inconsistently."""
    for s in mp.MARKETS:
        overlap = set(s.names) & set(s.milestone_names)
        check(f"{s.slug}: names and milestone_names do not overlap", overlap, set())


def test_no_integer_scheme_is_treated_as_an_ordinary_line():
    """The audit result, pinned. Every KNOWN integer-line scheme must be either
    unclaimed or declared as a milestone — never sitting inside `names`.

    The list is the one measured in `prop_odds_archive` on 2026-09-07. It is not
    exhaustive of all future schemes, which is why the real defence is
    `milestone_names` existing at all; this catches a regression on the ones we
    have actually seen.
    """
    KNOWN_INTEGER_SCHEMES = (
        "Home Runs Milestones",
        "Strikeouts (Batter) Milestones",
        "Walks (Batter) Milestones",
        "Stolen Bases Milestones",
        "Strikeouts Thrown Milestones",
    )
    ordinary = {n for s in mp.MARKETS for n in s.names}
    for name in KNOWN_INTEGER_SCHEMES:
        check(f"{name!r} is not read as an ordinary half-integer line",
              name in ordinary, False)


def test_home_runs_actually_claims_its_milestone_scheme():
    """Phase 3.2's whole result: the market was 'untestable' only because this
    scheme was unread. 37,252 rows, 2026-04-11..2026-09-02."""
    spec = next(s for s in mp.MARKETS if s.slug == "home-runs")
    check("home-runs declares Home Runs Milestones",
          "Home Runs Milestones" in spec.milestone_names, True)


def main() -> bool:
    test_an_integer_milestone_is_shifted_to_a_half_integer()
    test_the_off_by_one_would_have_flipped_the_outcome()
    test_a_non_integer_under_a_milestone_name_is_skipped_not_shifted()
    test_milestone_names_are_disjoint_from_names()
    test_no_integer_scheme_is_treated_as_an_ordinary_line()
    test_home_runs_actually_claims_its_milestone_scheme()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
