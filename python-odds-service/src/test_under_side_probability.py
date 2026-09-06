"""The under-side sign on the market reference.

Audit finding P3 C3: a candidate whose proposition is the under carried the
OVER's probability, and the market reference it was compared against was also
the over's. The bug existed at two independent points, and this file used to
cover both.

**Phase 1.1 of docs/master-plan-2026-09-06.md (2026-09-06) removed the first
half.** The model-side fix lived in `prop_candidates._prob_for_category`, and
`prop_candidates.py` was deleted with the rest of the condemned scoring layer.
Nothing inherited it, because nothing needs it: the two surviving prop pipes
(`mlb_prop_serving`, `nhl_prop_serving`) emit `category="projection"` rows and
assert it, so no under-side row is produced anywhere for a probability to be
inverted on. Re-adding an inversion helper with no caller would be carrying a
fix for a bug that can no longer occur.

What remains here is the half that still has live code under it:
`price_resolution._two_sided_devigged_for_row` — the market reference. When
Phase 2 puts a probability next to an implied price on Scan, the "P(over) +
P(under) = 1.0" item in the master plan's Phase 8 truthfulness list applies to
whatever that surface renders, and this file is where its market-side half is
pinned.

Pure functions only, no network and no database, so this runs in CI (unlike the
model-training tests, which need ~25-50 minutes and live data — see the Phase 0
gate's note on task 3.11).

Run with:  python -u src/test_under_side_probability.py
"""
import sys
from datetime import datetime, timezone

sys.path.insert(0, "src")

from db import PropOddsRow  # noqa: E402
from predict.price_resolution import _two_sided_devigged_for_row  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected if not isinstance(expected, float) else abs(actual - expected) < 1e-9
    if ok:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r}")


def _row(side: str, american: int) -> PropOddsRow:
    return PropOddsRow(
        id=1,
        provider_id="test",
        game_id="g1",
        subject_id="s1",
        subject_name="Test Player",
        market_key="hits",
        line=0.5,
        side=side,
        bookmaker="testbook",
        american_odds=american,
        decimal_odds=None,
        # A CURRENT timestamp, not a hardcoded one. Phase 1.2a taught this the
        # hard way: once _too_stale started checking real row age, a fixture
        # pinned to a fixed date aged past the 30-minute threshold and
        # _two_sided_devigged_for_row began returning None — so this file
        # started failing on a change that had nothing to do with the sign it
        # tests. A fixture that decays with the calendar is a time bomb.
        fetched_at=datetime.now(timezone.utc).isoformat(),
        is_delayed=False,
        delay_seconds=None,
    )


def test_market_reference_follows_the_side() -> None:
    """A genuine two-sided price devigs to two probabilities summing to 1.
    Whichever side is asked for must come back — not always the over's."""
    over = _row("over", -200)   # heavy favourite
    under = _row("under", +150)
    matched = [over, under]

    p_over = _two_sided_devigged_for_row(matched, "over", over)
    p_under = _two_sided_devigged_for_row(matched, "under", under)

    check("over side returns the over's probability", p_over is not None and p_over > 0.5, True)
    check("under side returns the under's probability", p_under is not None and p_under < 0.5, True)
    check("the two sides sum to 1", round(p_over + p_under, 9), 1.0)

    # The regression itself: before the fix both calls returned the same number.
    check("the two sides are not the same number", p_over != p_under, True)


def test_the_reference_is_not_symmetric_by_accident() -> None:
    """The property the audit actually asserts, restated for the surviving
    half: asking for the under returns a genuinely different number from the
    over, and the gap is real rather than a rounding artefact.

    With over -200 / under +150 the devig is (0.625, 0.375). Before the fix
    both calls returned 0.625, so any comparison made against the under-side
    reference was made against the over's. Asserting the exact difference
    rather than a sign keeps this independent of the example numbers.
    """
    matched = [_row("over", -200), _row("under", +150)]
    over_row, under_row = matched

    market_over = _two_sided_devigged_for_row(matched, "over", over_row)
    market_under = _two_sided_devigged_for_row(matched, "under", under_row)

    check("over reference", round(market_over, 9), 0.625)
    check("under reference", round(market_under, 9), 0.375)
    check("the difference is the full 0.25, not zero", round(market_over - market_under, 9), 0.25)


def main() -> bool:
    test_market_reference_follows_the_side()
    test_the_reference_is_not_symmetric_by_accident()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
