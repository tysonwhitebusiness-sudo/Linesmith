"""ProviderSpec.min_interval_seconds — the per-provider cadence floor (Phase 1a).

WHAT THIS PROTECTS. A job's interval is one number and the providers inside it do
not share economics. refreshTier1 ticks every 2.5 minutes: correct for SharpAPI
(uncapped, 12/min), ruinous for Propline (1,000/day, 1+N requests per cycle).
Before this, Propline demanded 9,216 requests/day even WITH the markets cache and
died before lunch every single day.

Three properties, and the second and third are the ones that rot silently:

  1. A throttled provider does not fetch.
  2. It does not burn a cap reservation either -- the throttle is checked BEFORE
     try_reserve_*, or a throttled cycle would still consume an entry ticket.
  3. A throttled cycle produces a WARNING, never a silent success.
     gameday.skip_summary() returning a successful shape is exactly what let
     refreshNflJob report healthy for twelve days while producing nothing.

Run with:  python test_provider_throttle.py
"""
import asyncio
import sys

import db
import job_runner
import providers
from providers import FetchOutcome, ProviderSpec

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


class _Recorder:
    """Stands in for every db call run_provider_specs makes."""

    def __init__(self, last_run_age=None):
        self.last_run_age = last_run_age
        self.reserves = 0
        self.snapshots_written = []

    async def read_snapshot_with_age(self, key):
        return None if self.last_run_age is None else ("t", self.last_run_age)

    async def write_snapshot(self, key, payload):
        self.snapshots_written.append(key)

    async def try_reserve_daily(self, pid, n, cap):
        self.reserves += 1
        return True

    async def try_reserve_monthly(self, pid, n, cap, unit="requests"):
        self.reserves += 1
        return True

    async def record_daily_spend(self, pid, **kw):
        pass

    async def record_monthly_spend(self, pid, **kw):
        pass

    async def write_prop_odds(self, rows):
        return len(rows)

    async def write_game_odds_book_lines(self, rows):
        return len(rows)

    async def replace_unresolved_for_provider(self, pid, rows):
        pass

    async def log_system_event(self, *a, **kw):
        pass


def _install(rec):
    for name in ("read_snapshot_with_age", "write_snapshot", "try_reserve_daily",
                 "try_reserve_monthly", "record_daily_spend", "record_monthly_spend",
                 "write_prop_odds", "write_game_odds_book_lines",
                 "replace_unresolved_for_provider", "log_system_event"):
        setattr(db, name, getattr(rec, name))


_original = {n: getattr(db, n, None) for n in (
    "read_snapshot_with_age", "write_snapshot", "try_reserve_daily", "try_reserve_monthly",
    "record_daily_spend", "record_monthly_spend", "write_prop_odds",
    "write_game_odds_book_lines", "replace_unresolved_for_provider", "log_system_event")}


def _restore():
    for n, v in _original.items():
        if v is not None:
            setattr(db, n, v)


def _spec(fetched, min_interval=None, cap_kind="daily"):
    async def fetch(client, games, yield_fn):
        fetched.append(1)
        out = FetchOutcome(provider_id="propline")
        out.requests = 16
        return out

    return ProviderSpec(
        provider_id="propline", enabled=True, fetch=fetch,
        cap_kind=cap_kind, cap_limit=1000, min_interval_seconds=min_interval,
    )


def test_throttled_provider_does_not_fetch():
    print("\nthrottle — inside the interval")
    rec = _Recorder(last_run_age=300)  # 5 min ago
    _install(rec)
    fetched = []
    summary = asyncio.run(job_runner.run_provider_specs(
        None, [], [_spec(fetched, min_interval=25 * 60)]))
    check("did not fetch", len(fetched), 0)
    check("did NOT burn a cap reservation", rec.reserves, 0)
    warned = any("throttled" in w for w in summary.get("warnings", []))
    check("emitted a throttle warning, not a silent success", warned, True)


def test_provider_runs_once_the_interval_has_passed():
    print("\nthrottle — outside the interval")
    rec = _Recorder(last_run_age=25 * 60 + 1)
    _install(rec)
    fetched = []
    asyncio.run(job_runner.run_provider_specs(
        None, [], [_spec(fetched, min_interval=25 * 60)]))
    check("fetched", len(fetched), 1)
    check("reserved against the cap", rec.reserves, 1)
    check("stamped its last-run breadcrumb",
          rec.snapshots_written, ["provider-throttle:propline"])


def test_first_ever_run_is_not_throttled():
    """No breadcrumb yet must mean 'go', not 'wait' — otherwise a fresh worker
    or a cleared cache would never start the provider at all."""
    print("\nthrottle — no previous run recorded")
    rec = _Recorder(last_run_age=None)
    _install(rec)
    fetched = []
    asyncio.run(job_runner.run_provider_specs(
        None, [], [_spec(fetched, min_interval=25 * 60)]))
    check("fetched on a cold breadcrumb", len(fetched), 1)


def test_unthrottled_provider_is_untouched():
    """SharpAPI must keep running every cycle. The whole point of putting the
    floor on the SPEC rather than the JOB is that an uncapped provider in the
    same list is unaffected."""
    print("\nthrottle — provider with no min_interval")
    rec = _Recorder(last_run_age=1)  # 1 second ago
    _install(rec)
    fetched = []
    asyncio.run(job_runner.run_provider_specs(
        None, [], [_spec(fetched, min_interval=None, cap_kind="none")]))
    check("ran despite a 1-second-old breadcrumb", len(fetched), 1)
    check("wrote no throttle breadcrumb", rec.snapshots_written, [])


def test_propline_is_actually_wired_with_a_floor():
    """The mechanism existing is not the same as it being used."""
    print("\nthrottle — jobs.py wiring")
    import provider_matrix
    specs = {s.provider_id: s for s in provider_matrix.specs_for("mlb")}
    check("propline has a floor", specs["propline"].min_interval_seconds, 25 * 60)
    check("sharpapi does NOT", specs["sharpapi"].min_interval_seconds, None)
    check("sharpapi_lines does NOT", specs["sharpapi_lines"].min_interval_seconds, None)
    # 1 events + 15 odds = 16 requests per cycle on a full MLB slate.
    cycles = 24 * 60 * 60 / specs["propline"].min_interval_seconds
    check("stays under the measured 1,000/day cap", int(cycles * 16) < 1000, True)


if __name__ == "__main__":
    try:
        test_throttled_provider_does_not_fetch()
        test_provider_runs_once_the_interval_has_passed()
        test_first_ever_run_is_not_throttled()
        test_unthrottled_provider_is_untouched()
        test_propline_is_actually_wired_with_a_floor()
    finally:
        _restore()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
