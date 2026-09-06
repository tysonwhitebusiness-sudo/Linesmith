"""Direct port of lib/odds/devig.ts + lib/odds/display.ts (americanToDecimal
only) — not a reimplementation. Small enough, and used together often
enough, to live in one file rather than mirroring two near-empty TS files.
"""
import math


def american_to_decimal(price: float | None) -> float | None:
    if price is None or not math.isfinite(price) or price == 0:
        return None
    return price / 100 + 1 if price > 0 else 100 / -price + 1


def decimal_to_american(decimal: float | None) -> int | None:
    if decimal is None or not math.isfinite(decimal) or decimal <= 1:
        return None
    return round((decimal - 1) * 100) if decimal >= 2 else round(-100 / (decimal - 1))


# Above this, a decimal price is a bad row, not a real long-shot line —
# direct port of the same constant/reasoning in lib/odds/display.ts,
# confirmed live 2026-08-27 for real: a garbage propline row (tab_au,
# +3300 American, decimal 34) won a naive "best price" MAX comparison for
# a real MLB game's away side purely because +3300 is numerically larger
# than any real book's price. Reuse this one constant everywhere a "best
# available price" picks the max decimal across books, in Python or TS —
# see game_lines_from_book_lines/summarise_odds_event below for two more
# real call sites this same bug class was found in the same session.
MAX_PLAUSIBLE_DECIMAL_ODDS = 30


def is_plausible_decimal_odds(decimal: float | None) -> bool:
    return decimal is not None and math.isfinite(decimal) and decimal > 1 and decimal <= MAX_PLAUSIBLE_DECIMAL_ODDS


def devig_two_way(a_decimal: float | None, b_decimal: float | None) -> tuple[float, float] | None:
    """Standard multiplicative de-vig: each side's raw implied probability
    (1/decimal) divided by the sum of both raw probabilities, so they sum
    to exactly 1.0. Only valid for a genuine two-sided price from the same
    book — mixing books or grading a one-sided price would misrepresent the
    vig. Returns (a, b) matching the TS source's {a, b} shape."""
    if a_decimal is None or b_decimal is None or not math.isfinite(a_decimal) or not math.isfinite(b_decimal):
        return None
    if a_decimal <= 1 or b_decimal <= 1:
        return None
    raw_a = 1 / a_decimal
    raw_b = 1 / b_decimal
    total = raw_a + raw_b
    if total <= 0:
        return None
    return (raw_a / total, raw_b / total)


# ---------------------------------------------------------------------------
# Phase 5.1/5.7 — longshot-aware de-vigging.
#
# `devig_two_way` above is the MULTIPLICATIVE (proportional) method, and until
# now it was the only one Python had. TypeScript has carried power, Shin and
# worst-case in `lib/odds/devigMethods.ts` for some time, with
# `tests/devig-methods.test.ts` asserting that "power and Shin shade the
# longshot relative to multiplicative" — so the model layer was using the
# weakest method in the repo while the frontend had the better ones.
#
# THAT COST WAS MEASURED, not assumed. Phase 5.1 compared each MLB market's
# realised over rate against its own de-vigged price, across 14 markets:
#
#   realised BELOW implied in 14 of 14 markets      (P = 2^-14 under no bias)
#   correlation(|over rate - 50%|, gap)             +0.637
#   markets near 50%   (n=8)   mean gap             1.55pt
#   longshot markets   (n=4)   mean gap             3.33pt
#
# Proportional de-vigging assumes the vig is spread in proportion to
# probability; books load more of it onto longshots, so proportional overstates
# a longshot's true probability — exactly the pattern above. The three largest
# gaps were the three longest shots (stolen bases, doubles, home runs).
#
# Ported here rather than reimplemented: same bisection, same brackets, same
# residual normalisation, so the two languages cannot disagree about a price.
# ---------------------------------------------------------------------------

DEVIG_METHODS = ("multiplicative", "power", "shin", "worst_case")


def _raw_pair(a_decimal, b_decimal):
    if not a_decimal or not b_decimal or a_decimal <= 1.0 or b_decimal <= 1.0:
        return None
    return 1.0 / a_decimal, 1.0 / b_decimal


def devig_power(a_decimal, b_decimal):
    """Find k with a^k + b^k = 1.

    BISECTION, NOT NEWTON: the function is monotone in k over the bracket, so it
    converges without a derivative and cannot diverge on a pathological pair.
    k > 1 whenever there is a real overround, because raising a number below one
    to a larger power makes it smaller. A booksum at or below one has no vig to
    remove and is returned unchanged rather than having one invented.
    """
    raw = _raw_pair(a_decimal, b_decimal)
    if raw is None:
        return None
    a, b = raw
    s = a + b
    if s <= 1.0:
        return a, b
    lo, hi = 1.0, 8.0
    for _ in range(60):
        k = (lo + hi) / 2.0
        if a ** k + b ** k > 1.0:
            lo = k
        else:
            hi = k
    k = (lo + hi) / 2.0
    fa, fb = a ** k, b ** k
    t = fa + fb
    # Bisection lands within ~1e-15 of the root; a pair summing to 0.9999999999
    # would leak into every downstream calculation.
    return fa / t, fb / t


def devig_shin(a_decimal, b_decimal):
    """Solve for the insider proportion z, then normalise.

    z IS BRACKETED IN [0, 0.4). It is a proportion of money from insiders;
    values approaching one are not a market, they are a division by something
    near zero. A real book's z is a couple of percent, and the bracket stops a
    degenerate pair producing a confident absurdity.
    """
    raw = _raw_pair(a_decimal, b_decimal)
    if raw is None:
        return None
    a, b = raw
    s = a + b
    if s <= 1.0:
        return a, b

    def shin_prob(p: float, z: float) -> float:
        return ((z * z + 4.0 * (1.0 - z) * (p * p / s)) ** 0.5 - z) / (2.0 * (1.0 - z))

    lo, hi = 0.0, 0.4
    for _ in range(60):
        z = (lo + hi) / 2.0
        # The sum decreases as z rises, so overshoot means z is too small.
        if shin_prob(a, z) + shin_prob(b, z) > 1.0:
            lo = z
        else:
            hi = z
    z = (lo + hi) / 2.0
    fa, fb = shin_prob(a, z), shin_prob(b, z)
    t = fa + fb
    return fa / t, fb / t


def devig_worst_case(a_decimal, b_decimal):
    """Each side's fair probability is 1 minus the OTHER side's raw implied.

    Assumes the entire margin sits on the other side — the least favourable
    reading for whoever backs this one. A floor, not a model, and the two sides
    deliberately do NOT sum to one: they sum to 2 - S. Normalising would turn a
    conservative bound back into a point estimate and discard the only thing it
    was for.
    """
    raw = _raw_pair(a_decimal, b_decimal)
    if raw is None:
        return None
    a, b = raw
    return max(0.0, 1.0 - b), max(0.0, 1.0 - a)


def devig_by(method: str, a_decimal, b_decimal):
    """One entry point, so a caller holds the method as data, not a branch."""
    if method == "multiplicative":
        return devig_two_way(a_decimal, b_decimal)
    if method == "power":
        return devig_power(a_decimal, b_decimal)
    if method == "shin":
        return devig_shin(a_decimal, b_decimal)
    if method == "worst_case":
        return devig_worst_case(a_decimal, b_decimal)
    raise ValueError(f"unknown de-vig method: {method}")
