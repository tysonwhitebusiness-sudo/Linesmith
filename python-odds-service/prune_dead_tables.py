"""Phase 5.S.2 — back up the dead tables, then remove them.

    python prune_dead_tables.py                  # verify only; changes nothing
    python prune_dead_tables.py --apply          # export, verify, THEN remove
    python prune_dead_tables.py --table X        # one table
    python prune_dead_tables.py --out DIR        # where the Parquet backup goes

324 MB of the database is tables no model reads: one drained import-staging
table and six `CREATE TABLE AS` backups taken by migrations on 2026-08-29 and
2026-09-01. This exports each one to Parquet, VERIFIES the copy by re-reading
it from disk and comparing digests, and only then removes it.

THE GATE IS `corpus_store.deletion_manifest`, the same one the corpus prune
uses, and it raises rather than warning. Nothing here is deleted on a copy
nobody read back.

----------------------------------------------------------------------------
TWO THINGS §5.S.2 GOT WRONG, both found by measuring instead of inheriting
----------------------------------------------------------------------------

1. **`odds_import_staging` IS NOT "a staging table that never drained".** It
   drained completely. All 1,138,756 resolved rows are present in
   `odds_archive` — checked by an anti-join on the full promotion key
   (sport, game_date, market, side, source, bookmaker, event_ref, team ids),
   which returns ZERO. What is left is post-promotion residue, not a backlog.
   That is the fact that makes removing the rows safe, and it is the opposite
   of the reason the plan gave.

2. **`odds_import_staging` MUST NOT BE DROPPED.** The plan says "drop the dead
   tables", but this table is live infrastructure with five writers
   (`import_odds_staging.py`, `import_cfbd.py`, `import_nflverse.py`,
   `import_footballdata.py`, `import_mlb_sbr.py`), a drainer
   (`scripts/gate/promote_odds.mjs`) and three readers (`scripts/gate/gate4_staging.mjs`,
   `gate5_archive.mjs`, `audit_nhl_duplicates.py`). Dropping it breaks the
   whole historical-odds import path. Its ROWS are dead; its SCHEMA is not.

   So this tool has two dispositions, and the difference is not cosmetic:

     drop    the table itself goes           (the six migration backups)
     delete  the rows go, the table stays    (`odds_import_staging`)

   THE 2,876 UNRESOLVED ROWS ARE KEPT. They are the import pipeline's record of
   what it could not resolve, they were never promoted anywhere, and
   `gate4_staging.mjs` reads exactly them. They cost 0.7 MB. Deleting them
   would save nothing measurable and would throw away the only copy.

WHY DROPPING THE MIGRATION BACKUPS IS SAFE, stated per table rather than as a
blanket claim: each was created by a migration that has already been applied,
with `CREATE TABLE IF NOT EXISTS x AS SELECT ...`, and nothing in either tree
SELECTs from them outside the migration that made them. On a fresh database
those migrations recreate their own backups from the same source data, so
dropping these does not make the migration history unreplayable.

`20260829110000_canonical_bookmaker_residue.sql` MENTIONS two of them in a
comment ("the original backups still hold the pre-change state") but does not
read them; its own UPDATE is idempotent and source-free. That comment is the
closest thing to a reader any of these has, and a comment is not a reader.

KEEP `--out` SHALLOW ON WINDOWS. These table names are 45 characters and the
exporter writes `<out>/<table>/<table>_<id>.parquet.manifest.json`, so the name
appears twice plus a 22-character suffix. Pointed at a deep scratchpad
directory this run produced a 265-character path and `write_manifest` failed
with FileNotFoundError — MAX_PATH is 260, and the error names neither the limit
nor the length. The parquet beside it (251 chars) had already been written, so
the failure looked like a bug in the manifest writer rather than in the path.
The default `--out` is inside `python-odds-service/`, which leaves ~65
characters of headroom.

SPACE IS NOT RETURNED BY THIS TOOL. `DROP TABLE` does return the file, but the
`DELETE` on `odds_import_staging` only marks rows dead — that 266 MB comes back
at `VACUUM FULL`, which is §5.S.4. Expect the database size to fall by roughly
40 MB here and the rest three steps later. Saying otherwise would be the same
mistake the phase keeps catching.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import corpus_store as cs                                   # noqa: E402
from corpus_store import CorpusTable                        # noqa: E402
import db                                                   # noqa: E402

DEFAULT_OUT = os.path.join(HERE, "dead_tables_backup")


class DeadTable:
    """One table 5.S.2 removes, and exactly how.

    `spec` is a `CorpusTable` only because that is the shape `corpus_store`'s
    streaming export takes — declared Arrow schema, keyset chunking, digest
    accumulated as rows go past and re-checked against the file re-read from
    disk. These tables are NOT corpus members and are deliberately kept out of
    `corpus_store.CORPUS`, which is documented as data that may never be
    deleted. See `corpus_store.spec_for`.
    """

    def __init__(self, name: str, disposition: str, reason: str,
                 predicate: str = "TRUE", json_columns: tuple[str, ...] = (),
                 keep: str | None = None):
        assert disposition in ("drop", "delete")
        self.name = name
        self.disposition = disposition
        self.reason = reason
        self.predicate = predicate
        self.keep = keep
        # Every one of these tables has an `id`, and NONE of the six backups has
        # any index at all (`CREATE TABLE AS` makes none), so keyset chunking on
        # the primary key is the only partitioning that is honest about what the
        # database can actually do. They are small enough that the sequential
        # scan per chunk costs less than the index would.
        self.spec = CorpusTable(name, "game_date", predicate,
                                json_columns=json_columns,
                                partition_by="id_chunk")


DEAD: list[DeadTable] = [
    DeadTable(
        "odds_import_staging", "delete",
        "Fully promoted into odds_archive (anti-join on the promotion key "
        "returns 0 unmatched). Table kept: 5 importers write it, "
        "promote_odds.mjs drains it, 3 gate scripts read it.",
        predicate="resolution_status = 'resolved'",
        json_columns=("raw_json",),
        keep="resolution_status IS DISTINCT FROM 'resolved'"),
    DeadTable(
        "prop_odds_dedup_backup_20260829", "drop",
        "Pre-dedup snapshot taken by 20260829060000_prop_odds_nulls_not_distinct.sql. "
        "Soak period long past; audit-remediation-plan §4087 flags it for drop."),
    DeadTable(
        "team_elo_history_int_backup_20260901", "drop",
        "Pre-migration snapshot from 20260901091000_elo_team_id_text.sql "
        "(integer team_id, before the text conversion)."),
    DeadTable(
        "game_odds_history_bookmaker_backup_20260829", "drop",
        "Pre-canonicalisation snapshot from "
        "20260829100000_game_odds_history_canonical_bookmaker.sql."),
    DeadTable(
        "game_odds_book_lines_bookmaker_backup_20260829", "drop",
        "Pre-canonicalisation snapshot from "
        "20260829080000_canonical_bookmaker_backfill.sql."),
    DeadTable(
        "pick_history_game_model_backup_20260829", "drop",
        "Pre-attribution snapshot from "
        "20260829150000_attribute_game_model_history.sql (Q25)."),
    DeadTable(
        "game_odds_book_lines_quarantine_20260829", "drop",
        "Rows quarantined by 20260829090000_check_constraints.sql (Q23). "
        "114 rows; kept as evidence, not as data."),
    DeadTable(
        "prop_import_staging", "drop",
        "Declared by 20260901090000_odds_archive.sql and never written: 0 rows. "
        "The prop import path writes prop_odds directly."),
]

BY_NAME = {d.name: d for d in DEAD}


async def _size_mb(conn, table: str) -> float:
    v = await conn.fetchval(
        "SELECT pg_total_relation_size(to_regclass($1))", table)
    return (v or 0) / 1e6


async def export_one(pool, dead: DeadTable, out_dir: str) -> dict:
    """Export every row this tool intends to remove, and verify the copy.

    Returns the export summary. `all_verified` False means nothing may be
    removed — the caller routes each partition through `deletion_manifest`
    rather than trusting this flag on its own.
    """
    def progress(part, v):
        tag = "resumed" if v.get("resumed") else ("empty" if v.get("skipped") else "")
        print(f"     {cs.partition_name(dead.name, part):<44}"
              f"{v['pg_rows']:>9,} rows  {v['bytes']/1e6:>7.1f} MB  "
              f"{'OK' if v['ok'] else 'FAIL':<5}{tag}", flush=True)

    return await cs.export_table_pooled(pool, dead.name, out_dir,
                                        progress=progress, spec=dead.spec)


async def remove_one(conn, dead: DeadTable) -> dict:
    """Perform the removal. ONLY ever called after every partition of this
    table has produced an authorised `deletion_manifest`."""
    if dead.disposition == "drop":
        await conn.execute(f"DROP TABLE IF EXISTS {dead.name}")
        return {"action": "DROP TABLE", "table": dead.name}
    # DELETE IN BOUNDED BATCHES, not one statement. 1.1M rows in a single
    # transaction holds one of fifteen pooler connections for its whole
    # duration and keeps every deleted row's old version pinned until it
    # commits, on a database that is 88.7% full. Batching bounds both.
    #
    # The batch is chosen by `id` in a CTE and then joined, rather than
    # `DELETE ... WHERE predicate LIMIT`, because Postgres has no LIMIT on
    # DELETE. `id` is the primary key in every table here.
    await conn.execute(f"SET statement_timeout = '{cs.EXPORT_STATEMENT_TIMEOUT}'")
    removed = 0
    while True:
        tag = await conn.execute(
            f"WITH doomed AS (SELECT id FROM {dead.name} "
            f"                 WHERE {dead.predicate} LIMIT 100000) "
            f"DELETE FROM {dead.name} t USING doomed d WHERE t.id = d.id")
        n = int(tag.split()[-1])
        removed += n
        print(f"     ... {removed:,} removed", flush=True)
        if n == 0:
            break
    kept = await conn.fetchval(f"SELECT count(*) FROM {dead.name}")
    return {"action": "DELETE", "table": dead.name,
            "removed": removed, "kept": kept}


async def main(tables: list[str], out_dir: str, apply: bool) -> int:
    pool = await db.get_pool()
    total_before = 0.0
    manifests: dict[str, list[dict]] = {}
    plans: list[DeadTable] = [BY_NAME[t] for t in tables]

    print(f"\n{'=' * 78}\n5.S.2  DEAD TABLES -> {out_dir}\n{'=' * 78}")
    async with pool.acquire() as conn:
        db_before = await conn.fetchval(
            "SELECT pg_database_size(current_database())") / 1e6
        for d in plans:
            mb = await _size_mb(conn, d.name)
            total_before += mb
            print(f"  {d.name:<48}{mb:>8.1f} MB   {d.disposition.upper()}")
    print(f"  {'TOTAL':<48}{total_before:>8.1f} MB")
    print(f"  database now {db_before:,.0f} MB\n")

    # ---- EXPORT AND VERIFY. Nothing is removed in this loop. ----
    for d in plans:
        print(f"\n-- {d.name}  ({d.reason})")
        r = await export_one(pool, d, out_dir)
        print(f"   {r['rows']:,} rows / {r['bytes']/1e6:.1f} MB across "
              f"{r['partitions']} partition(s); verified={r['all_verified']}")
        if r["stale_files"]:
            print(f"   NOTE stale files not written by this run: {r['stale_files']}")
        try:
            manifests[d.name] = [cs.deletion_manifest(d.name, v)
                                 for v in r["verdicts"] if not v.get("skipped")]
        except cs.ExportNotVerified as e:
            print(f"\n   REFUSED: {e}")
            await pool.close()
            return 1

    verified_rows = sum(m["rows"] for ms in manifests.values() for m in ms)
    print(f"\n{'=' * 78}\n  {verified_rows:,} rows verified in "
          f"{out_dir}\n{'=' * 78}")

    if not apply:
        print("\n  VERIFY ONLY. Nothing was removed. Re-run with --apply.\n")
        await pool.close()
        return 0

    # ---- REMOVE. Only reachable because every manifest above authorised it. ----
    print("\n  APPLYING:")
    async with pool.acquire(timeout=1800.0) as conn:
        for d in plans:
            if not manifests[d.name]:
                print(f"   {d.name}: nothing to remove (0 rows exported)")
                if d.disposition == "drop":
                    await conn.execute(f"DROP TABLE IF EXISTS {d.name}")
                    print(f"   {d.name}: DROPPED (was empty)")
                continue
            out = await remove_one(conn, d)
            print(f"   {out}")
        db_after = await conn.fetchval(
            "SELECT pg_database_size(current_database())") / 1e6

    print(f"\n  database {db_before:,.0f} MB -> {db_after:,.0f} MB "
          f"({db_before - db_after:+,.0f} MB)")
    print("  The DELETEd rows are still on disk until VACUUM FULL (5.S.4).\n")
    await pool.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", action="append", choices=list(BY_NAME),
                    help="one table (repeatable); default is all of them")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--apply", action="store_true",
                    help="actually remove, after every export verifies")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(
        main(a.table or list(BY_NAME), a.out, a.apply)))
