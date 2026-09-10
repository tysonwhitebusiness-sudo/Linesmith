"""Phase 5.S.4 — return the deleted space to the filesystem.

    python vacuum_reclaim.py                          # plan; changes nothing
    python vacuum_reclaim.py --apply player_game_history
    python vacuum_reclaim.py --apply --all            # every bloated table

`DELETE` and `DROP` are not the same operation. `run_retention`'s own docstring
says it: *"`DELETE` marks rows dead; only VACUUM FULL returns the space... takes
an ACCESS EXCLUSIVE lock that would block every reader."* Everything 5.2d and
5.S.2 removed is still occupying its file until this runs.

WHY THIS IS A TOOL AND NOT A ONE-LINE `psql -c`. Three things have to be checked
before `VACUUM FULL` is safe on this database, and all three are easy to skip:

1. **FREE SPACE, because VACUUM FULL is a COPY.** It builds a complete new
   relation beside the old one and swaps at the end, so peak usage is the old
   file PLUS the new one. On a database at 88% of an 8,192 MB hard ceiling that
   is the difference between reclaiming 1.3 GB and hitting the wall mid-rewrite.
   This refuses to start unless the projected new size fits in the headroom,
   with a margin.

2. **WHAT ELSE IS CONNECTED.** The lock is ACCESS EXCLUSIVE: every reader and
   writer of the table blocks for the duration, and the pooler caps at 15
   connections shared with the live worker. A rewrite that runs while the
   worker is mid-slate does not corrupt anything, but it does stall it, and a
   stalled job here has historically looked exactly like an outage.

3. **THAT THE ESTIMATE WAS RIGHT.** `pg_total_relation_size` before and after
   is the gate, and the projection is derived from live rows rather than
   assumed — `player_game_history` holds 2,424 bytes per live row against a
   natural 655, which is where the ~1,342 MB claim comes from.

WHAT THIS DELIBERATELY DOES NOT DO: pick its own tables when `--apply` names
one. `--all` exists, but it operates on the measured bloat list, and it prints
that list and its own arithmetic before touching anything.
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

DB_LIMIT_MB = 8192          # Supabase Pro
# VACUUM FULL needs room for the new copy while the old one still exists.
# The margin is on top of that, because the worker keeps writing during the
# rewrite and `pg_database_size` is not the only thing consuming the ceiling.
SAFETY_MARGIN_MB = 250


async def bloat_report(conn) -> list[dict]:
    """Per-table: what it occupies now, and what its live rows justify.

    The projection uses the table's OWN live rows and its own average row width
    rather than a global constant — a table of jsonb blobs and a table of
    integers do not bloat alike, and a single guessed bytes-per-row would make
    the free-space check meaningless on exactly the tables that matter most.
    """
    # ROW COUNT COMES FROM `pg_class.reltuples`, NOT `pg_stat_user_tables
    # .n_live_tup`, AND THE DIFFERENCE IS NOT PEDANTRY. `n_live_tup` lives in
    # the cumulative statistics, which this database DISCARDED at its
    # 2026-09-04 restart -- the same reset that voided 5.S.3's index gate. On
    # the first run of this tool it reported `game_result` at 199 live rows
    # (really 184,108) and `mlb_pitch_events` at 25,532 (really ~1.98M), which
    # made both look catastrophically bloated at 143,216 and 11,324 bytes per
    # row. `--all` would have rewritten two perfectly dense tables.
    #
    # `reltuples` is maintained by VACUUM and ANALYZE and survives a restart,
    # so it is wrong only in the ordinary "estimate between analyses" way
    # rather than in the "reset to zero last Thursday" way.
    rows = await conn.fetch(
        """
        SELECT c.relname AS tbl,
               pg_total_relation_size(c.oid)      AS total_bytes,
               pg_relation_size(c.oid)            AS heap_bytes,
               pg_indexes_size(c.oid)             AS index_bytes,
               GREATEST(c.reltuples, 0)::bigint   AS live_rows,
               s.n_dead_tup                       AS dead_rows,
               s.n_live_tup                       AS stat_live_rows
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND pg_total_relation_size(c.oid) > 50 * 1024 * 1024
         ORDER BY pg_total_relation_size(c.oid) DESC
        """)
    out = []
    for r in rows:
        live = r["live_rows"] or 0
        heap = float(r["heap_bytes"])
        # Bytes per LIVE row as the file currently stands. A table with no dead
        # rows sits near its natural width; a bloated one is a large multiple.
        per_row = heap / live if live else 0.0
        out.append({
            "table": r["tbl"],
            "total_mb": float(r["total_bytes"]) / 1e6,
            "heap_mb": heap / 1e6,
            "index_mb": float(r["index_bytes"]) / 1e6,
            "live": live,
            "dead": r["dead_rows"] or 0,
            "bytes_per_live_row": per_row,
            "stat_live": r["stat_live_rows"] or 0,
        })
    return out


async def headroom(conn) -> tuple[float, float]:
    size = await conn.fetchval("SELECT pg_database_size(current_database())") / 1e6
    return size, DB_LIMIT_MB - size


async def other_activity(conn) -> list[str]:
    """Everything else currently connected, so the lock is taken knowingly."""
    rows = await conn.fetch(
        """SELECT pid, state, application_name,
                  left(coalesce(query, ''), 70) AS q,
                  extract(epoch FROM (now() - coalesce(query_start, now()))) AS age
             FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND state IS NOT NULL
            ORDER BY age DESC""")
    return [f"pid {r['pid']:<8}{(r['state'] or ''):<14}"
            f"{(r['application_name'] or '-')[:18]:<20}{r['age']:>7.0f}s  {r['q']}"
            for r in rows]


async def main(tables: list[str], do_all: bool, apply: bool) -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        size, free = await headroom(conn)
        print(f"\n{'=' * 78}\n5.S.4  RECLAIM\n{'=' * 78}")
        print(f"  database {size:,.0f} MB of {DB_LIMIT_MB:,} MB "
              f"({size / DB_LIMIT_MB * 100:.1f}%), {free:,.0f} MB free\n")

        report = await bloat_report(conn)
        print(f"  {'table':<32}{'total':>10}{'heap':>10}{'idx':>9}"
              f"{'live rows':>13}{'B/live row':>12}")
        for r in report:
            print(f"  {r['table']:<32}{r['total_mb']:>9,.0f}M{r['heap_mb']:>9,.0f}M"
                  f"{r['index_mb']:>8,.0f}M{r['live']:>13,}"
                  f"{r['bytes_per_live_row']:>12,.0f}")

        chosen = [r for r in report if r["table"] in tables] if tables else []
        if do_all:
            # Bloat, not size: a big table that is dense has nothing to give.
            chosen = [r for r in report if r["bytes_per_live_row"] > 1200]
        if not chosen:
            print("\n  No table selected. Name one with --apply <table>, or --all.\n")
            await pool.close()
            return 0

        print(f"\n  SELECTED:")
        need = 0.0
        for r in chosen:
            # The rewrite's peak extra usage is the size of the NEW copy, which
            # exists alongside the old one until the swap. Estimated from live
            # rows at a dense width; indexes are rebuilt too.
            projected = r["total_mb"] * 0.4 if r["bytes_per_live_row"] > 1200 else r["total_mb"]
            need += projected
            print(f"    {r['table']:<32}{r['total_mb']:>9,.0f}M now  "
                  f"~{projected:,.0f}M new copy alongside it")
        print(f"\n  peak extra needed  ~{need:,.0f} MB "
              f"(+{SAFETY_MARGIN_MB} MB margin)   free: {free:,.0f} MB")
        if need + SAFETY_MARGIN_MB > free:
            print("\n  REFUSING: not enough headroom for the rewrite. VACUUM FULL "
                  "builds the new relation BEFORE dropping the old one, so "
                  "running this now risks hitting the ceiling mid-rewrite.\n")
            await pool.close()
            return 1

        acts = await other_activity(conn)
        print(f"\n  OTHER CONNECTIONS ({len(acts)}) — each blocks on the "
              f"ACCESS EXCLUSIVE lock:")
        for a in acts[:12]:
            print(f"    {a}")

        if not apply:
            print("\n  PLAN ONLY. Nothing was rewritten. Re-run with --apply.\n")
            await pool.close()
            return 0

        for r in chosen:
            print(f"\n  VACUUM FULL {r['table']} ...", flush=True)
            t0 = time.time()
            # No statement_timeout: a rewrite of a 1.8 GB table legitimately
            # exceeds any request-shaped limit, and being cancelled halfway
            # wastes the whole copy without freeing anything.
            await conn.execute("SET statement_timeout = 0")
            await conn.execute(f"VACUUM (FULL, ANALYZE) {r['table']}")
            after = await conn.fetchval(
                "SELECT pg_total_relation_size(to_regclass($1))", r["table"]) / 1e6
            print(f"    {r['total_mb']:,.0f} MB -> {after:,.0f} MB "
                  f"({r['total_mb'] - after:,.0f} MB reclaimed) "
                  f"in {time.time() - t0:,.0f}s")

        size2, free2 = await headroom(conn)
        print(f"\n  database {size:,.0f} MB -> {size2:,.0f} MB "
              f"({size - size2:,.0f} MB reclaimed), now "
              f"{size2 / DB_LIMIT_MB * 100:.1f}% full\n")

    await pool.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("tables", nargs="*")
    ap.add_argument("--all", action="store_true", dest="do_all")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.tables, a.do_all, a.apply)))
