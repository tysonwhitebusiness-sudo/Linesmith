"""pace.next_interval — budget-aware, proximity-weighted cadence (Phase 1f).

WHAT THIS PROTECTS. The allocator replaces a fixed per-provider floor (Propline
25 min, ParlayAPI 45) with an interval derived from real remaining spend. That
makes it self-tuning, and it also makes it capable of a new failure the fixed
floor could not have: spending FASTER than the budget allows. A weight above 1
tightens the interval, and "tighter near a game start" is only safe if the
tightening is genuinely a redistribution rather than an increase.

THE PROPERTY, AND WHY IT HOLDS. Let B be remaining budget, T remaining seconds
in the period, w the proximity weight, c the cost per cycle. The interval is
T*c/(B*w), so budget drains at dB/dt = -c/interval = -B*w/T. With dT/dt = -1
that is dB/dT = B*w/T, which integrates to

    B(T) = B0 * (T/T0) ** w

B reaches zero exactly AS the period ends, for ANY w. The weight sets the SHAPE
of the curve, never the total: at w=3, seven eighths of the budget is gone by
the halfway point, but the total is still the budget. That is the claim pace.py
makes in prose, and test_full_period_never_exceeds_cap is the executable form of
it — run discretely, at three weights and three cost profiles.

WHAT IT ACTUALLY CAUGHT. Writing this test found three defects in pace.py that
every ordering assertion above was blind to, and all three were in the same
place — what to do when there is no budget left:

  1. The affordability guard did not exist. The continuous curve lands on zero,
     but a DISCRETE cycle beginning one second inside the period still costs a
     whole cycle. Measured: 63 cycles for 1,008 against a 1,000 cap.
  2. The guard was then clamped by _MAX_INTERVAL, which made it inert — a broke
     provider waited 6h and fetched anyway. That clamp protects a PACED interval
     from growing until a sport goes uncovered; it has no business applying when
     there is no budget to cover the sport with.
  3. The guard returned seconds-until-reset, measured from `now`. job_runner
     throttles on elapsed-since-LAST-FETCH, so that expires at
     `last + (reset - now)` — strictly before the reset. Fixed by returning the
     whole period LENGTH, which cannot expire early for any `last` in the period.

Defects 2 and 3 were only visible once _simulate_day was rewritten to mirror
job_runner's real recompute-every-tick loop instead of a sleep-then-spend one.
A simulation that models the caller wrongly agrees with a bug in the callee.

The MIN_INTERVAL floor remains a deliberate deviation from the curve, in the
SAFE direction: clamped to 120s a provider whose curve wants to go faster simply
does not, and underspends. test_min_interval_can_overrun pins that direction so
it stays a known bounded fact, and it is why job_runner's cap RESERVATION stays
the hard stop and this stays advisory.

Run with:  python test_pace.py
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone

import db
import pace

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def check_near(label: str, actual: float, expected: float, tol: float) -> None:
    global _failures
    if abs(actual - expected) <= tol:
        print(f"  PASS  {label} ({actual:.2f})")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual:.2f}, expected {expected:.2f} +/- {tol}")


class _Game:
    """Only the attribute pace reads. Real Game objects carry far more."""

    def __init__(self, start: datetime):
        self.game_date = start.isoformat()


class _Bad:
    """A row whose game_date never parses. Real data has these."""

    game_date = "not a timestamp"


class _Budget:
    """Stands in for provider_usage. Patches BOTH status readers so a test never
    depends on which cap_kind it happens to exercise.

    `per_id` overrides `used` for named provider_ids, which is the only way to
    exercise the pooled path: the whole point there is that spend lands under
    `propline_k1`/`propline_k2` and NOT under `propline`.
    """

    def __init__(self, used: int = 0, per_id: dict | None = None):
        self.used = used
        self.per_id = per_id or {}
        self._real = (db.daily_status, db.monthly_status)

    def __enter__(self):
        async def daily(provider_id, limit):
            return self.per_id.get(provider_id, self.used)

        async def monthly(provider_id, limit, unit="requests"):
            return self.per_id.get(provider_id, self.used)

        db.daily_status, db.monthly_status = daily, monthly
        return self

    def __exit__(self, *exc):
        db.daily_status, db.monthly_status = self._real
        return False


NOON = datetime(2026, 9, 3, 12, 0, 0, tzinfo=timezone.utc)


async def test_proximity_bands() -> None:
    print("\nproximity_weight — the three bands, keyed off gameday's own thresholds")

    # Every game time is built FROM the injected clock. Building them from the
    # real wall clock while injecting a different `now` is exactly the harness
    # bug that made a 2-hours-out game read as WARM during development.
    def at(hours: float):
        return [_Game(NOON + timedelta(hours=hours))]

    check("game 2h out is HOT", pace.proximity_weight(at(2), NOON), pace._WEIGHT_HOT)
    check("game 5.9h out is still HOT", pace.proximity_weight(at(5.9), NOON), pace._WEIGHT_HOT)
    check("game 6.1h out is WARM", pace.proximity_weight(at(6.1), NOON), pace._WEIGHT_WARM)
    check("game 23h out is WARM", pace.proximity_weight(at(23), NOON), pace._WEIGHT_WARM)
    check("game 30h out is COLD", pace.proximity_weight(at(30), NOON), pace._WEIGHT_COLD)
    check("no games at all is COLD", pace.proximity_weight([], NOON), pace._WEIGHT_COLD)
    # A slate whose games have all started must not read as HOT: those prices are
    # settled, and paying a tightened cadence for them is the exact waste the
    # allocator exists to stop.
    check("all games already started is COLD", pace.proximity_weight(at(-2), NOON), pace._WEIGHT_COLD)
    check("soonest UNSTARTED game wins",
          pace.proximity_weight([_Game(NOON - timedelta(hours=4)),
                                 _Game(NOON + timedelta(hours=3)),
                                 _Game(NOON + timedelta(hours=20))], NOON),
          pace._WEIGHT_HOT)
    check("an unparseable game_date is ignored, not fatal",
          pace.proximity_weight([_Game(NOON + timedelta(hours=2)), _Bad()], NOON),
          pace._WEIGHT_HOT)


async def test_period_boundaries() -> None:
    print("\nperiod remaining — Propline resets at UTC MIDNIGHT, not on a rolling 24h")
    check_near("daily at noon has 12h left",
               pace._period_remaining_seconds("daily", NOON), 12 * 3600, 1)
    check_near("daily at 23:59 has ~1 min left",
               pace._period_remaining_seconds("daily", NOON.replace(hour=23, minute=59)), 60, 1)
    check_near("monthly on Sep 3 runs to Oct 1",
               pace._period_remaining_seconds("monthly", NOON), 27 * 86400 + 12 * 3600, 1)
    # December is the one month whose rollover changes the YEAR. An off-by-one
    # here yields a negative period and, through the divide, a nonsense interval
    # — silently, since the clamp would present it as a plain MIN_INTERVAL.
    dec = datetime(2026, 12, 20, 12, 0, tzinfo=timezone.utc)
    check_near("monthly rolls Dec -> Jan of the NEXT year",
               pace._period_remaining_seconds("monthly", dec), 11 * 86400 + 12 * 3600, 1)


async def test_uncapped_and_exhausted() -> None:
    print("\nthe two degenerate budgets")
    with _Budget(used=0):
        # SharpAPI: no cap to ration. Pacing it would throw away free data.
        s = await pace.next_interval("sharpapi", "none", None, 1, [], NOON)
        check("an uncapped provider paces at the floor, not slower", s, pace._MIN_INTERVAL)
    with _Budget(used=1000):
        s = await pace.next_interval("propline", "daily", 1000, 16, [], NOON)
        # Exhausted: wait out the period rather than retrying into a wall that
        # the cap reservation would refuse anyway — capped at _MAX_INTERVAL, so a
        # dead budget is re-read every 6h rather than slept through blind.
        check("an exhausted budget waits a WHOLE period, not the remainder",
              s, 86_400.0)
    with _Budget(used=1200):
        s = await pace.next_interval("propline", "daily", 1000, 16, [], NOON)
        check("an OVER-spent budget also waits (no negative interval)", s, 86_400.0)
    with _Budget(used=990):
        # 10 units left against a 16-unit cycle: affordable budget, unaffordable
        # CYCLE. Proposing it is how the discrete overshoot happened.
        s = await pace.next_interval("propline", "daily", 1000, 16, [], NOON)
        check("a budget too small for one whole cycle also waits", s, 86_400.0)
    with _Budget(used=1000):
        # A monthly period is a real month, not 30 days: September is 30, and
        # a hardcoded 30 would expire a day early every January.
        s = await pace.next_interval("parlayapi", "monthly", 1000, 1, [], NOON)
        check("a monthly guard waits the real length of THIS month", s, 30 * 86_400.0)
        dec = datetime(2026, 12, 20, 12, 0, tzinfo=timezone.utc)
        s = await pace.next_interval("parlayapi", "monthly", 1000, 1, [], dec)
        check("...and 31 days in December", s, 31 * 86_400.0)


async def test_weight_redistributes_within_the_envelope() -> None:
    print("\nthe weight tightens near a start and pays for it when quiet")
    with _Budget(used=0):
        hot = await pace.next_interval(
            "propline", "daily", 1000, 16, [_Game(NOON + timedelta(hours=2))], NOON)
        warm = await pace.next_interval(
            "propline", "daily", 1000, 16, [_Game(NOON + timedelta(hours=12))], NOON)
        cold = await pace.next_interval("propline", "daily", 1000, 16, [], NOON)
    check("hot is tighter than warm", hot < warm, True)
    check("warm is tighter than cold", warm < cold, True)
    # The ratios ARE the weights — not an incidental ordering that a sign flip
    # or a base*weight "simplification" would still satisfy.
    check_near("hot is exactly 3x tighter than warm", warm / hot, 3.0, 0.01)
    check_near("cold is exactly 4x looser than warm", cold / warm, 4.0, 0.01)


async def _simulate_day(weight_hours, cap: int, cost: float):
    """Run a whole UTC day of paced cycles; return (cycles, spend).

    Mirrors job_runner's ACTUAL loop rather than a sleep-then-spend one: each
    tick recomputes required_wait from the live budget and fetches only if that
    much has elapsed since the last fetch. The distinction is not academic — a
    sleep-then-spend simulation says a broke provider fetches once its wait
    elapses, which is exactly the behaviour the _MAX_INTERVAL clamp used to
    produce and the reason that clamp was removed from the no-budget guards.

    `weight_hours` pins the slate at a constant distance from every clock read,
    which is the WORST case for the envelope: a real slate's games get closer
    and then start, dropping to COLD, so pinning holds the tightening on for the
    entire period rather than letting it decay.
    """
    now = datetime(2026, 9, 3, 0, 0, tzinfo=timezone.utc)
    end = now + timedelta(days=1)
    last: datetime | None = None
    spend, cycles, steps = 0, 0, 0
    budget = _Budget(used=0)
    with budget:
        while now < end and steps < 200_000:
            steps += 1
            games = ([] if weight_hours is None
                     else [_Game(now + timedelta(hours=weight_hours))])
            wait = await pace.next_interval("sim", "daily", cap, cost, games, now)
            if last is not None and (now - last).total_seconds() < wait:
                now = last + timedelta(seconds=wait)  # earliest moment allowed
                continue
            spend += int(cost)
            budget.used += int(cost)
            cycles += 1
            last = now
            now += timedelta(seconds=1)
    return cycles, spend


async def test_full_period_never_exceeds_cap() -> None:
    global _failures
    print("\nTHE ENVELOPE — a whole day of paced cycles cannot outspend the cap")
    # Three weights x three cost profiles, the third being CFB-sized (179 per
    # cycle against 2,000) where a single cycle is 9% of the budget.
    for label, hours in (("HOT all day (worst case)", 2.0),
                         ("WARM all day", 12.0),
                         ("COLD all day", None)):
        for cap, cost in ((1000, 16), (1000, 1), (2000, 179)):
            cycles, spend = await _simulate_day(hours, cap, cost)
            if spend <= cap:
                print(f"  PASS  {label:<26} cap={cap:<5} cost={cost:<4} "
                      f"-> {cycles:>4} cycles, {spend:>5}/{cap} spent")
            else:
                _failures += 1
                print(f"  FAIL  {label:<26} cap={cap:<5} cost={cost:<4} "
                      f"-> OVERSPENT {spend}/{cap}")


async def test_spend_curve_is_front_loaded_at_hot() -> None:
    print("\nthe curve's SHAPE — w=3 front-loads, and that is the intended trade")
    # B(T) = B0*(T/T0)**w. At the halfway point T/T0 = 1/2, so with w=3 exactly
    # 1 - 1/8 = 87.5% of the budget should be gone. This assertion is what would
    # catch the weight silently changing meaning — someone "simplifying"
    # base/weight into base*weight reverses the curve while keeping every
    # ordering test above green.
    #
    # cost MUST be large enough to keep the interval clear of _MIN_INTERVAL. At
    # cost=1 the base interval is 86s, the floor overrides it, and all 719 cycles
    # of the day run at a flat cadence — the measurement then reports the clamp
    # (0.36) and says nothing at all about the weight.
    now = datetime(2026, 9, 3, 0, 0, tzinfo=timezone.utc)
    midday = now + timedelta(hours=12)
    end = now + timedelta(days=1)
    cap, cost = 1000, 16
    spend = spend_by_midday = 0
    budget = _Budget(used=0)
    with budget:
        while now < end:
            wait = await pace.next_interval(
                "sim", "daily", cap, cost, [_Game(now + timedelta(hours=2))], now)
            now += timedelta(seconds=wait)
            if now >= end:
                break
            spend += cost
            budget.used += cost
            if now <= midday:
                spend_by_midday = spend
    check_near("87.5% of a HOT day's budget goes in its first half",
               spend_by_midday / cap, 0.875, 0.04)
    check("and the day still finishes inside the cap", spend <= cap, True)


async def test_min_interval_can_overrun() -> None:
    print("\nthe KNOWN clamp behaviour — why the cap reservation stays the hard stop")
    with _Budget(used=0):
        # A huge cap and a tiny cost wants an interval below 120s. The clamp
        # refuses, so the curve is NOT followed and the day underspends — the
        # safe direction, and the one this pins.
        s = await pace.next_interval(
            "sim", "daily", 100_000, 1, [_Game(NOON + timedelta(hours=1))], NOON)
        check("a huge cap still cannot go below the 120s floor", s, pace._MIN_INTERVAL)
        # 59 seconds left in the period: the curve wants a sub-minute interval,
        # the floor says 120s, so the next cycle lands after the reset. Harmless
        # here, but it is precisely why job_runner reserves rather than trusts.
        late = NOON.replace(hour=23, minute=59, second=1)
        s = await pace.next_interval("sim", "daily", 1000, 16, [], late)
        check("a late-period interval clamps to the floor, not to zero", s, pace._MIN_INTERVAL)
    with _Budget(used=0):
        s = await pace.next_interval("sim", "monthly", 1, 1, [], NOON)
        check("a 1-unit cap does not divide by zero", s <= pace._MAX_INTERVAL, True)


async def test_real_provider_shapes() -> None:
    print("\nthe two real provider economics, at the numbers provider_matrix declares")
    with _Budget(used=0):
        # Propline: 1,000/day, 1 + N requests per cycle on a 15-game slate.
        p_hot = await pace.next_interval(
            "propline", "daily", 1000, 16, [_Game(NOON + timedelta(hours=2))], NOON)
        p_cold = await pace.next_interval("propline", "daily", 1000, 16, [], NOON)
        # ParlayAPI: 1,000/MONTH, one request per cycle.
        a_hot = await pace.next_interval(
            "parlayapi", "monthly", 1000, 1, [_Game(NOON + timedelta(hours=2))], NOON)
    print(f"    propline   HOT {p_hot / 60:6.1f} min   COLD {p_cold / 60:6.1f} min   (fixed floor was 25.0)")
    print(f"    parlayapi  HOT {a_hot / 60:6.1f} min                    (fixed floor was 45.0)")
    # The whole point of the allocator: tighter than the old fixed floor when a
    # game is close, looser than it when nothing is.
    check("propline beats its old 25-min floor near a start", p_hot < 25 * 60, True)
    check("propline backs off past its old floor when quiet", p_cold > 25 * 60, True)
    check("parlayapi beats its old 45-min floor near a start", a_hot < 45 * 60, True)


async def test_pooled_budget() -> None:
    print("\npooled keys — the budget is the POOL, read under the KEY ids")
    keys = ["propline_k1", "propline_k2"]
    # The bug this pins: spend charged to the keys, pacer asked about the spec.
    # `propline` itself is left at 0, which is exactly what the real table holds.
    spent = {"propline_k1": 900, "propline_k2": 900, "propline": 0}
    with _Budget(used=0, per_id=spent):
        blind = await pace.next_interval("propline", "daily", 1000, 16, [], NOON)
        aware = await pace.next_interval("propline", "daily", 1000, 16, [], NOON,
                                         pool_ids=keys)
    # Unpooled reads propline=0 and paces as though nothing has been spent.
    # Pool-aware sees 1,800 of 2,000 gone and backs off hard.
    check("pooling changes the answer when spend sits under the key ids",
          aware > blind, True)
    print(f"    spec-id read: {blind/60:6.1f} min   pool-aware read: {aware/60:6.1f} min")

    with _Budget(used=0, per_id={"propline_k1": 0, "propline_k2": 0}):
        # Two untouched keys are 2,000/day, not 1,000 — pacing them as one key
        # would leave half the pool unspent.
        one = await pace.next_interval("propline", "daily", 1000, 16, [], NOON)
        two = await pace.next_interval("propline", "daily", 1000, 16, [], NOON,
                                       pool_ids=keys)
    check_near("two empty keys pace exactly twice as fast as one", one / two, 2.0, 0.01)

    with _Budget(used=0, per_id={"propline_k1": 1000, "propline_k2": 1000}):
        s = await pace.next_interval("propline", "daily", 1000, 16, [], NOON,
                                     pool_ids=keys)
        check("a fully-spent POOL waits for the reset", s, 86_400.0)

    with _Budget(used=0, per_id={"propline_k1": 1000, "propline_k2": 0}):
        s = await pace.next_interval("propline", "daily", 1000, 16, [], NOON,
                                     pool_ids=keys)
        check("one dead key does not stall the pool", s < 86_400.0, True)

    # A key OVER its cap must contribute zero, never a negative. Budget is not
    # fungible across keys — each has its own cap — so an overage on one must
    # not eat another's headroom. Real case: sgo_k1 at 2500 against a 2000 soft
    # cap (the vendor's true limit is 2500) while sgo_k2 had 636 left. Summing
    # total_cap - total_used gives 136 and declares a 177-object CFB cycle
    # unaffordable, silencing that provider for the rest of the month over an
    # overage somewhere else entirely.
    with _Budget(used=0, per_id={"sgo_k1": 2500, "sgo_k2": 1364}):
        over = await pace.next_interval("sportsgameodds", "monthly", 2000, 177, [], NOON,
                                        unit="objects", pool_ids=["sgo_k1", "sgo_k2"])
        # 0 + (2000-1364) = 636, which affords a 177-object cycle. The naive
        # form yields 136 and returns a whole-period wait instead.
        check("an over-cap key does not drain a live one",
              over < pace._period_length_seconds("monthly", NOON), True)
    with _Budget(used=0, per_id={"sgo_k1": 2000, "sgo_k2": 2000}):
        both = await pace.next_interval("sportsgameodds", "monthly", 2000, 177, [], NOON,
                                        unit="objects", pool_ids=["sgo_k1", "sgo_k2"])
        check("but a genuinely spent POOL still waits for the reset",
              both, pace._period_length_seconds("monthly", NOON))


async def main() -> int:
    await test_proximity_bands()
    await test_period_boundaries()
    await test_uncapped_and_exhausted()
    await test_weight_redistributes_within_the_envelope()
    await test_full_period_never_exceeds_cap()
    await test_spend_curve_is_front_loaded_at_hot()
    await test_min_interval_can_overrun()
    await test_pooled_budget()
    await test_real_provider_shapes()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all pace checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
