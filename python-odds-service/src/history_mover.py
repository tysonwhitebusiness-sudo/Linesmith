"""The history mover (P5 amendment A2, decision D24): closed days of the compact
history tables go to the Parquet corpus in Storage, are read back and verified,
and only then leave Postgres — by dropping the day's partition, never a DELETE.

    python src/history_mover.py            # one pass: export what is due, drop what is verified and old
    python src/history_mover.py --dry-run  # say what it would do; write nothing

WHERE IT RUNS: the health-check cron (`health_check.py` calls `run_mover()`
after its checks), on its own 512 MB instance. NOT the worker: Render's metrics
API showed the worker at a 335-350 MB median and a 477 MB peak of its 512 over
three days (2026-09-25), and a corpus export was measured at ~280 MB
(`corpus_store`'s note). The cron runs every 15 minutes, so a pass that finds
nothing due costs a few queries.

WHAT A PASS DOES, per table, per daily partition:
  1. EXPORT a closed day (its UTC day ended more than CLOSE_GRACE ago, so no
     write transaction can still land in it) that has no ledger row: stream its
     decoded rows (the corpus's own columns — for props, EXACTLY
     `prop_odds_history`'s 13, the schema the models read) into Parquet files
     of at most ROWS_PER_FILE rows (Storage refuses files over 50 MB), upload
     them, then READ EACH ONE BACK FROM STORAGE and compare row count and digest
     with what Postgres sent. The decoded count must also equal the partition's
     raw count: a row whose dictionary code is missing would decode to nothing,
     and this is where that would be caught. Only then is the ledger row
     (`odds_history_exports`) written with `verified_at`.
  2. DROP a day older than the guard's window (`disk_guard_state.hot_days`)
     whose ledger row is verified. For props, rows below
     `price_history.LEGACY_ID_CEILING` were converted from `prop_odds_history`
     and live in the corpus's old id-chunk files; a day holding any of them is
     dropped only once the `legacy` ledger row proves them all present.
  3. PUBLISH the prop floor (`corpus:retained-floor:prop_price_history`): the
     start of the oldest day still held, which the price chart reads.

Prop rows below the legacy ceiling are never exported here (they are already in
the corpus); a day's file holds its ids at or above it.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import corpus_store as cs                                      # noqa: E402
import db                                                      # noqa: E402
import price_history as ph                                     # noqa: E402

ROWS_PER_FILE = 1_500_000
FETCH_ROWS = 20_000
CLOSE_GRACE = timedelta(hours=2)
HEARTBEAT = "historyMover"

# Corpus directory per table. Props keep the directory (and schema) they have
# always had, so one glob reads the id-chunk files and the day files together.
CORPUS_NAME = {ph.PROP_TABLE: "prop_odds_history", ph.GAME_TABLE: "game_lines_history"}


def _day_where(table: str, day: date) -> str:
    lo = f"'{day.isoformat()} 00:00:00+00'::timestamptz"
    hi = f"'{(day + timedelta(days=1)).isoformat()} 00:00:00+00'::timestamptz"
    where = f"h.recorded_at >= {lo} AND h.recorded_at < {hi}"
    if table == ph.PROP_TABLE:
        where += f" AND h.id >= {ph.LEGACY_ID_CEILING}"
    return where


def _arrow_schema(table: str):
    import pyarrow as pa

    fields = []
    for name, pgtype in ph.corpus_columns(table):
        if pgtype.startswith("timestamp"):
            t = pa.timestamp("us", tz="UTC")
        else:
            t = getattr(pa, cs._PG_TO_ARROW[pgtype])()
        fields.append(pa.field(name, t, nullable=True))
    return pa.schema(fields)


def file_name(table: str, day: date, part: int) -> str:
    return f"{CORPUS_NAME[table]}_d{day:%Y%m%d}_{part:02d}.parquet"


async def export_day(pool, backend, table: str, day: date, workdir: str) -> dict:
    """Stream one day to Parquet, upload, read back, verify. Returns the ledger row."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    cols = [c for c, _ in ph.corpus_columns(table)]
    schema = _arrow_schema(table)
    where = _day_where(table, day)
    sent = cs.RowDigest(cols)
    files: list[str] = []
    writer = None
    in_file = 0
    t0 = time.monotonic()
    async with pool.acquire(timeout=120.0) as conn:
        async with conn.transaction():
            await conn.execute(f"SET LOCAL statement_timeout = '{cs.EXPORT_STATEMENT_TIMEOUT}'")
            raw_n = await conn.fetchval(f"SELECT count(*) FROM {table} h WHERE {where}")
            cur = await conn.cursor(ph.decoded_select(table, where))
            try:
                while True:
                    recs = await cur.fetch(FETCH_ROWS)
                    if not recs:
                        break
                    chunk = [tuple(cs._cell(r[c]) for c in cols) for r in recs]
                    del recs
                    sent.update(chunk)
                    batch = pa.table({c: [row[i] for row in chunk] for i, c in enumerate(cols)}, schema=schema)
                    del chunk
                    if writer is None or in_file >= ROWS_PER_FILE:
                        if writer is not None:
                            writer.close()
                        files.append(os.path.join(workdir, file_name(table, day, len(files))))
                        writer = pq.ParquetWriter(files[-1], schema, compression="zstd")
                        in_file = 0
                    writer.write_table(batch)
                    in_file += batch.num_rows
                    del batch
            finally:
                if writer is not None:
                    writer.close()
    export_s = time.monotonic() - t0

    part = f"d{day:%Y%m%d}"
    if sent.rows != raw_n:
        raise RuntimeError(f"{table} {part}: decoded {sent.rows} rows but the partition holds {raw_n} "
                           f"— a dictionary code is missing. Nothing exported.")

    # Upload, then verify what Storage now holds, not what is on local disk.
    keys, nbytes = [], 0
    for path in files:
        nbytes += os.path.getsize(path)
        keys.append(await asyncio.to_thread(backend.put, path, CORPUS_NAME[table], os.path.basename(path)))
    landed = cs.RowDigest(cols)
    for path in files:
        src = await asyncio.to_thread(backend.open_object, CORPUS_NAME[table], os.path.basename(path))
        pf = pq.ParquetFile(src)
        if list(pf.schema_arrow.names) != cols:
            raise RuntimeError(f"{table} {part}: uploaded schema {pf.schema_arrow.names} != {cols}")
        for b in pf.iter_batches(batch_size=FETCH_ROWS):
            d = b.to_pydict()
            landed.update(zip(*(d[c] for c in cols)))
        os.remove(path)
    ok = landed.rows == sent.rows and landed.hexdigest() == sent.hexdigest()
    row = {"table_name": table, "part": part, "rows": sent.rows, "digest": sent.hexdigest(),
           "object_key": ",".join(keys) or None, "bytes": nbytes, "verified": ok,
           "export_s": round(export_s, 1), "files": len(files)}
    if not ok:
        raise RuntimeError(f"{table} {part}: Storage copy does not match Postgres "
                           f"(sent {sent.rows}/{sent.hexdigest()}, landed {landed.rows}/{landed.hexdigest()})")
    async with pool.acquire(timeout=60.0) as conn:
        await conn.execute(
            """INSERT INTO odds_history_exports (table_name, part, rows, digest, object_key, bytes, exported_at, verified_at)
               VALUES ($1, $2, $3, $4, $5, $6, now(), now())
               ON CONFLICT (table_name, part) DO UPDATE SET rows = excluded.rows, digest = excluded.digest,
                 object_key = excluded.object_key, bytes = excluded.bytes, exported_at = excluded.exported_at,
                 verified_at = excluded.verified_at""",
            table, part, sent.rows, sent.hexdigest(), row["object_key"], nbytes)
    return row


