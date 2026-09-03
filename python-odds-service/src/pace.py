"""Budget-aware, proximity-weighted pacing — the allocator half of Phase 1f.

WHAT THIS REPLACES. A fixed `min_interval_seconds` per provider: Propline 25
minutes, ParlayAPI 45. Those numbers were derived from a budget divided by a
whole day, so they spend the same at 4am as at 6:55pm, and they keep spending at
the same rate whether the budget is untouched or nearly gone. Two consequences:

  Budget burned on nothing. A flat 25-minute floor spends ~58 cycles a day
  regardless of whether any game is close. Overnight cycles cost real quota and
  return prices for games ten hours away.

  No backoff. If a heavy slate eats 80% of Propline's daily budget by noon, the
  fixed floor carries on at the same rate and the cap dies mid-afternoon — the
  same shape as the original failure this phase exists to fix, just slower.

THE RULE. Spend what remains, over the time that remains, weighted toward when
games actually start:

    interval = (remaining_period / remaining_cycles) / proximity_weight

`remaining_cycles` is remaining_budget / cost_per_cycle, so the pacer is
SELF-TUNING: it reads real spend from provider_usage rather than assuming a
consumption rate. No calibration constant to get wrong, and no dependence on
post-deploy data to design — if a provider turns out cheaper than expected, the
interval tightens on its own.

WHY IT CANNOT SPEND FASTER THAN THE BUDGET ALLOWS. The base interval already
divides the whole remaining budget across the whole remaining period, so the
proximity weight only ever redistributes *within* that envelope: it borrows from
quiet hours to pay for busy ones. Writing B for remaining budget, T for the
seconds left in the period and w for the weight, the interval is T*c/(B*w), so
dB/dT = B*w/T and therefore

    B(T) = B0 * (T/T0) ** w

which reaches zero exactly AS the period ends, for any w. The weight sets the
SHAPE of the spend curve and never the total: at w=3 seven eighths of the budget
is gone by the halfway point, but the total is still the budget.

That is the continuous statement. Discretely there is one leak, and it is
handled rather than tolerated: a cycle starting one second before the period
ends still costs a whole cycle, which at HOT was measured overspending a
1,000/day budget by 8. Hence the remaining_budget < cost_per_cycle guard below —
a cycle that cannot pay for itself is not proposed. See test_pace.py, which runs
whole simulated days at three weights and three cost profiles.

This does NOT replace the cap reservation in job_runner. That is the hard stop
and stays authoritative; this only decides how fast to approach it.
"""
import calendar
from datetime import datetime, timedelta, timezone

import db

# Proximity bands, in hours before a game starts. Chosen to match gameday.py's
# existing HOT/WARM thresholds rather than inventing a third set of numbers —
# the tier gate already decides fetch/skip on those, and disagreeing with it
# would produce two schedulers pulling in different directions.
_HOT_HOURS = 6.0
_WARM_HOURS = 24.0

# How much the interval tightens or relaxes. Deliberately modest: this
# redistributes within a fixed budget, so an aggressive weight buys a slightly
# tighter close at the cost of much longer gaps earlier, and a stale price four
# hours out is still worth having.
_WEIGHT_HOT = 3.0
_WEIGHT_WARM = 1.0
_WEIGHT_COLD = 0.25

# Never faster than this regardless of budget — a floor against a provider with
# a huge cap being hammered, and against divide-by-small-number blowups.
_MIN_INTERVAL = 120.0
# Never slower than this: past a point, waiting longer stops saving anything
# useful and just means a sport goes uncovered. Applies to the PACED interval
# only — the two no-budget guards below deliberately return longer waits, since
# "a sport goes uncovered" is not an argument for spending money that is gone.
_MAX_INTERVAL = 6 * 60 * 60.0


def _hours_until_next_start(games, now: datetime) -> float | None:
    """Hours until the soonest game that has NOT started. None if none remain."""
    best = None
    for g in games:
        raw = getattr(g, "game_date", None)
        if not raw:
            continue
        try:
            start = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if start <= now:
            continue
        delta = (start - now).total_seconds() / 3600.0
        if best is None or delta < best:
            best = delta
    return best


