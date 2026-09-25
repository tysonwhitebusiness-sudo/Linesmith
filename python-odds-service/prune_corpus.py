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
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import corpus_store as cs                                    # noqa: E402
from corpus_location import LocalCorpus, corpus_location      # noqa: E402

# Deleted in batches so one statement never holds a lock on a huge id list, and
# so an interruption leaves a partially pruned table rather than a stuck one.
DELETE_BATCH = 5_000


async def verify_partition_live(conn, table: str, part: tuple, path: str,
                                backend=None, filename: str | None = None,
                                spec: "cs.CorpusTable | None" = None) -> dict:
    """Compare the corpus file to live Postgres, and return the ids it is SAFE
    to delete.

    THE CHECK IS A SUBSET CHECK, NOT AN EQUALITY CHECK, AND THAT DISTINCTION IS
    THE WHOLE DESIGN. The first version demanded live == file exactly, and it
    failed on `prop_odds_archive ('mlb', 2026)`: live held 899,868 rows against
    the file's 896,885. Nothing was corrupt -- `archivePropsJob` runs every five
    minutes, and 2,983 rows crossed their freeze boundary between the export and
    the verify. An equality rule would block pruning FOREVER on any table still
    receiving writes, which is every table worth pruning.

    The property that actually matters is narrower: NEVER DELETE A ROW THAT IS
    NOT IN THE CORPUS. So:

      * a row live but not in the file  -> not deleted, waits for the next export
      * a row in the file but not live  -> already gone; nothing to do
      * a row in BOTH, content equal    -> safe to delete
      * a row in BOTH, content DIFFERS  -> CORRUPTION. The partition is refused
                                           outright; this is the case the digest
                                           existed to catch, and it survives.

    Content is compared per-id rather than by an aggregate digest, because an
    aggregate over two sets that are legitimately different sizes cannot
    distinguish "behind" from "wrong".
    """
    import hashlib

    import pyarrow.parquet as pq

    cols = await cs.column_names(conn, table)
    # THE CORPUS IS READ WHERE IT LIVES, which since 5.2c is object storage.
    # This used to require a local staging copy and refused outright without
    # one -- and the staging copy is exactly the thing that does not survive a
    # session. Downloading 130 MB to verify a delete that reads the same bytes
    # remotely was never the safety property; having read them back at all is.
    source = path
    multi = backend is not None and part[0] is None     # P5.1: an id chunk = main + supplements
    if multi:
        pass                                             # read below, every object the chunk has
    elif backend is not None and filename is not None and not os.path.exists(path):
        try:
            source = backend.open_object(table, filename)
        except Exception as e:                              # noqa: BLE001
            return {"ok": False, "reason": f"corpus unreadable: {e}", "path": path,
                    "partition": part, "live_rows": 0, "file_rows": 0,
                    "deletable": 0, "live_only": 0, "file_only": 0,
                    "corrupt": 0, "ids": []}
    elif not os.path.exists(path):
        # EVERY verdict carries the same keys, including the early returns. The
        # first version omitted `live_rows` and the caller raised KeyError on the
        # first partition with no file -- a NORMAL state, since mlb_pitch_events
        # is partitioned over a contiguous id range with empty chunks in it.
        return {"ok": False, "reason": "corpus file missing", "path": path,
                "partition": part, "live_rows": 0, "file_rows": 0,
                "deletable": 0, "live_only": 0, "file_only": 0,
                "corrupt": 0, "ids": []}

    _fp = cs.fingerprint          # the one implementation (corpus_store)

    id_i = cols.index("id")
    file_fp: dict[int, int] = {}
    if multi:
        # P5.1: an id chunk is its main file PLUS its supplements (rows the
        # main file missed, added without rewriting it). Read them all.
        file_fp, _names = await asyncio.to_thread(cs.chunk_fingerprints, backend, table, part, cols)
        schema_checked = True
    else:
        pf = pq.ParquetFile(source)
        for batch in pf.iter_batches(batch_size=cs.CHUNK_ROWS):
            d = batch.to_pydict()
            for row in zip(*(d[c] for c in cols)):
                file_fp[int(row[id_i])] = _fp(row)
        schema_checked = False

    live_rows = 0
    deletable: list[int] = []
    live_only = 0
    corrupt: list[int] = []
    # `spec` overrides the registry: the legacy proof (P5) verifies a table that
    # has left CORPUS, with every row counted.
    sql, prefix = cs._partition_query(table, cols, part, cs.CHUNK_ROWS, spec)
    last_id = -1
    while True:
        raw = await conn.fetch(sql, *prefix, last_id)
        if not raw:
            break
        for r in raw:
            live_rows += 1
            rid = int(r["id"])
            want = file_fp.get(rid)
            if want is None:
                live_only += 1                 # exported later, not yet copied
            elif want == _fp(tuple(cs._cell(r[c]) for c in cols)):
                deletable.append(rid)
            else:
                corrupt.append(rid)
        last_id = raw[-1]["id"]

    # chunk_fingerprints raises on a schema mismatch, so reaching here means it matched.
    schema_ok = True if schema_checked else list(pf.schema_arrow.names) == cols
    return {
        "ok": bool(schema_ok and not corrupt),
        "path": path, "partition": part,
        "live_rows": live_rows, "file_rows": len(file_fp),
        "deletable": len(deletable),
        "live_only": live_only,
        "file_only": len(file_fp) - (len(deletable) + len(corrupt)),
        "corrupt": len(corrupt),
        "reason": (None if schema_ok else "schema differs") or
                  (f"{len(corrupt)} row(s) differ in content" if corrupt else None),
        "ids": deletable if (schema_ok and not corrupt) else [],
    }


