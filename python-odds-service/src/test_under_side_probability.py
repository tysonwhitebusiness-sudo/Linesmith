"""Phase 1.1 — the under-side sign, in both places it was wrong.

Audit finding P3 C3: a candidate whose proposition is the under carried the
OVER's probability, and the market reference it was compared against was also
the over's. The bug existed at two independent points, so this covers both:

  1. prop_candidates._prob_for_category — the model's own belief
  2. live_edge._two_sided_devigged_for_row — the market reference

Pure functions only, no network and no database, so this runs in CI (unlike the
model-training tests, which need ~25-50 minutes and live data — see the Phase 0
gate's note on task 3.11).

Run with:  python -u src/test_under_side_probability.py
"""
import sys

sys.path.insert(0, "src")

from db import PropOddsRow  # noqa: E402
from predict.live_edge import _two_sided_devigged_for_row  # noqa: E402
from predict.prop_candidates import _prob_for_category  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected if not isinstance(expected, float) else abs(actual - expected) < 1e-9
    if ok:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r}")


def test_model_probability_follows_the_category() -> None:
    """P(over) = 0.62 means P(under) = 0.38. The over-side categories keep it;
    the under-side categories invert it. All six categories, because the
    category->side map knows all six and a partial fix would be worse than
    none."""
    for category in ("over", "hit", "run"):
        check(f"model prob kept for '{category}'", _prob_for_category(0.62, category), 0.62)
    for category in ("under", "no-hit", "no-run"):
        check(f"model prob inverted for '{category}'", _prob_for_category(0.62, category), 0.38)

    check("None stays None", _prob_for_category(None, "under"), None)
    # An unknown category resolves to no side; keeping the value unchanged is
    # the safe default — inverting on a category we don't understand would be
    # inventing a claim.
    check("unknown category left alone", _prob_for_category(0.62, "banana"), 0.62)


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
        fetched_at="2026-08-28T00:00:00Z",
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


def test_the_two_fixes_agree() -> None:
    """The end-to-end property the audit actually asserts: model_prob and the
    market reference describe the SAME proposition as the category, and the
    resulting edge is the exact negation of the buggy one.

    With over -200 / under +150 the devig is (0.625, 0.375) and a 0.62 model
    over-probability becomes 0.38 on the under. So:

        buggy  (both over-side) : 0.62 - 0.625 = -0.005
        fixed  (both under-side): 0.38 - 0.375 = +0.005

    Equal magnitude, opposite sign — which is the audit's core claim, that the
    displayed number was 'the exact negation of the edge on the bet they are
    being shown'. Asserting the negation rather than a sign is what makes this
    test independent of which example numbers get picked.
    """
    matched = [_row("over", -200), _row("under", +150)]
    over_row, under_row = matched

    market_over = _two_sided_devigged_for_row(matched, "over", over_row)
    market_under = _two_sided_devigged_for_row(matched, "under", under_row)
    model_over = 0.62
    model_under = _prob_for_category(model_over, "under")

    check("model side is the under's", model_under, 0.38)
    check("market side is the under's", market_under < 0.5, True)

    buggy_edge = model_over - market_over      # what both sites produced before
    fixed_edge = model_under - market_under    # what they produce now
    check("fixed edge is the exact negation of the buggy one", round(fixed_edge + buggy_edge, 12), 0.0)
    check("and it is not merely the same number", fixed_edge != buggy_edge, True)


def main() -> bool:
    test_model_probability_follows_the_category()
    test_market_reference_follows_the_side()
    test_the_two_fixes_agree()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
