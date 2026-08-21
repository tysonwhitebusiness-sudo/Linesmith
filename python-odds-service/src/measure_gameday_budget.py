"""Numeric worst-case monthly credit cost of gameday.py's tiering, at the
20min outer cadence set in JOB_REGISTRY — verifies the real number instead
of trusting hand arithmetic (2026-08-20). Simulates a real NFL-shaped
18-week regular season (3 real gamedays/week: Thu night, Sun all day, Mon
night) across a 30-day month, tick by tick at the real cadence, and counts
how many ticks would trigger a real paid fetch under gameday.py's own tier
logic. Not a live test — pure simulation of the same compute_tier function
this module actually runs, so it's checking the real code path, not a
reimplementation of it.

Run: ../.venv/Scripts/python.exe measure_gameday_budget.py
"""
from datetime import datetime, timedelta, timezone

from gameday import HOT_AFTER_HOURS, HOT_BEFORE_HOURS, WARM_BEFORE_HOURS, WARM_THROTTLE_SECONDS, compute_tier


class FakeGame:
    def __init__(self, game_date: datetime):
        self.game_date = game_date.isoformat()
        self.is_final = False


def nfl_kickoffs_for_week(week_start: datetime) -> list[datetime]:
    # Thursday night (~1 game), Sunday (~13 games spread 1pm/4:05/4:25/8:20 ET
    # -> UTC), Monday night (~1 game). Real spread, not just one kickoff/day.
    thu = week_start + timedelta(days=3, hours=20)  # Thu 8pm local-ish, UTC offset ignored for this estimate
    sun_kickoffs = [week_start + timedelta(days=6, hours=h) for h in (17, 20, 20.4)]  # 1pm/4pm/4:25pm ET -> UTC approx
    sun_night = week_start + timedelta(days=6, hours=25.3)  # SNF ~8:20pm ET
    mon = week_start + timedelta(days=7, hours=20.3)  # MNF ~8:15pm ET, into next week's Monday
    return [thu, *sun_kickoffs, sun_night, mon]


def simulate(outer_interval_minutes: float, weeks: int = 4) -> dict:
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    kickoffs: list[datetime] = []
    for w in range(weeks + 1):  # +1 so week 4's Monday game is in range for week 3's warm window
        kickoffs.extend(nfl_kickoffs_for_week(start + timedelta(weeks=w)))
    games = [FakeGame(k) for k in kickoffs]

    end = start + timedelta(weeks=weeks)
    tick = start
    step = timedelta(minutes=outer_interval_minutes)

    real_fetches = 0
    hot_ticks = 0
    warm_ticks = 0
    cold_ticks = 0
    last_warm_fetch: float | None = None  # seconds since epoch, simulated

    while tick < end:
        tier = compute_tier(games, now=tick)
        if tier == "hot":
            hot_ticks += 1
            real_fetches += 1
        elif tier == "warm":
            warm_ticks += 1
            now_ts = tick.timestamp()
            if last_warm_fetch is None or (now_ts - last_warm_fetch) >= WARM_THROTTLE_SECONDS:
                real_fetches += 1
                last_warm_fetch = now_ts
        else:
            cold_ticks += 1
        tick += step

    total_ticks = hot_ticks + warm_ticks + cold_ticks
    days_in_month = 30
    monthly_estimate = real_fetches / weeks / 7 * days_in_month
    return {
        "total_ticks": total_ticks,
        "hot_ticks": hot_ticks,
        "warm_ticks": warm_ticks,
        "cold_ticks": cold_ticks,
        "real_fetches_in_window": real_fetches,
        "weeks_simulated": weeks,
        "estimated_per_30_day_month": round(monthly_estimate, 1),
    }


if __name__ == "__main__":
    print(f"HOT_BEFORE_HOURS={HOT_BEFORE_HOURS} HOT_AFTER_HOURS={HOT_AFTER_HOURS} "
          f"WARM_BEFORE_HOURS={WARM_BEFORE_HOURS} WARM_THROTTLE_SECONDS={WARM_THROTTLE_SECONDS}")
    for interval in (20,):
        result = simulate(outer_interval_minutes=interval, weeks=4)
        print(f"\noutright cadence: {interval}min")
        for k, v in result.items():
            print(f"  {k}: {v}")
        limit = 1000
        est = result["estimated_per_30_day_month"]
        print(f"  vs 1000/month hard cap: {est}/1000 = {est/10:.1f}% used, {100 - est/10:.1f}% headroom")
