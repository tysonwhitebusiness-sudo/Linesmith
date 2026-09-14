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

    def __init__(self, last_run_age=None, active_scopes=0):
        self.last_run_age = last_run_age
        self.active_scopes = active_scopes
        self.keys_read = []
        self.reserves = 0
        self.snapshots_written = []

    async def read_snapshot_with_age(self, key):
        self.keys_read.append(key)
        return None if self.last_run_age is None else ("t", self.last_run_age)

    async def count_fresh_snapshots(self, prefix, max_age):
        return self.active_scopes

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
    for name in ("read_snapshot_with_age", "count_fresh_snapshots", "write_snapshot", "try_reserve_daily",
                 "try_reserve_monthly", "record_daily_spend", "record_monthly_spend",
                 "write_prop_odds", "write_game_odds_book_lines",
                 "replace_unresolved_for_provider", "log_system_event"):
        setattr(db, name, getattr(rec, name))


_original = {n: getattr(db, n, None) for n in (
    "read_snapshot_with_age", "count_fresh_snapshots", "write_snapshot", "try_reserve_daily", "try_reserve_monthly",
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


def _paced_spec(fetched, scope):
    async def fetch_keyed(client, games, yield_fn, key):
        fetched.append(1)
        out = FetchOutcome(provider_id="propline")
        out.requests = 2
        return out

    return ProviderSpec(
        provider_id="propline", enabled=True, fetch=None, fetch_keyed=fetch_keyed,
        pool=(("propline_k1", "key"),), cap_kind="daily", cap_limit=1000,
        cost_per_cycle=lambda games: 2, min_interval_seconds=25 * 60, throttle_scope=scope,
    )


def _with_pace(seconds, fn):
    import pace
    original = pace.next_interval

    async def fixed(*a, **kw):
        return seconds

    pace.next_interval = fixed
    try:
        return fn()
    finally:
        pace.next_interval = original


def test_each_sport_has_its_own_clock():
    """2026-09-14: one shared `provider-throttle:propline` let refreshTier1 (every
    150s) take every window, and NFL's last Propline row was 32 hours old."""
    print("\nfair share — a clock per sport")
    rec = _Recorder(last_run_age=None, active_scopes=0)
    _install(rec)
    fetched = []
    _with_pace(600, lambda: asyncio.run(job_runner.run_provider_specs(None, [], [_paced_spec(fetched, "nfl")])))
    check("fetched", len(fetched), 1)
    check("stamped the SPORT's clock", rec.snapshots_written, ["provider-throttle:propline:nfl"])
    check("read the sport's clock, never the shared one", "provider-throttle:propline" in rec.keys_read, False)


def test_shared_budget_stretches_each_sports_wait():
    """k active sports each wait k times the paced interval, so together they
    spend at the pacer's rate rather than k times it."""
    print("\nfair share — k sports share the budget's pace")
    # Paced 600s; three sports active (this one included, stamped 1,500s ago):
    # the wait is 1,800s, so a run 1,500s after the last is still throttled.
    rec = _Recorder(last_run_age=1500, active_scopes=3)
    _install(rec)
    fetched = []
    summary = _with_pace(600, lambda: asyncio.run(job_runner.run_provider_specs(None, [], [_paced_spec(fetched, "mlb")])))
    check("throttled at 3 x 600s", len(fetched), 0)
    check("warning names the stretched wait", any("required 1800s" in w for w in summary.get("warnings", [])), True)

    rec = _Recorder(last_run_age=1801, active_scopes=3)
    _install(rec)
    fetched = []
    _with_pace(600, lambda: asyncio.run(job_runner.run_provider_specs(None, [], [_paced_spec(fetched, "mlb")])))
    check("runs once 3 x 600s has passed", len(fetched), 1)


def test_a_starved_sport_counts_itself():
    """A sport whose own stamp is stale is not in the fresh count, but it is
    still a consumer: k must include it."""
    print("\nfair share — the starved sport")
    rec = _Recorder(last_run_age=None, active_scopes=1)  # only MLB fresh; NFL never ran
    _install(rec)
    fetched = []
    _with_pace(600, lambda: asyncio.run(job_runner.run_provider_specs(None, [], [_paced_spec(fetched, "nfl")])))
    check("a never-run sport fetches immediately", len(fetched), 1)


def test_budget_paced_providers_are_scoped_by_sport():
    print("\nfair share — provider_matrix wiring")
    import provider_matrix
    nfl = {s.provider_id: s for s in provider_matrix.specs_for("nfl")}
    check("propline scoped to nfl", nfl["propline"].throttle_scope, "nfl")
    check("parlayapi scoped to nfl", nfl["parlayapi"].throttle_scope, "nfl")
    check("sharpapi keeps no clock of its own", nfl["sharpapi"].throttle_scope, None)


if __name__ == "__main__":
    try:
        test_each_sport_has_its_own_clock()
        test_shared_budget_stretches_each_sports_wait()
        test_a_starved_sport_counts_itself()
        test_budget_paced_providers_are_scoped_by_sport()
        test_throttled_provider_does_not_fetch()
        test_provider_runs_once_the_interval_has_passed()
        test_first_ever_run_is_not_throttled()
        test_unthrottled_provider_is_untouched()
        test_propline_is_actually_wired_with_a_floor()
    finally:
        _restore()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
