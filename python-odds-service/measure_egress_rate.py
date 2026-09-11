"""Phase 5 — what is ACTUALLY leaving the database right now.

    python measure_egress_rate.py --seconds 300

WHY A DELTA AND NOT A TOTAL. `pg_stat_statements` is cumulative since its last
reset, so its totals answer "what has this database sent since 2026-09-04",
which is not the question. On 2026-09-10 the cumulative figure read **140.5M
rows/day** — and the single largest contributor was the pre-5.1 serving query at
511,257 rows per call, a query that has not run in that shape since 5.1 shipped
on 2026-09-09. Averaging five days of a fixed bug into a rate and calling it
today's rate is how a fix gets declared broken.

So this snapshots, waits, and subtracts. Only work done DURING the window
counts.

AND IT ATTRIBUTES. The corpus lives in Supabase Storage, and a maintenance
session that verifies a prune reads it — `prune_corpus` pulled 1,982,888 rows of
`odds_archive` and 1,480,292 of `prop_odds_archive` per verification pass on the
day this was written. That traffic is real and it is on the same bill, but it is
NOT the platform's steady state, and a measurement that silently folds the
measurer's own reads into the baseline is exactly the contamination the previous
attempt at this suffered.

RUN IT IDLE. Nothing else of yours may touch the database during the window —
no fits, no prune verifications, no ad-hoc queries. The worker should keep
running, because the worker IS the thing being measured.

BYTES ARE NOT VISIBLE HERE and this never pretends otherwise. Postgres counts
ROWS. Supabase's own graph is the only authority on bytes; this says which
queries are sending the rows, which is the part you can act on.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                     # noqa: E402

SNAP = """
SELECT queryid, calls, rows,
       left(regexp_replace(query, E'[\\n\\r ]+', ' ', 'g'), 110) AS q
  FROM pg_stat_statements
 WHERE query ILIKE 'select%'
"""

# Queries this session's own maintenance issues. Attributed separately rather
# than excluded: hiding them would understate the bill, and folding them into
# the baseline would overstate the platform.
MINE = ("prune_corpus / corpus verification",
        ('SELECT "id", "sport"',))


async def snapshot(conn) -> dict:
    return {r["queryid"]: (r["calls"], float(r["rows"]), r["q"])
            for r in await conn.fetch(SNAP)}


async def main(seconds: int) -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=120.0) as conn:
        reset = await conn.fetchval("SELECT stats_reset FROM pg_stat_statements_info")
        now = await conn.fetchval("SELECT now()")
        cum_days = (now - reset).total_seconds() / 86400.0
        cum = float(await conn.fetchval(
            "SELECT COALESCE(sum(rows),0) FROM pg_stat_statements "
            " WHERE query ILIKE 'select%'"))
        print(f"\n{'=' * 78}\nEGRESS RATE\n{'=' * 78}")
        print(f"  cumulative window : {cum_days:.2f} days since {reset}")
        print(f"  cumulative rate   : {cum / cum_days:,.0f} rows/day  "
              f"<- includes pre-5.1 behaviour; NOT today's rate")
        before = await snapshot(conn)

    print(f"\n  measuring for {seconds}s — do not touch the database...", flush=True)
    t0 = time.time()
    await asyncio.sleep(seconds)
    elapsed = time.time() - t0

    async with pool.acquire(timeout=120.0) as conn:
        after = await snapshot(conn)

    deltas = []
    for qid, (calls, rows, q) in after.items():
        b_calls, b_rows, _ = before.get(qid, (0, 0.0, q))
        d_rows, d_calls = rows - b_rows, calls - b_calls
        if d_rows > 0 or d_calls > 0:
            deltas.append((d_rows, d_calls, q))
    deltas.sort(reverse=True)

    total = sum(d[0] for d in deltas)
    per_day = total / elapsed * 86400.0
    print(f"\n{'=' * 78}\n  MEASURED OVER {elapsed:,.0f}s OF REAL TIME\n{'=' * 78}")
    print(f"  rows returned      : {total:,.0f}")
    print(f"  extrapolated       : {per_day:,.0f} rows/day")
    print(f"  vs cumulative      : {cum / cum_days:,.0f} rows/day "
          f"({per_day / max(cum / cum_days, 1) * 100:.1f}% of it)\n")
    if not deltas:
        print("  Nothing ran. Either the worker is down or the window was too "
              "short to catch a job — check a breadcrumb before concluding "
              "egress is zero.\n")
    for d_rows, d_calls, q in deltas[:15]:
        print(f"  {d_rows:>12,.0f} rows  {d_calls:>6,} calls  "
              f"{d_rows / max(d_calls, 1):>9,.0f}/call  {q}")

    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                         # noqa: BLE001
        pool.terminate()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=300)
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.seconds)))
