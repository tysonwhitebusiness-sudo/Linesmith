"""Where does a training-set build actually spend its time?

The Phase 4 gate has twice been blocked for hours by `build_training_set`, and
the season range for the Q37 re-fit was sized by extrapolating from one
uncertain wall-clock number. That is guessing. This measures instead.

It wraps every statsapi entry point and the DB reads the build uses, counting
calls and accumulated wall time, and prints a running summary every 10s so the
rate is readable within a minute or two rather than at the end. Kill it once
the picture is clear -- it is a probe, not a job. Nothing is written.

Run from python-odds-service/:
    ./.venv/Scripts/python.exe -u ../scripts/gate/probe-training-set-cost.py [season]
"""
import asyncio
import functools
import sys
import time

sys.path.insert(0, "src")

import httpx

import db  # noqa: E402
from predict import model_fit, statsapi  # noqa: E402

SEASON = int(sys.argv[1]) if len(sys.argv) > 1 else 2024

# name -> [calls, seconds]
STATS: dict[str, list] = {}
START = time.monotonic()


def instrument(module, name):
    fn = getattr(module, name, None)
    if fn is None or not asyncio.iscoroutinefunction(fn):
        return
    STATS.setdefault(name, [0, 0.0])

    @functools.wraps(fn)
    async def wrapped(*a, **kw):
        t0 = time.monotonic()
        try:
            return await fn(*a, **kw)
        finally:
            e = STATS[name]
            e[0] += 1
            e[1] += time.monotonic() - t0

    setattr(module, name, wrapped)


def report(final=False):
    elapsed = time.monotonic() - START
    rows = [(n, c, s) for n, (c, s) in STATS.items() if c]
    rows.sort(key=lambda r: -r[2])
    print(f"\n--- t+{elapsed:6.1f}s {'FINAL' if final else ''}", flush=True)
    print(f"    {'call':38s} {'n':>7s} {'total s':>9s} {'ms/call':>9s}", flush=True)
    for n, c, s in rows[:12]:
        print(f"    {n:38s} {c:>7d} {s:>9.1f} {1000 * s / c:>9.1f}", flush=True)
    accounted = sum(s for _, _, s in rows)
    print(f"    {'(accounted for)':38s} {'':>7s} {accounted:>9.1f}"
          f"   {100 * accounted / max(elapsed, 0.001):.0f}% of wall clock", flush=True)


async def ticker():
    while True:
        await asyncio.sleep(10)
        report()


async def main() -> int:
    for name in dir(statsapi):
        instrument(statsapi, name)
    for name in ("read_park_factors", "get_historical_odds"):
        instrument(db, name)
    # These live in other predict modules but dominate the per-(team, season) cost.
    for mod_name in ("team_vectors", "league_rates"):
        try:
            mod = __import__(f"predict.{mod_name}", fromlist=["*"])
            for name in dir(mod):
                instrument(mod, name)
        except ImportError:
            pass

    print(f"building training set for season {SEASON} (one season)", flush=True)
    print("counting every external call; Ctrl-C or kill once the rate is clear", flush=True)

    tick = asyncio.create_task(ticker())
    try:
        async with httpx.AsyncClient() as client:
            result = await model_fit.build_training_set(client, [SEASON])
        tick.cancel()
        report(final=True)
        print(f"\nONE SEASON took {time.monotonic() - START:.1f}s "
              f"-> {len(result.rows)} moneyline rows, {len(result.total_rows)} total rows", flush=True)
        print(f"extrapolated: 14 seasons ~= {14 * (time.monotonic() - START) / 3600:.1f}h", flush=True)
    finally:
        tick.cancel()
    return 0


sys.exit(asyncio.run(main()))