async def _hot_days(conn) -> int:
    import disk_guard

    st = await disk_guard.read_state(conn)
    return int(st["hot_days"]) if st else disk_guard.HOT_DAYS


async def run_mover(dry_run: bool = False, max_exports: int | None = None) -> dict:
    """One pass. Returns a summary; records it as the `historyMover` heartbeat."""
    from corpus_location import corpus_location

    now = datetime.now(timezone.utc)
    today = now.date()
    backend = corpus_location()
    from corpus_location import LocalCorpus

    if isinstance(backend, LocalCorpus) and not os.environ.get("HISTORY_MOVER_ALLOW_LOCAL"):
        # A local corpus on a hosted instance is an ephemeral disk: an export
        # "verified" there and followed by a DROP would lose the day for good.
        # Same rule as prune_corpus: no deletes while the corpus is local-only.
        raise RuntimeError(f"the corpus is local ({backend.describe}): set CORPUS_URI and CORPUS_S3_* "
                           f"on this service. Nothing exported, nothing dropped.")
    pool = await db.get_pool()
    done: list[dict] = []
    dropped: list[str] = []
    waiting: list[str] = []
    async with pool.acquire(timeout=60.0) as conn:
        hot = await _hot_days(conn)
        ledger = {(r["table_name"], r["part"]): dict(r) for r in
                  await conn.fetch("SELECT * FROM odds_history_exports")}
        plan = {t: await ph.partition_days(conn, t) for t in ph.HISTORY_TABLES}

    legacy_ok = bool(ledger.get((ph.PROP_TABLE, "legacy"), {}).get("verified_at"))
    with tempfile.TemporaryDirectory(prefix="history-mover-") as workdir:
        for table, parts in plan.items():
            for p in parts:
                day, part = p["day"], f"d{p['day']:%Y%m%d}"
                closed = datetime.combine(day + timedelta(days=1), datetime.min.time(), timezone.utc) + CLOSE_GRACE <= now
                if not closed:
                    continue
                if (table, part) not in ledger:
                    if dry_run or (max_exports is not None and len(done) >= max_exports):
                        waiting.append(f"{table}:{part} export")
                        continue
                    row = await export_day(pool, backend, table, day, workdir)
                    ledger[(table, part)] = {"verified_at": now}
                    done.append(row)
                if day >= today - timedelta(days=hot):
                    continue
                if not ledger[(table, part)].get("verified_at"):
                    waiting.append(f"{table}:{part} unverified")
                    continue
                if table == ph.PROP_TABLE and not legacy_ok:
                    async with pool.acquire(timeout=60.0) as conn:
                        has_legacy = await conn.fetchval(
                            f"SELECT EXISTS (SELECT 1 FROM {p['name']} WHERE id < {ph.LEGACY_ID_CEILING})")
                    if has_legacy:
                        waiting.append(f"{table}:{part} legacy rows not yet proven in the corpus")
                        continue
                if dry_run:
                    waiting.append(f"{table}:{part} drop")
                    continue
                async with pool.acquire(timeout=60.0) as conn:
                    async with conn.transaction():
                        await conn.execute("SET LOCAL lock_timeout = '10s'")
                        await conn.execute(f"DROP TABLE IF EXISTS {p['name']}")
                        await conn.execute("UPDATE odds_history_exports SET dropped_at = now() "
                                           "WHERE table_name = $1 AND part = $2", table, part)
                dropped.append(f"{table}:{part}")

        if dropped and not dry_run:
            async with pool.acquire(timeout=60.0) as conn:
                days = await ph.partition_days(conn, ph.PROP_TABLE)
                floor = datetime.combine(days[0]["day"], datetime.min.time(), timezone.utc) if days else None
                await conn.execute(
                    """INSERT INTO snapshot_cache (cache_key, payload, fetched_at) VALUES ($1, $2, now())
                       ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at""",
                    "corpus:retained-floor:prop_price_history",
                    json.dumps({"table": ph.PROP_TABLE, "hot_days": hot,
                                "floor": floor.isoformat() if floor else None}))

    summary = {"hot_days": hot, "exported": [f"{r['table_name']}:{r['part']} {r['rows']} rows "
                                             f"{r['bytes']} B {r['export_s']}s" for r in done],
               "dropped": dropped, "waiting": waiting, "dry_run": dry_run}
    if not dry_run:
        try:
            import psutil

            summary["rss_mb"] = round(psutil.Process().memory_info().rss / 1e6, 1)
        except Exception:                                   # noqa: BLE001
            pass
        await db.write_health_check_results([{
            "name": HEARTBEAT, "healthy": True,
            "status": f"exported {len(done)}, dropped {len(dropped)}, window {hot} days",
            "raw": {**summary, "ran_at": now.isoformat()},
        }])
    return summary


async def _main(a) -> int:
    try:
        print(json.dumps(await run_mover(a.dry_run, a.max_exports), indent=2, default=str))
        return 0
    except Exception as e:                                  # noqa: BLE001
        await db.write_health_check_results([{
            "name": HEARTBEAT, "healthy": False, "status": f"FAILED: {type(e).__name__}: {e}"[:400],
            "raw": {"ran_at": datetime.now(timezone.utc).isoformat()},
        }])
        raise


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-exports", type=int, default=None)
    raise SystemExit(asyncio.run(_main(ap.parse_args())))