# Tables that keep a RECENT tail in Postgres on top of the unfrozen rows,
# because a live consumer reads by recency rather than by freeze state.
#
# `odds_archive` is the case: `health_check.check_capture_latency` measures the
# median capture-to-start over `captured_at > now() - interval '7 days'`, and
# almost every row in that window is FROZEN (the game has started). Pruning on
# freeze state alone would leave that check a handful of rows, and a median over
# a handful is not a health check, it is a coin toss that reports a number.
# 30 days of odds_archive is 20,258 rows -- the margin costs nothing and is
# wider than the only consumer that needs it.
KEEP_RECENT_DAYS = {
    "odds_archive": 30,
    # Phase 5.S.8. This is the SERVING window, not a safety margin: TypeScript
    # reads this table and has no DuckDB, so no corpus read. Whatever is not
    # here cannot be served at all.
    #
    # 10 days since 2026-09-23 (was 14). Set by the longest-looking reader,
    # which is the GAME PAGE: `readPreGamePropOddsForGame` (lib/db/client.ts)
    # serves a started game's pre-game prop prices from here, because
    # `prop_odds` drops its rows after 7 days. 10 keeps last week's NFL game
    # researchable with margin; 7 would have put last Sunday's lines exactly
    # at the edge. The others need less: Slate movers look back 7 days,
    # per-key grading runs every 15 minutes on just-finished games, and the
    # price chart clamps itself to the retained floor (`retainedHours()`).
    # User CLV needed unlimited lookback from here and was deleted instead
    # (709d807). Model CLV reads `game_odds_history`, which is not pruned.
    #
    # P5 (2026-09-25): no longer here. The table became the day-partitioned
    # `prop_price_history`, whose window (still 10 days, `disk_guard.HOT_DAYS`)
    # is kept by `history_mover.py` dropping whole verified days.
    # R5 (2026-09-14). NOT a serving window: the hourly Statcast ingest
    # re-fetches the last 3 days, so a pitch pruned inside that window comes
    # back under a new id and is exported twice (see corpus_store's
    # PITCH_EVENTS_PREDICATE). The freeze rule now keeps new exports clear of the
    # window; this also protects rows already exported under the old rule.
    "mlb_pitch_events": 5,
}


