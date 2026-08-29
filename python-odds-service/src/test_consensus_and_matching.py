"""Phase 5.7, 5.8 and 5.10 — three independent ways the pipeline lied quietly.

5.7 (P3 M14) — the Tier-2 consensus included the very book being compared
against it, so every book partly set its own benchmark and every measured edge
shrank toward "fair". With few books quoting a prop, which is the common case
here, a book can be most of its own reference.

5.8 (P3 M13) — providers._team_match used raw string equality, so a provider
renaming "LA Galaxy" to "Los Angeles Galaxy", or adding an accent, silently
returned zero rows. Zero rows is indistinguishable from "no odds offered",
which is what made it invisible.

5.10 (P2 H4) — one provider raising discarded every sibling provider's
already-fetched (and already-paid-for) rows.

Pure functions, no network, no database, so this runs in CI (Q20).

Run with:  python -u src/test_consensus_and_matching.py
"""
import sys
from datetime import datetime, timezone

sys.path.insert(0, "src")

from db import PropOddsRow  # noqa: E402
from entity_resolution import normalize_team_name, team_name_words  # noqa: E402
from predict.live_edge import _consensus_reference_prob  # noqa: E402
from providers import _team_match, drain_team_match_misses, record_team_match_miss  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


def _row(bookmaker: str, side: str, american: int, provider: str = "test") -> PropOddsRow:
    return PropOddsRow(
        id=1, provider_id=provider, game_id="g1", subject_id="s1",
        subject_name="Test Player", market_key="hits", line=0.5, side=side,
        bookmaker=bookmaker, american_odds=american, decimal_odds=None,
        # Current timestamp, not a hardcoded one — a fixed date ages past the
        # staleness threshold and turns this into a spurious failure later.
        fetched_at=datetime.now(timezone.utc).isoformat(),
        is_delayed=False, delay_seconds=None,
    )


def _two_sided(bookmaker: str, over: int, under: int) -> list[PropOddsRow]:
    return [_row(bookmaker, "over", over), _row(bookmaker, "under", under)]


# ---------------------------------------------------------------------------
# 5.7
# ---------------------------------------------------------------------------

def test_compared_book_is_excluded_from_its_own_consensus():
    print("\n5.7: the compared book is excluded from its own reference")
    # Three books. 'outlier' is far off the other two; it is also the book we
    # are comparing, so leaving it in drags the median toward its own price.
    matched = _two_sided("bookA", -110, -110) + _two_sided("bookB", -105, -115) + _two_sided("outlier", 250, -400)

    with_self = _consensus_reference_prob(matched, "over")
    without_self = _consensus_reference_prob(matched, "over", exclude_bookmaker="outlier")
    check("both produce a reference", with_self is not None and without_self is not None, True)
    check(
        "excluding the subject book MOVES the reference",
        round(with_self[0], 6) != round(without_self[0], 6),
        True,
    )
    print(f"       including it: {with_self[0]:.4f}   excluding it: {without_self[0]:.4f}")


def test_a_lone_book_is_not_its_own_consensus():
    """The degenerate case: exclude the only book and there is nothing left.
    Returning a 'consensus' of one would be returning that book's own price."""
    print("\n5.7: one book cannot be its own consensus")
    matched = _two_sided("solo", -110, -110)
    check("with no exclusion there is a reference", _consensus_reference_prob(matched, "over") is not None, True)
    check(
        "excluding the only book returns None, not its own price",
        _consensus_reference_prob(matched, "over", exclude_bookmaker="solo"),
        None,
    )


def test_other_books_are_untouched():
    print("\n5.7: excluding one book does not disturb the others")
    matched = _two_sided("bookA", -110, -110) + _two_sided("bookB", -105, -115)
    only_b = _consensus_reference_prob(matched, "over", exclude_bookmaker="bookA")
    b_alone = _consensus_reference_prob(_two_sided("bookB", -105, -115), "over")
    check("excluding A leaves exactly B's number", only_b, b_alone)


# ---------------------------------------------------------------------------
# 5.8
# ---------------------------------------------------------------------------