def proximity_weight(games, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    hours = _hours_until_next_start(games, now)
    if hours is None:
        return _WEIGHT_COLD
    if hours <= _HOT_HOURS:
        return _WEIGHT_HOT
    if hours <= _WARM_HOURS:
        return _WEIGHT_WARM
    return _WEIGHT_COLD


def _period_remaining_seconds(cap_kind: str, now: datetime) -> float:
    """Seconds until this budget resets.

    Propline resets at UTC MIDNIGHT rather than on a rolling 24h window —
    measured from its own `x-daily-reset` header — so a daily budget is paced
    against the calendar day, not against 86,400 seconds from now.
    """
    if cap_kind == "daily":
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return max(60.0, (tomorrow - now).total_seconds())
    # Monthly: to the first of next month.
    if now.month == 12:
        nxt = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        nxt = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return max(60.0, (nxt - now).total_seconds())


def _period_length_seconds(cap_kind: str, now: datetime) -> float:
    """The WHOLE period, not the part of it that remains.

    The no-budget guards return this, and the difference is load-bearing.
    job_runner throttles on `elapsed_since_last_fetch >= required_wait`, so a
    returned wait is measured from the LAST FETCH — not from now. A guard
    returning "seconds until the reset" (measured from now) therefore expires at
    `last + (reset - now)`, which is strictly EARLIER than the reset, and the
    throttle releases a fetch the provider cannot pay for. Measured: a 1,000/day
    budget at 16/cycle ran 63 cycles for 1,008 spent.

    The whole period length is >= (reset - last) for any `last` inside the
    current period, so it cannot expire early no matter when the last fetch was.
    It can be conservative by up to one elapsed-since-last — harmless, because
    the guard stops firing the instant the budget resets, and the normal
    interval that replaces it is then already long overdue.
    """
    if cap_kind == "daily":
        return 86_400.0
    days = calendar.monthrange(now.year, now.month)[1]
    return days * 86_400.0


async def next_interval(
    provider_id: str,
    cap_kind: str,
    cap: int | None,
    cost_per_cycle: float,
    games,
    now: datetime | None = None,
    unit: str = "requests",
    pool_ids: list[str] | None = None,
) -> float:
    """Seconds this provider should wait before its next fetch.

    Returns _MIN_INTERVAL for an uncapped provider — SharpAPI has no daily or
    monthly budget to ration, so pacing it would only throw away free data.

    POOLED PROVIDERS MUST PASS `pool_ids`, and it is not optional in practice.
    job_runner charges a pooled fetch to the KEY that served it (`propline_k1`),
    never to the spec (`propline`), so pacing against the spec id reads a
    provider_usage row nothing ever writes: usage is 0 forever, the budget looks
    untouched, and the pacer never backs off — silently discarding the whole
    self-tuning property this module exists for. With `pool_ids` the budget is
    the POOL: `cap` per provisioned key, summed, minus what every key has spent.
    That is also the correct number to spread — two Propline keys really are
    2,000/day, and pacing them as 1,000 wastes half the pool.

    Only PROVISIONED keys count. An unprovisioned slot (PARLAYAPI_NBA_KEY, at
    time of writing) contributes no budget, matching job_runner's reservation
    loop, which skips a falsy key rather than failing the pool.
    """
    now = now or datetime.now(timezone.utc)
    if cap_kind == "none" or not cap:
        return _MIN_INTERVAL

    ids = list(pool_ids) if pool_ids else [provider_id]
    # PER-KEY remaining, summed — NOT total_cap minus total_used. Budget is not
    # fungible across keys: each has its own cap, so a key that is OVER its cap
    # must contribute zero, never a negative that eats another key's headroom.
    # Measured 2026-09-03: sgo_k1 sat at 2500 against a 2000 soft cap (the
    # vendor's real limit is 2500) while sgo_k2 had 636 left under the same soft
    # cap. The naive form computed 4000-3864 = 136 and declared a 177-object CFB
    # cycle unaffordable, suppressing SportsGameOdds on CFB for the rest of the
    # month over an overage on a DIFFERENT key. The correct 636 affords it.
    remaining_budget = 0
    for pid in ids:
        used = int((await db.daily_status(pid, cap) if cap_kind == "daily"
                    else await db.monthly_status(pid, cap, unit=unit)) or 0)
        remaining_budget += max(0, cap - used)
    if remaining_budget <= 0:
        # Exhausted: wait for the RESET. Deliberately NOT clamped by
        # _MAX_INTERVAL, and deliberately the whole period rather than the part
        # of it that remains — see the notes on _period_length_seconds and on
        # the affordability guard below.
        return _period_length_seconds(cap_kind, now)

    if remaining_budget < cost_per_cycle:
        # Cannot afford a WHOLE cycle. Without this the pacer proposes one final
        # cycle it knows it cannot pay for: measured at HOT, a 1,000/day budget
        # at 16/cycle ran 63 cycles for 1,008 spent, and a 2,000 budget at
        # 179/cycle ran 12 for 2,148. The continuous-time curve reaches zero
        # exactly at the period end, but a DISCRETE cycle that starts one second
        # inside the period still costs a full cycle. Nothing downstream stops
        # it: the reservation takes ONE unit as an entry ticket, not the cycle's
        # real cost (see CLAUDE.md — a provider's true request count is unknown
        # until after the fetch), so a 179-request cycle passes a gate that only
        # checked for 1. This guard is the only thing that declines it.
        #
        # NOT clamped by _MAX_INTERVAL, and that clamp is what made this guard
        # ineffective on its first version. _MAX_INTERVAL exists so a PACED
        # interval cannot grow until a sport goes uncovered — reasoning that
        # does not apply when there is no budget left to cover it with. Clamped
        # to 6h, job_runner's throttle sees elapsed >= required_wait after six
        # hours and fetches regardless, spending a full 179-request CFB cycle
        # against 31 remaining; the 1-unit entry-ticket reservation does not
        # stop it either, by design. Returning the whole period means the
        # throttle keeps skipping until the budget actually resets, and since
        # required_wait is recomputed every tick it drops back to a normal
        # cadence the moment it does.
        return _period_length_seconds(cap_kind, now)

    remaining_cycles = max(1.0, remaining_budget / max(1.0, cost_per_cycle))
    base = _period_remaining_seconds(cap_kind, now) / remaining_cycles
    interval = base / proximity_weight(games, now)
    return max(_MIN_INTERVAL, min(_MAX_INTERVAL, interval))
