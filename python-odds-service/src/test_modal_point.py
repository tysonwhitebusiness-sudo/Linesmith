"""Phase 5.5 — best total/spread must come from ONE point.

Audit finding P3 C1: "best total" and "best spread" maximised each side across
EVERY book regardless of which line that book was quoting, then reported
whichever side's point happened to win. So the best over could be one book's
7.5 and the best under another book's 9.5, presented as a single proposition —
and the de-vigged probability derived from that pair is meaningless, because
the two prices are for two different bets.

This is not hypothetical: live MLB data carries 21 distinct total points across
four sources for the same set of games.

The fixture below is built so the OLD code demonstrably gets it wrong — the
highest over price sits at a different point from the highest under price — and
the test asserts both that the new code picks one point and that the pair it
returns de-vigs to something sane. A test that only checked "a point is
returned" would have passed before the fix too.

Pure functions, no network, no database, so this runs in CI (Q20).

Run with:  python -u src/test_modal_point.py
"""
import sys

sys.path.insert(0, "src")

from predict.mlb_game_lines import _modal_point, summarise_odds_event  # noqa: E402
from predict.odds_math import american_to_decimal  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


def _book(title, *, point=None, over=None, under=None, sh=None, shp=None, sa=None, sap=None):
    markets = []
    if point is not None:
        markets.append({
            "key": "totals",
            "outcomes": [
                {"name": "Over", "point": point, "price": over},
                {"name": "Under", "point": point, "price": under},
            ],
        })
    if sh is not None:
        markets.append({
            "key": "spreads",
            "outcomes": [
                {"name": "Home Team", "point": sh, "price": shp},
                {"name": "Away Team", "point": sa, "price": sap},
            ],
        })
    return {"title": title, "markets": markets}


def _event(books):
    return {"id": "t1", "home_team": "Home Team", "away_team": "Away Team", "bookmakers": books}


def test_totals_come_from_one_point():
    """The trap: the best over is at 9.5, the best under is at 7.5."""
    print("\ntotals: best over and best under must share a point")
    line = summarise_odds_event(_event([
        _book("A", point=7.5, over=-110, under=-110),
        _book("B", point=9.5, over=400, under=-600),   # highest over, wrong line
        _book("C", point=7.5, over=-105, under=-115),  # best over AT the modal point
        _book("D", point=7.5, over=-120, under=100),   # best under AT the modal point
    ]))
    check("modal point is 7.5 (3 of 4 books)", line.total.point, 7.5)
    check("over price is C's -105, not B's +400", line.total.over_price, -105)
    check("under price is D's +100", line.total.under_price, 100)
    check("two different books, so no single book is named", line.total.book, None)

    # The real payoff: the pair now de-vigs to a sane overround. The old
    # pairing (+400 over, +100 under) implies 0.20 + 0.50 = 0.70 — a 30%
    # NEGATIVE hold, which no book offers and which would have been fed
    # straight into market_prob.
    implied = 1 / american_to_decimal(line.total.over_price) + 1 / american_to_decimal(line.total.under_price)
    check("overround is a real book's (1.00-1.10)", 1.0 <= round(implied, 4) <= 1.10, True)
    old_implied = 1 / american_to_decimal(400) + 1 / american_to_decimal(100)
    check("the old pairing would have implied < 1 (impossible)", old_implied < 1.0, True)


def test_spreads_come_from_one_point():
    print("\nspreads: best home and best away must share a point")
    line = summarise_odds_event(_event([
        _book("A", sh=-1.5, shp=-110, sa=1.5, sap=-110),
        _book("B", sh=-2.5, shp=350, sa=2.5, sap=-450),   # highest home, wrong line
        _book("C", sh=-1.5, shp=-105, sa=1.5, sap=-115),
        _book("D", sh=-1.5, shp=-120, sa=1.5, sap=100),
    ]))
    check("modal home point is -1.5", line.spread.home_point, -1.5)
    check("away point is its exact mirror", line.spread.away_point, 1.5)
    check("home price is C's -105, not B's +350", line.spread.home_price, -105)
    check("away price is D's +100", line.spread.away_price, 100)


def test_single_book_still_works():
    """The common case must not regress: one book, one point, both sides."""
    print("\none book quoting one line still collapses correctly")
    line = summarise_odds_event(_event([_book("A", point=8.5, over=-108, under=-112)]))
    check("point", line.total.point, 8.5)
    check("over", line.total.over_price, -108)
    check("under", line.total.under_price, -112)
    check("one book, so it IS named", line.total.book, "A")


def test_implausible_price_excluded():
    """Python's summarise_odds_event had no plausibility bound at all, so one
    garbage row could win 'best price' purely by being the largest number.
    Mirrors lib/odds/display.ts's MAX_PLAUSIBLE_DECIMAL_ODDS (task 5.6)."""
    print("\nimplausible prices are excluded from best-price selection")
    line = summarise_odds_event(_event([
        _book("A", point=8.5, over=-110, under=-110),
        _book("B", point=8.5, over=50000, under=-110),  # decimal 501, garbage
    ]))
    check("the +50000 row did not win", line.total.over_price, -110)


def test_modal_point_itself():
    print("\n_modal_point unit cases")
    check("clear mode", _modal_point(iter([7.5, 7.5, 9.5])), 7.5)
    check("tie goes to the lower point (total order)", _modal_point(iter([8, 8, 9, 9])), 8)
    check("Nones ignored", _modal_point(iter([None, 8.5, None, 8.5, 9])), 8.5)
    check("all None -> None", _modal_point(iter([None, None])), None)
    check("empty -> None", _modal_point(iter([])), None)


def main() -> bool:
    test_totals_come_from_one_point()
    test_spreads_come_from_one_point()
    test_single_book_still_works()
    test_implausible_price_excluded()
    test_modal_point_itself()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
