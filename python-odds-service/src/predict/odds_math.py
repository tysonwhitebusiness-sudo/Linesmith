"""Direct port of lib/odds/devig.ts + lib/odds/display.ts (americanToDecimal
only) — not a reimplementation. Small enough, and used together often
enough, to live in one file rather than mirroring two near-empty TS files.
"""
import math


def american_to_decimal(price: float | None) -> float | None:
    if price is None or not math.isfinite(price) or price == 0:
        return None
    return price / 100 + 1 if price > 0 else 100 / -price + 1


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
