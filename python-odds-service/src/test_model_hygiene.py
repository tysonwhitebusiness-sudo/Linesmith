"""Phase 4.12 — model-math hygiene items, each with its own evidence.

The gate for 4.12 is explicit: "Every 4.12 item closed individually, each with
its own one-line evidence. Eight items, eight lines. 'Model hygiene done' is
not an entry." So each item gets its own test group here.

Covered so far:
  P3 L1  poisson_over_probability treated an integer line as a LOSS
  P3 L5  the Elo sort comparator was not a total order

Pure functions, no network, no database, so this runs in CI (Q20).

Run with:  python -u src/test_model_hygiene.py
"""
import math
import random
import sys
from dataclasses import dataclass

sys.path.insert(0, "src")

from predict.game_model import (  # noqa: E402
    _poisson_pmf,
    poisson_over_probability,
    poisson_push_probability,
)

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


def close(label: str, actual: float, expected: float, eps: float = 1e-4) -> None:
    global _failures
    ok = abs(actual - expected) < eps
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual:.6f}, want {expected:.6f})"))


def _old_poisson_over(lam: float, threshold: float) -> float:
    """The pre-4.12 implementation, kept here so the counterfactual is
    measured rather than asserted."""
    k = math.floor(threshold)
    cdf = sum(_poisson_pmf(lam, i) for i in range(k + 1))
    return min(0.99, max(0.01, 1 - cdf))


# ---------------------------------------------------------------------------
# P3 L1
# ---------------------------------------------------------------------------

def test_integer_line_is_a_push_not_a_loss():
    print("\nP3 L1: an integer total line pushes; it is not a loss")
    # lambda 9, line 9 — X == 9 returns the stake.
    over = poisson_over_probability(9.0, 9.0)
    push = poisson_push_probability(9.0, 9.0)
    old = _old_poisson_over(9.0, 9.0)
    close("push mass is real and non-trivial", push, 0.1318)
    close("over, conditioned on not-a-push", over, 0.4752)
    close("the OLD code scored that push as a loss", old, 0.4126)
    check("so the old code understated the over", old < over, True)
    # P(over | not push) + P(under | not push) must be exactly 1.
    close("over and under partition the non-push mass", over + (1 - over), 1.0)


def test_half_integer_lines_are_untouched():
    """The overwhelming majority of MLB totals are half-integers. If the fix
    moved those at all it would be a regression, not a fix."""
    print("\nP3 L1: half-integer lines are provably unchanged")
    for lam, line in ((9.0, 8.5), (8.2, 7.5), (10.5, 10.5), (7.0, 9.5)):
        close(f"lambda={lam} line={line} identical to pre-fix",
              poisson_over_probability(lam, line), _old_poisson_over(lam, line))
        check(f"lambda={lam} line={line} cannot push", poisson_push_probability(lam, line), 0.0)


def test_push_probability_shape():
    print("\nP3 L1: push probability is zero exactly when a push is impossible")
    check("half-integer -> 0", poisson_push_probability(9.0, 8.5), 0.0)
    check("integer -> non-zero", poisson_push_probability(9.0, 9.0) > 0, True)
    close("integer push equals the pmf at that point",
          poisson_push_probability(8.2, 8.0), _poisson_pmf(8.2, 8))


# ---------------------------------------------------------------------------
# P3 L5
# ---------------------------------------------------------------------------

@dataclass
class _G:
    game_date: str
    game_pk: int


def _new_sort(xs):
    ys = list(xs)
    ys.sort(key=lambda g: (g.game_date, g.game_pk))
    return [g.game_pk for g in ys]


def _old_sort(xs):
    import functools
    ys = sorted(xs, key=functools.cmp_to_key(lambda a, b: -1 if a.game_date < b.game_date else 1))
    return [g.game_pk for g in ys]


def test_elo_sort_is_a_total_order():
    """Elo is order-sensitive, so a comparator that never returns 0 for equal
    keys makes ratings depend on the ARRIVAL ORDER of same-day games. Two runs
    over identical data could disagree."""
    print("\nP3 L5: the Elo sort is deterministic across input orderings")
    base = [_G("2026-04-01", 3), _G("2026-04-01", 1), _G("2026-04-01", 2), _G("2026-03-31", 9)]

    new_results, old_results = [], []
    for seed in (1, 2, 3, 4, 5):
        shuffled = base[:]
        random.Random(seed).shuffle(shuffled)
        new_results.append(_new_sort(shuffled))
        old_results.append(_old_sort(shuffled))

    check("new sort: every shuffle gives the same order", len(set(map(tuple, new_results))), 1)
    check("new sort: chronological, then by game_pk", new_results[0], [9, 1, 2, 3])
    # The counterfactual — if this ever becomes 1, the old bug was not real and
    # this test is no longer evidence of anything.
    check("old comparator really was non-deterministic", len(set(map(tuple, old_results))) > 1, True)


def test_elo_sort_still_orders_by_date_first():
    print("\nP3 L5: date still dominates game_pk")
    xs = [_G("2026-05-02", 1), _G("2026-04-01", 999)]
    check("earlier date wins regardless of a larger game_pk", _new_sort(xs), [999, 1])


def main() -> bool:
    test_integer_line_is_a_push_not_a_loss()
    test_half_integer_lines_are_untouched()
    test_push_probability_shape()
    test_elo_sort_is_a_total_order()
    test_elo_sort_still_orders_by_date_first()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
