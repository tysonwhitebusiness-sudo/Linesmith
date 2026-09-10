"""Phase 5.2d — drop from Postgres only what the corpus provably already holds.

    python prune_corpus.py                    # VERIFY ONLY. Deletes nothing.
    python prune_corpus.py --apply <table>    # verify, then delete, one table

THIS IS THE ONLY DESTRUCTIVE STEP IN PHASE 5, AND IT IS DELIBERATELY AWKWARD.

What it can destroy cannot be rebuilt from any source:

    odds_archive         27.3 years, back to 1999-09-12
    game_result          27.0 years
    player_game_history  16.1 years
    prop_odds_archive     1.5 years, and lib/db/client.ts records that NO
                          BACKFILL EXISTS ANYWHERE for it
    mlb_pitch_events      2.5 years

FOUR RULES, EACH ONE LOAD-BEARING.

1. VERIFICATION IS INDEPENDENT OF THE EXPORT. The export's own manifests are
   NOT trusted here. Every partition is re-read from the corpus and re-compared
   against live Postgres, because the manifest was written by the same code
   whose correctness is in question, and because resume skips partitions on a
   cheap size check that has no authority over a delete.

2. DELETION IS BY VERIFIED ROW ID, NOT BY PREDICATE. A predicate re-evaluated
   at delete time can match rows the export never saw — a row inserted since,
   or one whose `event_start` passed in the meantime. The delete names the exact
   ids the corpus was proven to contain and nothing else.

3. ONE TABLE AT A TIME, EXPLICITLY NAMED. There is no `--all`. Pruning
   everything in one command is how a mistake becomes total instead of partial.

4. IT REFUSES WHILE THE CORPUS IS LOCAL-ONLY unless forced. Deleting the last
   remote copy of irreplaceable data when the only surviving copy sits on one
   machine's disk is not a backup, it is a single point of failure — and this
   machine lost power mid-export once already today.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import corpus_store as cs                                    # noqa: E402
from corpus_location import LocalCorpus, corpus_location      # noqa: E402

# Deleted in batches so one statement never holds a lock on a huge id list, and
# so an interruption leaves a partially pruned table rather than a stuck one.
DELETE_BATCH = 5_000


async def verify_partition_live(conn, table: str, part: tuple, path: str) -> dict:
    """Re-derive the partition from Postgres and compare it to the file.

    Returns the verdict AND the exact ids the corpus holds, because those ids —
    not a predicate — are what a delete is allowed to touch.
    """
    import pyarrow.parquet as pq

    cols = await cs.column_names(conn, table)
    if not os.path.exists(path):
        # EVERY verdict carries the same keys, including the early returns.
        # The first version omitted `live_rows` here and the caller raised
        # KeyError on the first partition with no file -- which is a normal
        # state, not an error: `mlb_pitch_events` is partitioned over a
        # contiguous id range and legitimately has empty chunks. A verify tool
        # that crashes on a normal state is a verify tool nobody can trust.
        return {"ok": False, "reason": "corpus file missing", "path": path,
                "partition": part, "live_rows": 0, "file_rows": 0,
                "digest_match": False, "ids_missing_from_corpus": 0, "ids": []}

    live = cs.RowDigest(cols)
    ids: list[int] = []
    sql, prefix = cs._partition_query(table, cols, part, cs.CHUNK_ROWS)
    last_id = -1
    while True:
        raw = await conn.fetch(sql, *prefix, last_id)
        if not raw:
            break
        chunk = [tuple(cs._cell(r[c]) for c in cols) for r in raw]
        live.update(chunk)
        ids.extend(int(r["id"]) for r in raw)
        last_id = raw[-1]["id"]

    stored = cs.RowDigest(cols)
    pf = pq.ParquetFile(path)
    file_ids: set[int] = set()
    id_i = cols.index("id")
    for batch in pf.iter_batches(batch_size=cs.CHUNK_ROWS):
        d = batch.to_pydict()
        rows = list(zip(*(d[c] for c in cols)))
        stored.update(rows)
        file_ids.update(int(r[id_i]) for r in rows)

    ok = (list(pf.schema_arrow.names) == cols
          and live.rows == stored.rows
          and live.hexdigest() == stored.hexdigest())
    # Belt and braces: the digest already covers this, but a delete is worth an
    # explicit id-level check rather than a hash argument.
    missing = [i for i in ids if i not in file_ids]
    return {
        "ok": bool(ok and not missing), "path": path, "partition": part,
        "live_rows": live.rows, "file_rows": stored.rows,
        "digest_match": live.hexdigest() == stored.hexdigest(),
        "ids_missing_from_corpus": len(missing),
        "ids": ids if ok and not missing else [],
    }


async def prune_table(conn, table: str, backend, apply: bool,
                      allow_local: bool) -> int:
    if isinstance(backend, LocalCorpus) and apply and not allow_local:
        print("REFUSING TO DELETE. The corpus is local-only "
              f"({backend.describe}).\n"
              "  These rows cannot be rebuilt from any source, and a copy that "
              "lives on one\n  machine's disk is a single point of failure — "
              "this machine lost power\n  mid-export earlier today.\n"
              "  Put the corpus in object storage (5.2c: set CORPUS_S3_*), or "
              "pass\n  --i-have-my-own-backup to override deliberately.")
        return 2

    root = getattr(backend, "root", None)
    if root is None:
        print("Pruning currently verifies against a local staging copy; "
              "download the corpus first.")
        return 2

    await conn.execute(f"SET statement_timeout = '{cs.EXPORT_STATEMENT_TIMEOUT}'")
    parts = await cs.partitions_for(conn, table)
    print(f"{table}: {len(parts)} partitions to verify "
          f"({'APPLY' if apply else 'VERIFY ONLY'})\n")

    total_ids = 0
    deleted = 0
    bad: list[str] = []
    for part in parts:
        path = os.path.join(root, table, f"{cs.partition_name(table, part)}.parquet")
        v = await verify_partition_live(conn, table, part, path)
        if v["live_rows"] == 0 and not os.path.exists(path):
            continue          # an empty id-chunk or an off-season year
        if v["live_rows"] == 0 and v["file_rows"] == 0:
            continue
        status = "OK" if v["ok"] else "MISMATCH"
        print(f"   {str(part):<18}live {v['live_rows']:>9,}  file {v['file_rows']:>9,}  "
              f"{status}")
        if not v["ok"]:
            bad.append(f"{part}: {v.get('reason') or 'digest/ids differ'}")
            continue
        total_ids += len(v["ids"])
        if apply and v["ids"]:
            for i in range(0, len(v["ids"]), DELETE_BATCH):
                batch = v["ids"][i:i + DELETE_BATCH]
                # BY ID, never by predicate — see rule 2.
                res = await conn.execute(
                    f"DELETE FROM {table} WHERE id = ANY($1::bigint[])", batch)
                deleted += int(res.split()[-1]) if res.split()[-1].isdigit() else 0

    print()
    if bad:
        print(f"{len(bad)} partition(s) FAILED verification — nothing deleted for them:")
        for b in bad[:10]:
            print(f"   {b}")
        print("Re-export those partitions and re-run before pruning.")
        return 1
    if apply:
        print(f"DELETED {deleted:,} rows from {table} "
              f"(verified present in the corpus).")
        print("Space is NOT returned to the filesystem until a VACUUM FULL — see "
              "5.4.")
    else:
        print(f"VERIFY ONLY: {total_ids:,} rows in {table} are provably in the "
              f"corpus and would be deleted by --apply. Nothing was changed.")
    return 0


async def main(args) -> int:
    import db as _db

    backend = corpus_location()
    print(f"corpus: {backend.describe}\n")
    pool = await _db.get_pool()
    rc = 0
    async with pool.acquire(timeout=3600.0) as conn:
        for table in args.tables:
            rc |= await prune_table(conn, table, backend, args.apply,
                                    args.i_have_my_own_backup)
    return rc


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Phase 5.2d — verify, then prune")
    ap.add_argument("tables", nargs="*", default=None,
                    help="corpus table(s); required with --apply")
    ap.add_argument("--apply", action="store_true",
                    help="actually delete (default is verify-only)")
    ap.add_argument("--i-have-my-own-backup", action="store_true",
                    help="allow --apply while the corpus is local-only")
    a = ap.parse_args()
    a.tables = a.tables or list(cs.CORPUS)
    unknown = [t for t in a.tables if t not in cs.CORPUS]
    if unknown:
        print(f"unknown corpus table(s): {unknown}")
        sys.exit(2)
    if a.apply and len(a.tables) != 1:
        # Rule 3: one table at a time, named. A mistake should be partial.
        print("--apply takes exactly ONE named table.")
        sys.exit(2)
    sys.exit(asyncio.run(main(a)))
