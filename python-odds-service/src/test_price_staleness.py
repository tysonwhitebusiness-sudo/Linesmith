"""Phase 1.2 — a price is stale when it is OLD, not when a provider admits to a
feed delay.

Audit finding P3 C4. `_too_stale` checked only `delay_seconds`, the provider's
advertised feed delay written at fetch time from static config. Measured across
the entire prop_odds table on 2026-08-28, the maximum value present is 60
against a 600 threshold — **the gate had never fired and could not fire**, while
prices 17.5 hours old were being treated as live.

The regression this locks down is subtle: nothing crashes when a staleness gate
silently never fires, and the only symptom is confident numbers computed from
old prices. A test is the only thing that would have caught it.

Run with:  python -u src/test_price_staleness.py
"""
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "src")

from db import PropOddsRow  # noqa: E402
from predict.live_edge import _MAX_ROW_AGE_SECONDS, _too_stale  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r}")


def _row(delay_seconds: int | None, age_minutes: float) -> PropOddsRow:
    fetched = (datetime.now(timezone.utc) - timedelta(minutes=age_minutes)).isoformat()
    return PropOddsRow(
        id=1,
        provider_id="p",
        game_id="g",
        subject_id="s",
        subject_name="n",
        market_key="hits",
        line=0.5,
        side="over",
        bookmaker="b",
        american_odds=-110,
        decimal_odds=None,
        fetched_at=fetched,
        is_delayed=False,
        delay_seconds=delay_seconds,
    )


def test_age_is_what_makes_a_price_stale() -> None:
    check("fresh row, no advertised delay", _too_stale(_row(None, 1)), False)
    check("fresh row, 60s advertised delay", _too_stale(_row(60, 1)), False)
    check("45min old row", _too_stale(_row(None, 45)), True)
    check("17.5h old row — what the audit actually observed", _too_stale(_row(60, 1050)), True)


def test_the_threshold_boundary() -> None:
    just_inside = _MAX_ROW_AGE_SECONDS / 60 - 1
    just_outside = _MAX_ROW_AGE_SECONDS / 60 + 1
    check(f"{just_inside:.0f}min old is usable", _too_stale(_row(None, just_inside)), False)
    check(f"{just_outside:.0f}min old is not", _too_stale(_row(None, just_outside)), True)


def test_advertised_delay_still_counts() -> None:
    """The old check was insufficient, not wrong — a provider that admits to a
    long delay is still untrustworthy even if we fetched its row a second ago.
    Both conditions have to survive."""
    check("fresh row with a 20min advertised delay is stale", _too_stale(_row(20 * 60, 0.1)), True)


def test_missing_timestamp_does_not_gate() -> None:
    """A row with no parseable fetched_at falls back to the delay check alone.
    Treating unknown age as stale would silently drop every row from any
    provider that stops sending timestamps — failing loud beats failing
    closed here, because the delay check still applies."""
    row = _row(None, 1)
    row.fetched_at = ""
    check("unparseable fetched_at falls back to the delay check", _too_stale(row), False)


def main() -> bool:
    test_age_is_what_makes_a_price_stale()
    test_the_threshold_boundary()
    test_advertised_delay_still_counts()
    test_missing_timestamp_does_not_gate()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
