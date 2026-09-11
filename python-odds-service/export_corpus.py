"""Phase 5.2 — export every frozen corpus row to Parquet.

    python export_corpus.py              # every corpus table
    python export_corpus.py odds_archive # one table

MAINTENANCE OPERATION, RUN DELIBERATELY. It holds one pooler connection (of 15)
for its duration, raises its own `statement_timeout` to 30 minutes, and competes
with the live worker — so it should not run during a busy slate.

IT DELETES NOTHING. Dropping the exported rows is `prune_corpus.py` (5.2d),
which re-verifies every partition against Postgres from scratch before it will
touch a row.

Resumable: a finished partition writes a manifest and is skipped on a rerun, so
an interruption costs only the partition it was in the middle of. The first real
run of this died 30 minutes in when the machine powered off, which is why that
exists.
"""
import asyncio
import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import corpus_store as cs          # noqa: E402
from corpus_location import corpus_location, staging_root  # noqa: E402

_peak = [0.0]
_stop = [False]


def _sample():
    import psutil

    p = psutil.Process(os.getpid())
    while not _stop[0]:
        _peak[0] = max(_peak[0], p.memory_info().rss / 1e6)
        time.sleep(0.05)


async def main(tables: list[str]) -> int:
    import db as _db

    backend = corpus_location()
    # Staging is local even when the corpus is REMOTE — see
    # `corpus_location.staging_root`. This used to refuse outright whenever
    # CORPUS_URI named an s3:// bucket, i.e. exactly once the corpus became
    # durable, and its advice was to undo that configuration.
    root = getattr(backend, "root", None) or staging_root()
    print(f"destination: {backend.describe}")
    print(f"staging    : {root}\n")

    threading.Thread(target=_sample, daemon=True).start()
    pool = await _db.get_pool()
    totals = {"rows": 0, "bytes": 0, "resumed": 0}
    failed: list[str] = []
    started = time.monotonic()

    for table in tables:
        def progress(part, v, _t=table):
            if v.get("skipped"):
                return
            tag = "resumed" if v.get("resumed") else f"{v['pg_rows']:>9,} rows"
            print(f"   {_t:<22}{str(part):<18}{tag}  "
                  f"{'OK' if v['ok'] else 'FAIL'}", flush=True)

        # Pooled: one short-lived connection PER PARTITION. Supabase's pooler
        # recycles connections, and holding one across ~196 partitions killed
        # two full-export attempts with ConnectionDoesNotExistError.
        r = await cs.export_table_pooled(pool, table, root, progress=progress)
        totals["rows"] += r["rows"]
        totals["bytes"] += r["bytes"]
        totals["resumed"] += r["resumed"]
        failed.extend(r["failed"])
        print(f"  -> {table}: {r['partitions']} partitions, {r['rows']:,} rows, "
              f"{r['bytes'] / 1e6:,.1f} MB, verified={r['all_verified']}")
        if r["stale_files"]:
            # Reported, never auto-removed: a file this run did not write is a
            # file this run does not understand.
            print(f"     {len(r['stale_files'])} STALE file(s) not claimed by any "
                  f"current partition — review before pruning:")
            for f in r["stale_files"][:5]:
                print(f"       {os.path.basename(f)}")
        print()

    _stop[0] = True
    print(f"TOTAL  {totals['rows']:,} rows  {totals['bytes'] / 1e6:,.1f} MB  "
          f"({totals['resumed']} partitions resumed)")
    print(f"       {time.monotonic() - started:,.0f}s, peak RSS {_peak[0]:,.0f} MB")
    if failed:
        print(f"\nFAILED VERIFICATION: {failed}")
        print("Nothing may be pruned until every partition verifies.")
    return 1 if failed else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    tables = args or list(cs.CORPUS)
    unknown = [t for t in tables if t not in cs.CORPUS]
    if unknown:
        print(f"unknown corpus table(s): {unknown}\nknown: {sorted(cs.CORPUS)}")
        sys.exit(2)
    sys.exit(asyncio.run(main(tables)))
