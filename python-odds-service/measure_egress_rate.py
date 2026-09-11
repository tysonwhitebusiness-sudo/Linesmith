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
import re
import asyncio
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                     # noqa: E402

# 600, NOT 110. The FROM clause is what prices a query in bytes, and at 110
# characters it was TRUNCATED AWAY on every statement in this codebase --
# asyncpg emits long quoted column lists, so `FROM` sits well past column 110.
# The byte estimator therefore priced nothing and reported 0.00 GB/day. A zero
# that comes from a parse failure is indistinguishable from a zero that comes
# from an idle database, which is why it nearly passed.
#
# userid AND dbid AND queryid. `queryid` alone is NOT unique -- this database
# really does carry two (userid, queryid) pairs sharing a queryid, 21,462 rows
# between them. Keying the snapshot dict on queryid alone silently kept
# whichever row the server returned last, and since that order is not stable
# between two snapshots, the same key could hold user A's counter in `before`
# and user B's in `after`, manufacturing a delta out of nothing.
SNAP = """
SELECT userid, dbid, queryid, calls, rows,
       left(regexp_replace(query, E'[\\n\\r ]+', ' ', 'g'), 600) AS q
  FROM pg_stat_statements
 WHERE query ILIKE 'select%'
"""

# Queries this session's own maintenance issues. Attributed separately rather
# than excluded: hiding them would understate the bill, and folding them into
# the baseline would overstate the platform.
MINE = ("prune_corpus / corpus verification",
        ('SELECT "id", "sport"',))


async def snapshot(conn) -> dict:
    return {(r["userid"], r["dbid"], r["queryid"]):
            (r["calls"], float(r["rows"]), r["q"])
            for r in await conn.fetch(SNAP)}



# ---------------------------------------------------------------------------
# ROWS -> BYTES, AND THE HONEST NAME FOR WHAT THIS IS
# ---------------------------------------------------------------------------
#
# `pg_stat_statements` counts ROWS. The allowance is in GIGABYTES. Nothing in
# Postgres closes that gap, and the header above says so -- but "we cannot see
# bytes" left the egress ceiling with no number at all, which is its own
# failure: two of Phase 5's three ceilings had a figure and the third had a
# shrug.
#
# So this estimates. For each query it finds the primary FROM table and
# multiplies rows by that table's MEASURED row width (`pg_column_size(t.*)`
# over a sample, which is post-TOAST-compression, i.e. the stored width rather
# than the uncompressed text).
#
# IT REPORTS A BAND, NOT A NUMBER -- LOW charges each row its table's median
# width, HIGH its mean. An earlier version reported a single mean-based figure
# and called it a safe upper bound; that reasoning was wrong, because a table
# whose rows span 80 B to 12 MB has no single representative width, and the
# mean over-charged the small rows the worker actually reads most (see
# SKEW_FLAG_RATIO below for the measured case). Both bounds still over-count a
# narrow SELECT, which is charged for whole rows it never asked for. Neither
# models wire protocol overhead, TLS, or compression, so this is not a billing
# reconciliation.
#
# SUPABASE'S OWN USAGE GRAPH REMAINS THE AUTHORITY. This is for spotting a
# regime change between billing periods, not for arguing with an invoice.
AVG_WIDTH_SAMPLE = 2000
EGRESS_ALLOWANCE_GB = 250   # Supabase Pro


