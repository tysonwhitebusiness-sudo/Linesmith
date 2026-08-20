"""Process-wide, per-provider rate limiting — mirrors lib/odds/props/budget.ts's
`minuteWindows` Map exactly: one shared, module-level state every caller of a
given provider draws from, not a counter local to whichever job/function
happens to be calling.

This was a real bug in the first pass of this harness: fetch_sportsgameodds
tracked its own window per call, so SportsGameOddsJob, NflJob, and CfbJob
each thought they had a fresh 10/min allowance even when they fired back to
back against the same real vendor-side counter. Confirmed live: the exact
same 5 SportsGameOdds event IDs 429'd in two separate runs 48 minutes apart —
not random rate pressure, but this specific structural gap.
"""
import time

_windows: dict[str, tuple[float, int]] = {}  # provider_id -> (window_start_monotonic, count_in_window)


def within_per_minute_rate(provider_id: str, rate_per_min: int) -> bool:
    """Check-and-consume, same semantics as budget.ts's withinPerMinuteRate:
    returns True and spends a token if capacity exists (resetting the window
    if it's expired), False (no token spent) if the window is already full."""
    now = time.monotonic()
    window_start, count = _windows.get(provider_id, (now, 0))
    if now - window_start >= 60.0:
        _windows[provider_id] = (now, 1)
        return True
    if count >= rate_per_min:
        return False
    _windows[provider_id] = (window_start, count + 1)
    return True


def has_capacity(provider_id: str, rate_per_min: int) -> bool:
    """Peek without consuming — same role as budget.ts's hasPerMinuteCapacity:
    used at a yield point to decide whether a wait is even needed, without
    spending a token just by checking."""
    now = time.monotonic()
    window_start, count = _windows.get(provider_id, (now, 0))
    if now - window_start >= 60.0:
        return True
    return count < rate_per_min


def seconds_until_capacity(provider_id: str) -> float:
    """How long until the current window resets — the real duration a
    pacing wait needs to cover, used both for a plain sleep and to bound how
    long a yield point should keep checking for other due work."""
    now = time.monotonic()
    window_start, _ = _windows.get(provider_id, (now, 0))
    elapsed = now - window_start
    return max(0.0, 60.0 - elapsed)
