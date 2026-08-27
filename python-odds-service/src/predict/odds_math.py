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