# A BAND, NOT A NUMBER -- because one average width is an invalid model for a
# table whose rows differ by orders of magnitude.
#
# MEASURED, and this is not a hypothetical. `snapshot_cache` holds both
# `provider-throttle:parlayapi` at **80 bytes** and `mlb:full-raw:2026-09-09`
# at **12,380,328 bytes**: p50 1,376 B, mean 33,922 B, max 12.4 MB. The worker
# reads the throttle keys thousands of times per window and the giant ones
# rarely -- so charging every read the MEAN over-counted 2,972 reads of an
# 80-byte row by **644x each**, and invented 153 MB out of 238 KB. That single
# artifact was 70% of the run's total and turned a figure comfortably under the
# allowance into "633 GB/mo, 2.5x over".
#
# So each table now carries both p50 and mean, the report shows a LOW..HIGH
# band, and any table skewed enough for the two to diverge is named. A band
# that spans the decision is a signal to go measure that table properly --
# which is strictly better than a point estimate that happens to be wrong.
SKEW_FLAG_RATIO = 4.0      # mean/p50 above this and the band is worth reading
MIN_CALLS_TO_TRUST = 5     # fewer calls than this and rows/day is a guess


async def _table_widths(conn, tables: set[str]) -> dict:
    """{table: (p50_bytes, mean_bytes)}, measured not assumed."""
    out = {}
    for t in tables:
        try:
            r = await conn.fetchrow(
                f"SELECT avg(pg_column_size(s.*))::float AS mean, "
                f"       percentile_disc(0.5) WITHIN GROUP "
                f"         (ORDER BY pg_column_size(s.*))::float AS p50 "
                f"  FROM (SELECT * FROM {t} LIMIT {AVG_WIDTH_SAMPLE}) s")
        except Exception:                                     # noqa: BLE001
            r = None
        if r and r["mean"] and r["p50"]:
            out[t] = (float(r["p50"]), float(r["mean"]))
    return out


# asyncpg quotes identifiers and some reads are schema-qualified, so the real
# text is `FROM "prop_odds"` or `FROM public.prop_odds` -- never the bare
# lowercase word the first version of this regex assumed.
#
# That first version also carried a literal 0x08 BACKSPACE byte where `\b`
# was meant, written in by a heredoc that ate the backslash. It therefore
# matched NOTHING, ever -- so every row came back unpriced and the estimator
# reported 0.00 GB/day. Three separate defects each produced that same clean
# zero, which is why it looked like a plausible answer instead of a failure.
_SKIP = {"unnest", "generate_series", "json_to_recordset", "jsonb_to_recordset",
         "jsonb_array_elements", "json_array_elements", "lateral"}

# JOIN as well as FROM. `SELECT ... FROM unnest($1::text[]) u JOIN prop_odds p`
# is a real shape here -- db.py passes id arrays that way -- and matching only
# FROM skipped past the unnest to nothing, leaving a genuinely large read
# unpriced. FROM still wins when it names a real table, because it comes first.
_FROM_RE = re.compile(
    r'\b(?:from|join)\s+(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?', re.I)


def _primary_table(q: str) -> str | None:
    """The first real FROM/JOIN target in a normalised statement.

    Returns None for a set-returning function or a catalog read -- neither is a
    table scan and neither has a meaningful row width. A None here makes the row
    report as UNPRICED; it is never silently valued at zero.
    """
    for m in _FROM_RE.finditer(q):
        schema = (m.group(1) or "").lower()
        name = m.group(2).lower()
        if schema in {"pg_catalog", "information_schema"}:
            continue
        if name in _SKIP or name.startswith("pg_"):
            continue
        return name
    return None


