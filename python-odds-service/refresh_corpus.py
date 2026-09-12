"""Keep the corpus current: incremental export, then upload. One command.

    python refresh_corpus.py                    # every id-chunked corpus table
    python refresh_corpus.py prop_odds_history
    python refresh_corpus.py --check            # report lag; write nothing

THIS EXISTS BECAUSE A HOT WINDOW MAKES THE EXPORT LOAD-BEARING. Before 5.S.8,
`prop_odds_history` held everything, and an export that fell behind cost nothing
but freshness. Now Postgres keeps 14 days and the corpus is the ONLY copy of
anything older, so an export that stops is a clock running against permanent
loss. `prune_corpus` refuses to delete a row it cannot see in the corpus, so
this fails safe rather than losing data — but it fails *silently*, by quietly
ceasing to reclaim space while the table grows.

----------------------------------------------------------------------------
THE BUG THIS FIXES, which is not about scheduling at all
----------------------------------------------------------------------------

**`resume` SKIPS THE LAST PARTITION FOREVER, AND THAT LEAVES A PERMANENT HOLE.**

An id-chunked table is partitioned `[lo, lo+500_000)` across `min(id)..max(id)`.
The FINAL partition of any run covers a range that is only PARTLY populated —
ids in it are still being written. `export_partition` writes what exists,
`write_manifest` records it, and on the next run `completed_manifest` sees a
file whose byte count still matches its manifest and reports it done.

It is never revisited. Once `max(id)` grows past that partition's upper bound,
the rows written into it between the two runs exist in Postgres and in no
Parquet file, and nothing will ever export them. The manifest says the
partition is complete, and by its own accounting it is.

`mlb_pitch_events` is the other id-chunked table and has the same exposure.

THE RULE: a partition `[lo, lo+SPAN)` is complete only once `max(id) >=
lo+SPAN`, because ids are assigned monotonically by a sequence and no later row
can land below a bound that has already been passed. Anything else is still
open. So this invalidates the manifest of every partition whose upper bound
exceeds the CURRENT `max(id)` before exporting — normally exactly one.

WHERE THIS RUNS: THE OPERATOR'S MACHINE, NOT THE RENDER WORKER, and that is
measured rather than preferred. `corpus_store` records peak RSS of ~280 MB for a
single partition export (this session measured 312 MB on `prop_odds_history`)
against a 512 MB plan shared with 37 other jobs. Schedule it beside
OddsHarvester's tasks. `--check` is the cheap half and is safe anywhere: it
reports how far the corpus lags without exporting anything.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import corpus_store as cs                                     # noqa: E402
from corpus_location import corpus_location, staging_root     # noqa: E402
import db                                                     # noqa: E402

# The name check_corpus_freshness looks for. One string, two files.
CORPUS_REFRESH_CHECK = "corpus_refresh"

# Only these are keyset-chunked on `id` and therefore subject to the open-final-
# partition rule above. Date-partitioned tables re-export a whole year, so their
# current partition is rewritten naturally.
ID_CHUNKED = [t for t, spec in cs.CORPUS.items() if spec.partition_by == "id_chunk"]


def _corpus_max_id(table: str):
    """Highest `id` the corpus holds, or None if it cannot be read.

    Blocking (DuckDB over S3) -- call through `asyncio.to_thread`, or it
    starves asyncpg's keepalive until the pooler drops the connection.
    """
    try:
        from corpus_location import corpus_location, read_parquet_glob

        con, glob = read_parquet_glob(corpus_location(), table)
        try:
            row = con.execute(
                "SELECT max(id) FROM read_parquet(?)", [glob]).fetchone()
        finally:
            con.close()
        return int(row[0]) if row and row[0] is not None else None
    except Exception:                                         # noqa: BLE001
        return None


async def open_partitions(conn, table: str, root: str) -> list[str]:
    """Manifests to invalidate: partitions whose id range is not yet closed."""
    max_id = await conn.fetchval(f"SELECT max(id) FROM {table}")
    if max_id is None:
        return []
    stale = []
    for part in await cs.partitions_for(conn, table):
        lo = part[1]
        if lo + cs.ID_CHUNK_SPAN > max_id:          # still open — ids may land here
            path = os.path.join(root, table,
                                f"{cs.partition_name(table, part)}.parquet")
            if os.path.exists(cs.manifest_path(path)):
                stale.append(cs.manifest_path(path))
    return stale


async def main(tables: list[str], check_only: bool) -> int:
    backend = corpus_location()
    root = getattr(backend, "root", None) or staging_root()
    pool = await db.get_pool()
    print(f"\n{'=' * 78}\nCORPUS REFRESH\n{'=' * 78}")
    print(f"  corpus : {backend.describe}")
    print(f"  staging: {root}\n")

    lagging: list[str] = []
    async with pool.acquire(timeout=600.0) as conn:
        await conn.execute("SET statement_timeout = '15min'")
        for table in tables:
            spec = cs.CORPUS[table]
            col = spec.partition_col
            newest = await conn.fetchval(f"SELECT max({col}) FROM {table}")
            # LAG IS "NOT YET IN THE CORPUS", NOT "FROZEN". The first version of
            # this counted frozen rows and reported 4,389,730 for
            # `prop_odds_history` — every one of which was already exported and
            # deliberately retained inside the 14-day window. Frozen says a row
            # will never change; it says nothing about whether anyone copied it.
            # The honest measure compares the highest id the corpus holds with
            # the highest Postgres holds.
            corpus_max = await asyncio.to_thread(_corpus_max_id, table)
            if corpus_max is None:
                unexported, detail = None, "corpus unreadable"
            else:
                unexported = await conn.fetchval(
                    f"SELECT count(*) FROM {table} "
                    f" WHERE id > $1 AND {spec.frozen_where()}", corpus_max)
                detail = f"corpus reaches id {corpus_max:,}"
            stale = await open_partitions(conn, table, root)
            print(f"  {table}")
            print(f"     newest row          {newest}")
            print(f"     frozen, UNEXPORTED  "
                  f"{'unknown' if unexported is None else f'{unexported:,} rows'}"
                  f"   ({detail})")
            print(f"     open partitions     {len(stale)} manifest(s) to invalidate")
            if not check_only:
                for m in stale:
                    os.remove(m)
            # One day of inflow is the alarm. Below that the export is simply
            # due; above it, something has stopped running.
            if unexported is None or unexported > 500_000:
                lagging.append(table)

    if check_only:
        print("\n  CHECK ONLY. Nothing exported.\n")
        await _close(pool)
        return 1 if lagging else 0

    # Export, then upload. Both are idempotent and both verify.
    import subprocess

    for cmd in (["export_corpus.py", *tables], ["upload_corpus.py", *tables]):
        print(f"\n  $ {cmd[0]} {' '.join(tables)}", flush=True)
        r = subprocess.run([sys.executable, os.path.join(HERE, cmd[0]), *tables],
                           cwd=HERE)
        if r.returncode != 0:
            print(f"\n  {cmd[0]} FAILED (exit {r.returncode}); stopping.\n")
            await _write_heartbeat(False, {"step": cmd[0], "exit": r.returncode,
                                           "tables": tables})
            await _close(pool)
            return r.returncode

    await _write_heartbeat(True, {"tables": tables, "lagging_before": lagging})
    await _close(pool)
    return 0


async def _write_heartbeat(ok: bool, detail: dict) -> None:
    """Tell the Render worker this task is alive.

    WHY THIS EXISTS. `check_corpus_freshness` runs on the worker; this script
    runs as a Windows Scheduled Task on the operator's machine. The worker
    cannot see Task Scheduler, so before this it could only INFER liveness from
    a row-count lag -- and a row count cannot separate "mid-cycle, working
    fine" from "stopped three days ago". Only a heartbeat can.

    Same gap, same fix, as OddsHarvester: a producer outside JOB_REGISTRY writes
    its own breadcrumb and the check reads it. There, rows were written
    diligently, nothing consumed them, and the outage hid for ten days.

    Never raises. A heartbeat that breaks the export it monitors would be worse
    than no heartbeat at all.
    """
    try:
        await db.write_health_check_results([{
            "name": CORPUS_REFRESH_CHECK,
            "healthy": ok,
            "status": "healthy - export completed" if ok else "export FAILED",
            "raw": {**detail, "ran_at": datetime.now(timezone.utc).isoformat()},
        }])
    except Exception as e:                                    # noqa: BLE001
        print(f"[refresh_corpus] heartbeat write failed: {type(e).__name__}: {e}", flush=True)


async def _close(pool) -> None:
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                         # noqa: BLE001
        pool.terminate()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("tables", nargs="*", default=None)
    ap.add_argument("--check", action="store_true",
                    help="report lag only; safe to run anywhere")
    a = ap.parse_args()
    tabs = a.tables or ID_CHUNKED
    unknown = [t for t in tabs if t not in cs.CORPUS]
    if unknown:
        print(f"unknown corpus table(s): {unknown}")
        raise SystemExit(2)
    raise SystemExit(asyncio.run(main(tabs, a.check)))