class _Game:
    def __init__(self, home, away, gid="g1"):
        self.home_team_name, self.away_team_name, self.game_id = home, away, gid


def test_team_match_survives_format_changes():
    print("\n5.8: a known format variant now matches")
    g = _Game("Los Angeles Galaxy", "New York Red Bulls")
    check("exact names still match", _team_match("Los Angeles Galaxy", "New York Red Bulls", g), True)
    check("home/away reversed still matches", _team_match("New York Red Bulls", "Los Angeles Galaxy", g), True)
    check("'LA Galaxy' matches 'Los Angeles Galaxy'", _team_match("LA Galaxy", "New York Red Bulls", g), True)
    check("word reordering matches", _team_match("Red Bull New York", "LA Galaxy", g), True)

    accented = _Game("Montréal Impact", "CF Montreal B")
    check("accents normalise", normalize_team_name("Montréal"), normalize_team_name("Montreal"))
    check("and the accented name matches itself unaccented",
          _team_match("Montreal Impact", "CF Montreal B", accented), True)


def test_team_match_still_refuses_a_wrong_game():
    """The reason this deliberately does NOT adopt harvester_scrape's loose
    substring fallback: here a false positive attaches odds to the WRONG game,
    which is worse than a miss."""
    print("\n5.8: a genuinely different game still does not match")
    g = _Game("Los Angeles Galaxy", "New York Red Bulls")
    check("different teams", _team_match("Chicago Fire", "Atlanta United", g), False)
    check("one side right, one wrong", _team_match("LA Galaxy", "Chicago Fire", g), False)
    # Michigan / Michigan State is the real CFB trap the alias comments cite.
    cfb = _Game("Michigan Wolverines", "Ohio State Buckeyes")
    check("Michigan State is not Michigan",
          _team_match("Michigan State Spartans", "Ohio State Buckeyes", cfb), False)


def test_misses_are_recorded_not_swallowed():
    print("\n5.8: an unmatched game is recorded for the aggregate log")
    drain_team_match_misses()  # start clean
    g = _Game("Some Team", "Other Team", gid="g99")
    record_team_match_miss("testprovider", g)
    drained = drain_team_match_misses()
    check("one miss recorded", len(drained), 1)
    check("it names the provider and the game", "testprovider" in drained[0] and "g99" in drained[0], True)
    check("draining clears the buffer", drain_team_match_misses(), [])


# ---------------------------------------------------------------------------
# 5.10 — the shape of the fix, tested without a live provider.
# ---------------------------------------------------------------------------

def test_gather_preserves_siblings():
    """asyncio.gather(..., return_exceptions=True) returns the exception as a
    VALUE alongside the successful results, instead of propagating it and
    discarding them. That difference is the whole of P2 H4."""
    print("\n5.10: one provider raising must not discard its siblings")
    import asyncio

    async def ok(n):
        return f"rows from {n}"

    async def boom():
        raise RuntimeError("provider exploded")

    async def run(return_exceptions):
        return await asyncio.gather(ok(1), boom(), ok(2), return_exceptions=return_exceptions)

    # The old behaviour: the exception propagates and everything is lost.
    try:
        asyncio.run(run(False))
        check("without the flag, gather raises", False, True)
    except RuntimeError:
        check("without the flag, gather raises and siblings are lost", True, True)

    results = asyncio.run(run(True))
    survivors = [r for r in results if not isinstance(r, BaseException)]
    failures = [r for r in results if isinstance(r, BaseException)]
    check("with the flag, both successful providers survive", survivors, ["rows from 1", "rows from 2"])
    check("and the failure is still visible, not swallowed", len(failures), 1)


def main() -> bool:
    test_compared_book_is_excluded_from_its_own_consensus()
    test_a_lone_book_is_not_its_own_consensus()
    test_other_books_are_untouched()
    test_team_match_survives_format_changes()
    test_team_match_still_refuses_a_wrong_game()
    test_misses_are_recorded_not_swallowed()
    test_gather_preserves_siblings()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
