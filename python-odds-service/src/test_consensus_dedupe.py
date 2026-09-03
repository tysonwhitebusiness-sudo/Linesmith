"""The consensus median counts each bookmaker ONCE, not once per provider.

THE BUG THIS FIXES. `_consensus_*` keyed its dedupe on (bookmaker, provider_id),
so the same book arriving from two providers cast two votes in the median.
Measured on live prop_odds 2026-09-03: fanatics, draftkings and fanduel each
arrive from THREE providers, ten books from more than one, and 19,131 of 88,856
priced props (21.5%) had at least one book counted more than once.

WHY IT MATTERS MORE GOING FORWARD. Phase 1d widens coverage to six providers
across eight sports. Every provider added is another duplicate of the same
handful of books — so without this, the consensus gets *worse* exactly as the
data appears to get better, silently, with no failing check.

Run with:  python test_consensus_dedupe.py
"""
import sys
from datetime import datetime, timezone

from db import PropOddsRow
from predict import live_edge

_failures = 0


def check(label, actual, expected):
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def row(book, provider, side, odds, delay=None, is_delayed=False, line=0.5):
    # fetched_at must be RELATIVE TO NOW, not a fixed string. live_edge filters
    # stale prices, so a hardcoded timestamp makes this test pass on the day it
    # is written and fail silently thereafter — which is exactly what happened
    # to the first draft, six hours after it was written.
    now = datetime.now(timezone.utc).isoformat()
    return PropOddsRow(
        id=0, provider_id=provider, game_id="g1", subject_id="s1", subject_name="P",
        market_key="m", line=line, side=side, bookmaker=book, american_odds=odds,
        decimal_odds=None, fetched_at=now,
        is_delayed=is_delayed, delay_seconds=delay,
    )


def _two_sided(book, provider, over, under, **kw):
    return [row(book, provider, "over", over, **kw), row(book, provider, "under", under, **kw)]


def test_same_book_from_three_providers_votes_once():
    """The real shape: DraftKings via propline, propline_2 and sharpapi."""
    print("\ndedupe — one book, three providers")
    matched = []
    for prov in ("propline", "propline_2", "sharpapi"):
        matched += _two_sided("draftkings", prov, -110, -110)
    matched += _two_sided("pinnacle", "propline", 200, -240)

    got = live_edge._consensus_reference(matched, "over")
    assert got is not None, "expected a consensus"
    # Two distinct books => median of two terms. If DraftKings still voted three
    # times the median would sit on DraftKings' own number instead of between
    # the two books.
    dk = live_edge._two_sided_devigged_for_row(matched, "over", matched[0])
    pin = live_edge._two_sided_devigged_for_row(matched, "over", matched[-2])
    check("median is between the two BOOKS, not pinned to draftkings",
          round(got[0], 6), round((dk + pin) / 2, 6))
    check("labelled consensus", got[1], "consensus")


def test_freshest_quote_wins_within_a_book():
    """Same book from two providers is the same market participant, so the only
    thing to choose between them is staleness."""
    print("\ndedupe — freshest quote wins")
    fresh = _two_sided("draftkings", "propline", -105, -115, delay=0)
    stale = _two_sided("draftkings", "sharpapi", -200, 170, delay=60)
    got_fresh_first = live_edge._consensus_reference(fresh + stale, "over")
    got_stale_first = live_edge._consensus_reference(stale + fresh, "over")
    expected = live_edge._two_sided_devigged_for_row(fresh + stale, "over", fresh[0])
    check("picks the 0s quote regardless of input order",
          (round(got_fresh_first[0], 6), round(got_stale_first[0], 6)),
          (round(expected, 6), round(expected, 6)))


def test_staleness_ordering():
    print("\ndedupe — staleness ranking")
    check("declared 0s beats declared 60s",
          live_edge._staleness(row("b", "p", "over", -110, delay=0))
          < live_edge._staleness(row("b", "p", "over", -110, delay=60)), True)
    check("undeclared beats declared 60s",
          live_edge._staleness(row("b", "p", "over", -110))
          < live_edge._staleness(row("b", "p", "over", -110, delay=60)), True)
    check("is_delayed with no number sorts worst",
          live_edge._staleness(row("b", "p", "over", -110, is_delayed=True))
          > live_edge._staleness(row("b", "p", "over", -110, delay=999)), True)


def test_excluded_book_still_excluded():
    """task 5.7: the book being measured must not be a term in its own
    benchmark. Deduping must not accidentally reinstate it."""
    print("\ndedupe — exclude_bookmaker still honoured")
    matched = _two_sided("draftkings", "propline", -110, -110) \
        + _two_sided("draftkings", "sharpapi", -110, -110) \
        + _two_sided("pinnacle", "propline", 200, -240)
    got = live_edge._consensus_reference(matched, "over", exclude_bookmaker="draftkings")
    pin = live_edge._two_sided_devigged_for_row(matched, "over", matched[-2])
    check("draftkings excluded from both providers", round(got[0], 6), round(pin, 6))


def test_single_book_is_not_a_consensus():
    """A median of one book is that book's own price — the number this is
    supposed to be independent of."""
    print("\ndedupe — one book is not a consensus")
    matched = _two_sided("draftkings", "propline", -110, -110) \
        + _two_sided("draftkings", "sharpapi", -110, -110)
    check("three providers, one book, excluded -> None",
          live_edge._consensus_reference(matched, "over", exclude_bookmaker="draftkings"), None)


if __name__ == "__main__":
    # The consensus helper is private; resolve its real name once so a rename
    # fails loudly here instead of silently skipping every test.
    name = next((n for n in dir(live_edge)
                 if n.startswith("_consensus") and callable(getattr(live_edge, n))), None)
    if name is None:
        print("no _consensus* function found in live_edge")
        sys.exit(1)
    live_edge._consensus_reference = getattr(live_edge, name)
    print(f"(consensus function under test: {name})")

    test_same_book_from_three_providers_votes_once()
    test_freshest_quote_wins_within_a_book()
    test_staleness_ordering()
    test_excluded_book_still_excluded()
    test_single_book_is_not_a_consensus()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
