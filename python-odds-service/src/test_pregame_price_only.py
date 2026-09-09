"""A pick's entry price must be a price somebody could actually have taken.

Phase 3.5 of docs/master-plan-2026-09-06.md (2026-09-08).

WHAT WENT WRONG. Both price-attach paths recorded whatever the book was
quoting when the job happened to run. That job runs on a cycle, so when it ran
during a game it wrote an IN-PLAY price into the pick's entry price — and
`attach_moneyline_price` writes once behind a `price IS NULL` guard, so the
first one in was permanent.

Measured 2026-09-08 on `game_odds_book_lines`, MLB moneylines, joined to each
game's own commence_time:

    implausible prices (|odds| >= 1000):  70 rows, 70 fetched AFTER first
                                          pitch — 100.0%
    ordinary prices    (|odds| <  1000): 629 rows, 537 after — 85.4%

That table is overwhelmingly a post-commence snapshot. A moneyline swings to
-10000 once a team has all but won, so those rows are REAL prices; they are
simply not prices anybody could have bet at pick time. One game carried betmgm
home -200, fanduel home +215 and hardrockbet home -10000 side by side, which is
only possible across different in-game moments.

WHAT IT COST. 22 of 291 MLB picks carried an entry price of |odds| >= 1000,
nine at exactly -10000 — a 99% implied probability sitting in the same row as a
pinnacle market probability of 0.50. `clv_backtest` then compared those against
a genuine pregame close and reported closing-line value of -57 probability
points on individual picks, dragging the measured mean to -0.079. **The
measurement was broken, which is not the same as the model being broken**, and
the difference matters because the whole point of Phase 3.5 is deciding whether
the game model ships.

WHY IT HID. `_market_prob_for`, in the same file and reading the same rows,
was never affected — it requires BOTH sides from the SAME book and de-vigs
them, so a lone in-play row cannot satisfy it and it falls through to a book
with a sane two-sided price. So one column of `game_picks` was right while the
column beside it was wrong, which is exactly the shape of thing that survives
review.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from predict import generic_price_attach as G  # noqa: E402
from predict import odds_lines_cycle as O  # noqa: E402

_failures = 0


def check(label, got, want):
    global _failures
    ok = got == want
    if not ok:
        _failures += 1
    print(f"{'PASS' if ok else 'FAIL'}: {label}" + ("" if ok else f"  got {got!r}, want {want!r}"))


class _Row:
    """Stands in for db.GameOddsBookLineRow."""

    def __init__(self, bookmaker, odds, fetched_at, game_id="G1",
                 market="moneyline", side="home", point=None):
        self.bookmaker = bookmaker
        self.american_odds = odds
        self.decimal_odds = None
        self.fetched_at = fetched_at
        self.game_id = game_id
        self.market = market
        self.side = side
        self.point = point


FIRST_PITCH = datetime(2026, 9, 8, 23, 5, tzinfo=timezone.utc)
BEFORE = FIRST_PITCH - timedelta(hours=3)
AFTER = FIRST_PITCH + timedelta(hours=2)


def test_an_in_play_price_is_never_returned_as_an_entry():
    """THE DEFECT, in the exact shape it shipped."""
    rows = [
        _Row("hardrockbet", -10000, AFTER),   # 7th inning, team all but won
        _Row("pinnacle", -120, BEFORE),       # the real pregame price
    ]
    got = G._reference_row(rows, "G1", "moneyline", "home", FIRST_PITCH)
    check("the pregame price is chosen over the in-play one",
          got.american_odds, -120)

    # ...and with no commence_time the old behaviour is still reachable, which
    # is why every call site passes one.
    #
    # NOTE both books here are deliberately NON-SHARP. With a sharp book in the
    # set (pinnacle above) the priority loop returns it whatever its timestamp,
    # so the fallback `max(fetched_at)` branch — the one that actually picked
    # in-play prices in production — never runs and the test proves nothing.
    unsharp = [
        _Row("hardrockbet", -10000, AFTER),
        _Row("bovada", -120, BEFORE),
    ]
    old = G._reference_row(unsharp, "G1", "moneyline", "home")
    check("without a commence_time the newest row wins, in-play or not",
          old.american_odds, -10000)
    new = G._reference_row(unsharp, "G1", "moneyline", "home", FIRST_PITCH)
    check("with one, the same set yields the pregame price",
          new.american_odds, -120)


def test_no_pregame_price_returns_nothing_rather_than_a_wrong_one():
    rows = [_Row("hardrockbet", -10000, AFTER), _Row("betmgm", -8000, AFTER)]
    check("all-in-play rows yield no reference price at all",
          G._reference_row(rows, "G1", "moneyline", "home", FIRST_PITCH), None)


def test_sharp_priority_still_applies_among_pregame_rows():
    """The fix must not disturb which book wins once the field is legal."""
    rows = [
        _Row("someotherbook", -150, BEFORE),
        _Row("pinnacle", -145, BEFORE),
        _Row("pinnacle", -9000, AFTER),      # same book, in-play: excluded
    ]
    got = G._reference_row(rows, "G1", "moneyline", "home", FIRST_PITCH)
    check("a sharp book still wins among pregame rows", got.bookmaker, "pinnacle")
    check("and it is that book's PREGAME price", got.american_odds, -145)


def test_fetched_before_handles_both_shapes_and_naive_datetimes():
    """`fetched_at` arrives as a datetime or an ISO string depending on driver
    path; a naive/aware comparison would raise rather than return False."""
    check("aware datetime before first pitch",
          G._fetched_before(_Row("b", -110, BEFORE), FIRST_PITCH), True)
    check("aware datetime after first pitch",
          G._fetched_before(_Row("b", -110, AFTER), FIRST_PITCH), False)
    check("ISO string with Z suffix",
          G._fetched_before(_Row("b", -110, "2026-09-08T20:05:00Z"), FIRST_PITCH), True)
    check("naive datetime is treated as UTC rather than raising",
          G._fetched_before(_Row("b", -110, BEFORE.replace(tzinfo=None)), FIRST_PITCH), True)
    check("a missing fetched_at is not pregame",
          G._fetched_before(_Row("b", -110, None), FIRST_PITCH), False)
    check("an unparseable timestamp is not pregame",
          G._fetched_before(_Row("b", -110, "not a date"), FIRST_PITCH), False)


def test_the_mlb_path_refuses_to_price_a_started_game():
    """MLB attaches from the live provider feed, not from book_lines, so it
    needed its own guard — same defect, different route."""
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
    check("a game that started two hours ago is closed to pricing",
          O._has_started(past), True)
    check("a game four hours away is still priceable",
          O._has_started(future), False)
    check("a missing commence_time does NOT block pricing",
          O._has_started(None), False)
    check("an unparseable commence_time does NOT block pricing",
          O._has_started("not a date"), False)


def test_both_call_sites_pass_a_commence_time():
    """A guard nothing passes an argument to is not a guard."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "predict", "generic_price_attach.py"), encoding="utf-8").read()
    check("moneyline call site passes commence_time",
          '_reference_row(rows, game_id, "moneyline", ml_side, pick.commence_time)' in src, True)
    check("total call site passes commence_time",
          '_reference_row(rows, game_id, "total", total_side, pick.commence_time)' in src, True)
    mlb = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "predict", "odds_lines_cycle.py"), encoding="utf-8").read()
    check("the MLB cycle skips a started game before attaching anything",
          "if _has_started(pick.commence_time):" in mlb, True)


def main() -> bool:
    test_an_in_play_price_is_never_returned_as_an_entry()
    test_no_pregame_price_returns_nothing_rather_than_a_wrong_one()
    test_sharp_priority_still_applies_among_pregame_rows()
    test_fetched_before_handles_both_shapes_and_naive_datetimes()
    test_the_mlb_path_refuses_to_price_a_started_game()
    test_both_call_sites_pass_a_commence_time()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