async def main(seconds: int, actual_gb_day: float = 0.0) -> int:
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

    # A statement MISSING from `before` is the dangerous case, not the boring
    # one. The old default of (0, 0.0) charged its ENTIRE cumulative history --
    # potentially days of rows -- to this 240-second window, which is precisely
    # the contamination the module docstring exists to prevent. pg_stat_statements
    # evicts and re-admits entries under pressure, so this is reachable in normal
    # operation, not just at process start.
    #
    # Such a statement is counted at face value but FLAGGED, so a number that
    # depends on one cannot be quoted without the caveat coming with it.
    deltas = []
    first_seen = 0.0
    for key, (calls, rows, q) in after.items():
        prior = before.get(key)
        if prior is None:
            first_seen += rows
            deltas.append((rows, calls, q, True))
            continue
        b_calls, b_rows, _ = prior
        d_rows, d_calls = rows - b_rows, calls - b_calls
        if d_rows > 0 or d_calls > 0:
            deltas.append((d_rows, d_calls, q, False))
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
    # --- bytes, estimated and labelled as such -----------------------------
    # NOTE the re-acquire. This previously passed `conn` from the `after`
    # snapshot block, which had ALREADY BEEN RELEASED back to the pool.
    # Every width query raised, _table_widths swallowed each one per-table,
    # and the result was an empty width map -- the same 0.00 GB/day, from a
    # second independent cause.
    tables = {t for t in (_primary_table(d[2]) for d in deltas) if t}
    async with pool.acquire(timeout=120.0) as conn:
        widths = await _table_widths(conn, tables)
    lo_bytes = hi_bytes = 0.0
    unpriced = 0.0
    skewed: dict[str, float] = {}
    for d_rows, _c, q, _new in deltas:
        t = _primary_table(q)
        w = widths.get(t) if t else None
        if w:
            # SKEWED TABLES STAY IN THE BAND, flagged but not excluded.
            # An earlier version dropped them entirely, reasoning that a
            # table's stored size distribution cannot predict which rows a
            # workload reads. That reasoning is sound; the REMEDY was wrong.
            # Supabase's own graph put 2026-09-11 at 19.483 GB/day. The full
            # band read 10.24-27.80 GB/day and CONTAINED it; the version that
            # excluded `snapshot_cache` read 9.3-10.2 and sat BELOW it. So
            # those reads carry real bytes, and dropping them turned a band
            # that bracketed the truth into one that missed it low -- the
            # dangerous direction for a ceiling check.
            p50, mean = w
            lo_bytes += d_rows * p50
            hi_bytes += d_rows * mean
            if mean / max(p50, 1.0) >= SKEW_FLAG_RATIO:
                skewed[t] = skewed.get(t, 0.0) + d_rows
        else:
            unpriced += d_rows
    lo_day = lo_bytes / elapsed * 86400.0 / 1e9
    hi_day = hi_bytes / elapsed * 86400.0 / 1e9
    print(f"  estimated bytes    : {lo_bytes / 1e6:,.1f} - {hi_bytes / 1e6:,.1f} MB in the window")
    print(f"  extrapolated       : {lo_day:,.2f} - {hi_day:,.2f} GB/day  ->  "
          f"{lo_day * 30:,.0f} - {hi_day * 30:,.0f} GB/mo against a "
          f"{EGRESS_ALLOWANCE_GB} GB allowance")
    verdict = ("UNDER" if hi_day * 30 < EGRESS_ALLOWANCE_GB else
               "OVER" if lo_day * 30 > EGRESS_ALLOWANCE_GB else
               "STRADDLES THE ALLOWANCE - the band does not decide it")
    print(f"  verdict            : {verdict}")
    print(f"  LOW charges every row its table's MEDIAN width, HIGH its MEAN. "
          f"Both over-count a\n  narrow SELECT, which reads whole rows it "
          f"never asked for.")
    if skewed:
        print(f"  WIDE-BAND TABLES (mean >= {SKEW_FLAG_RATIO:g}x median -- one width does not "
              f"describe them, so\n  their contribution is genuinely uncertain, NOT wrong):")
        for t, n in sorted(skewed.items(), key=lambda kv: -kv[1]):
            p50, mean = widths[t]
            print(f"    {t:<28} {n:>10,.0f} rows   p50 {p50:>10,.0f} B   mean {mean:>12,.0f} B")
    if unpriced:
        print(f"  {unpriced:,.0f} rows could not be priced (no single FROM "
              f"table); they are NOT in the figure above.")
    if first_seen:
        print(f"  WARNING: {first_seen:,.0f} of those rows ({first_seen / max(total, 1) * 100:.0f}%) "
              f"come from statements absent from the opening snapshot, so their\n"
              f"  FULL cumulative history -- not just this window -- is in the total above. "
              f"Treat the rate as an over-estimate until a run shows no !FIRST-SEEN lines.")
    if actual_gb_day:
        mid = (lo_day + hi_day) / 2.0
        print(f"\n  CALIBRATION vs Supabase's own figure of {actual_gb_day:.3f} GB/day:")
        inside = lo_day <= actual_gb_day <= hi_day
        print(f"    band {lo_day:,.2f} - {hi_day:,.2f} GB/day "
              f"{'CONTAINS' if inside else 'MISSES'} it"
              f"{'' if inside else '  <-- the model is wrong, not just imprecise'}")
        print(f"    midpoint {mid:,.2f} GB/day is {mid / actual_gb_day:.2f}x actual")
        print(f"    -> scale a per-query figure below by ~{actual_gb_day / max(mid, 1e-9):.2f} "
              f"to read it as real bytes")
    print("  Supabase's own usage graph remains the authority on bytes.")
    print()

    # RANKED BY BYTES, NOT ROWS. A 13,000-row read of a narrow table and a
    # 2,000-row read of a 50 KB-per-row table rank identically by row count and
    # nowhere near each other on the bill.
    #
    # MIN_CALLS_TO_TRUST exists because extrapolating a window to a day
    # multiplies by 86400/elapsed -- 8x even on a 3-hour window. A job that ran
    # ONCE in that window is indistinguishable from one that runs every 3 hours,
    # and five jobs in this registry are on 86,400s (daily) schedules. Those
    # rows are real; their DAILY figure is a guess, and it is labelled as one.
    print(f"\n{'=' * 78}\n  RANKED BY ESTIMATED BYTES PER DAY\n{'=' * 78}")
    ranked = []
    for d_rows, d_calls, q, is_new in deltas:
        t = _primary_table(q)
        w = widths.get(t) if t else None
        lo = d_rows * w[0] if w else 0.0
        hi = d_rows * w[1] if w else 0.0
        ranked.append((hi, lo, d_rows, d_calls, q, t, is_new, w is not None))
    ranked.sort(reverse=True)
    scale = 86400.0 / elapsed
    for hi, lo, d_rows, d_calls, q, t, is_new, priced in ranked[:20]:
        if not priced:
            note, gb = "UNPRICED", "        ?        "
        else:
            gb = f"{lo * scale / 1e9:>7,.2f}-{hi * scale / 1e9:<7,.2f}GB/d"
            note = ""
        if d_calls < MIN_CALLS_TO_TRUST:
            note = (note + " " if note else "") + f"ONLY {d_calls} CALL(S) - daily figure unreliable"
        if is_new:
            note = (note + " " if note else "") + "FIRST-SEEN"
        print(f"  {gb}  {d_rows:>10,.0f} rows {d_calls:>6,} calls  "
              f"{(t or '?'):<26} {q[:58]}")
        if note:
            print(f"  {'':>21}  ^ {note}")

    print(f"\n{'=' * 78}\n  SAME LIST, RAW (widest queries first)\n{'=' * 78}")
    for d_rows, d_calls, q, is_new in deltas[:15]:
        t = _primary_table(q)
        w = widths.get(t) if t else None
        mb = (f"{d_rows * w[0] / 1e6:>7,.1f}-{d_rows * w[1] / 1e6:<8,.1f}MB"
              if w else "              ?")
        flag = " !FIRST-SEEN" if is_new else ""
        print(f"  {d_rows:>12,.0f} rows {mb}  {d_calls:>6,} calls  "
              f"{d_rows / max(d_calls, 1):>9,.0f}/call{flag}  {q[:76]}")

    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                         # noqa: BLE001
        pool.terminate()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=300)
    ap.add_argument("--actual-gb-day", type=float, default=0.0,
                    help="Supabase's own GB/day for a comparable day, to "
                         "calibrate the band against ground truth.")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.seconds, a.actual_gb_day)))