async def _recent_ids(conn, table: str, days: int) -> set[int]:
    """Ids too recent to delete regardless of freeze state."""
    cols = await cs.column_names(conn, table)
    preds = []
    if "captured_at" in cols:
        preds.append(f"captured_at > now() - interval '{days} days'")
    if "game_date" in cols:
        preds.append(f"game_date > current_date - {days}")
    if "observed_at" in cols:
        # `prop_odds_history` has NEITHER of the above -- only `observed_at`.
        # Without this it would match no predicate, `_recent_ids` would return
        # an empty set, and the margin would silently protect nothing.
        preds.append(f"observed_at > now() - interval '{days} days'")
    if not preds:
        return set()
    rows = await conn.fetch(
        f"SELECT id FROM {table} WHERE {' OR '.join(preds)}")
    return {int(r["id"]) for r in rows}


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

    # No local copy is required any more: `verify_partition_live` reads the
    # corpus object from the backend when the file is not on disk. `root` is
    # still used as the preferred source when a local staging copy DOES exist,
    # because reading a local file is free and reading S3 is not.
    root = getattr(backend, "root", None) or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "corpus")

    await conn.execute(f"SET statement_timeout = '{cs.EXPORT_STATEMENT_TIMEOUT}'")
    parts = await cs.partitions_for(conn, table)
    print(f"{table}: {len(parts)} partitions to verify "
          f"({'APPLY' if apply else 'VERIFY ONLY'})\n")

    keep_days = KEEP_RECENT_DAYS.get(table, 0)
    keep_ids: set[int] = set()
    if keep_days:
        keep_ids = await _recent_ids(conn, table, keep_days)
        print(f"   retention margin: keeping {len(keep_ids):,} row(s) newer than "
              f"{keep_days} days regardless of freeze state\n")

    total_ids = 0
    deleted = 0
    bad: list[str] = []
    max_id = await conn.fetchval(f"SELECT max(id) FROM {table}")
    for part in parts:
        if part[0] is None and cs.chunk_is_open(part, max_id):
            # P5.1 rule 1: nothing is deleted from an OPEN id chunk, so its file
            # can always be rebuilt in full from Postgres (corpus_store's note).
            print(f"   {str(part):<18}open chunk — never pruned while ids can still land in it")
            continue
        fname = f"{cs.partition_name(table, part)}.parquet"
        path = os.path.join(root, table, fname)
        v = await verify_partition_live(conn, table, part, path,
                                        backend=backend, filename=fname)
        if v["live_rows"] == 0 and v["file_rows"] == 0:
            continue          # an empty id-chunk or an off-season year
        if v["live_rows"] == 0 and v["file_rows"] == 0:
            continue
        status = "OK" if v["ok"] else "CORRUPT"
        lag = f"  +{v['live_only']:,} not yet exported" if v.get("live_only") else ""
        print(f"   {str(part):<18}live {v['live_rows']:>9,}  file {v['file_rows']:>9,}  "
              f"deletable {v['deletable']:>9,}  {status}{lag}")
        if not v["ok"]:
            bad.append(f"{part}: {v.get('reason') or 'digest/ids differ'}")
            continue
        # The margin is applied AFTER verification, never before: a row is
        # still proven to be in the corpus, it is simply not deleted yet.
        ids = [i for i in v["ids"] if i not in keep_ids] if keep_ids else v["ids"]
        if keep_ids and len(ids) != len(v["ids"]):
            print(f"   {'':<18}held back {len(v['ids']) - len(ids):,} "
                  f"within the {keep_days}-day margin")
        total_ids += len(ids)
        if apply and ids:
            for i in range(0, len(ids), DELETE_BATCH):
                batch = ids[i:i + DELETE_BATCH]
                # BY ID, never by predicate — see rule 2.
                res = await conn.execute(
                    f"DELETE FROM {table} WHERE id = ANY($1::bigint[])", batch)
                deleted += int(res.split()[-1]) if res.split()[-1].isdigit() else 0

    cols = await cs.column_names(conn, table)
    time_col = "observed_at" if "observed_at" in cols else "captured_at" if "captured_at" in cols else None
    if keep_days and apply and time_col:
        # PUBLISH THE FLOOR. A window that has been pruned and a series that
        # genuinely has no ticks look identical to every reader, and the reader
        # is the one that has to tell a user which it is looking at.
        #
        # Only for a table read by recency. `mlb_pitch_events` keeps a margin
        # (R5-F2) but has neither column and no recency reader; before this
        # check it crashed here on `captured_at` (2026-09-15, after deleting
        # nothing: every partition's margin held its rows back).
        floor = await conn.fetchval(f"SELECT min(COALESCE({time_col}, now())) FROM {table}")
        await conn.execute(
            """INSERT INTO snapshot_cache (cache_key, payload, fetched_at)
               VALUES ($1, $2, now())
               ON CONFLICT (cache_key) DO UPDATE
                 SET payload = excluded.payload, fetched_at = excluded.fetched_at""",
            f"corpus:retained-floor:{table}",
            json.dumps({"table": table, "keep_days": keep_days,
                        "floor": floor.isoformat() if floor else None}))
        print(f"   retained floor published: {floor}")

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
