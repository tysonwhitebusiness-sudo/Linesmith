"""Process-wide, per-provider rate limiting — mirrors lib/odds/props/budget.ts's
`minuteWindows` Map: one shared, module-level state every caller of a given
provider draws from, not a counter local to whichever job/function happens
to be calling.

Generalized to an arbitrary window duration (not just 60s), added after a
real production incident: SportsGameOdds's 10/min cap was the only one
wired up, but Odds-API.io has a real, vendor-confirmed 100/hour cap
(`x-ratelimit-limit: 100` in its own response headers) that nothing in this
harness ever read or enforced — Tier 1's 15-per-cycle, every-2.5-min odds
calls generate ~360/hour of demand against that 100/hour ceiling, a 3.6x
overshoot with zero backoff. See docs/phase2-python-service-architecture-2026-08-19.md's
incident writeup for the full root-cause trace.
"""
import time

_windows: dict[str, tuple[float, int]] = {}  # key -> (window_start_monotonic, count_in_window)


def within_rate(key: str, limit: int, window_seconds: float) -> bool:
    """Check-and-consume: returns True and spends a slot if capacity exists
    (resetting the window if expired), False (no slot spent) if the window
    is already full."""
    now = time.monotonic()
    window_start, count = _windows.get(key, (now, 0))
    if now - window_start >= window_seconds:
        _windows[key] = (now, 1)
        return True
    if count >= limit:
        return False
    _windows[key] = (window_start, count + 1)
    return True


def has_capacity(key: str, limit: int, window_seconds: float) -> bool:
    """Peek without consuming."""
    now = time.monotonic()
    window_start, count = _windows.get(key, (now, 0))
    if now - window_start >= window_seconds:
        return True
    return count < limit


def seconds_until_capacity(key: str, window_seconds: float) -> float:
    now = time.monotonic()
    window_start, _ = _windows.get(key, (now, 0))
    return max(0.0, window_seconds - (now - window_start))


def force_exhausted(key: str, limit: int, window_seconds: float) -> None:
    """Called when a REAL 429 comes back despite our own tracking saying
    capacity was available (clock drift, other traffic on the same account,
    a limit that's actually tighter than configured). Immediately marks this
    window as fully spent so nothing else in this process keeps hammering a
    provider that just told us, authoritatively, that it's out of room —
    this is the backoff investigation item 4 found missing: previously a 429
    was just logged and the loop moved on to the next call regardless."""
    now = time.monotonic()
    window_start, _ = _windows.get(key, (now, 0))
    if now - window_start >= window_seconds:
        window_start = now
    _windows[key] = (window_start, limit)
