"""Phase 5.2a — Parquet must reproduce the corpus EXACTLY, or nothing moves.

Runs against the real database. This is the gate that has to hold before any
row is ever dropped from Postgres, because the tables it covers cannot be
rebuilt:

    odds_archive         27.3 years, back to 1999-09-12
    game_result          27.0 years
    player_game_history  16.1 years
    prop_odds_archive     1.5 years, and lib/db/client.ts records that NO
                          BACKFILL EXISTS ANYWHERE for it
    mlb_pitch_events      2.5 years

WHAT IS ACTUALLY AT RISK, measured rather than assumed. There are no `numeric`
columns in any corpus table, so the classic decimal-to-float trap does not
apply. The real hazards are:

  * `jsonb` (`player_game_history.stats`, `odds_archive.raw_json`) — Postgres
    hands these back as parsed dicts, and a careless round-trip re-serialises
    them with different key order. Comparing PARSED json would pass while the
    stored text silently changed for every row in the corpus, so the digest
    compares the canonical TEXT form.
  * `real`/float4 in `mlb_pitch_events` — six columns, which must not be
    widened to float64 and back with drift.
  * NULLs, which must survive as NULL and never become an empty string.

The verification re-reads the file FROM DISK rather than comparing against the
in-memory table that was just written — otherwise it only proves pyarrow agrees
with itself.
"""
import asyncio
import os
import sys
import tempfile

sys.path.insert(0, "src")
import corpus_store as cs
import db as _db

SAMPLE = 4000
_tmp = tempfile.mkdtemp(prefix="corpus_roundtrip_")


def check(name, got, want):
    assert got == want, f"FAIL {name}: got {got!r}, want {want!r}"
    print(f"PASS  {name}")


async def roundtrip(conn, table: str) -> dict:
    cols, rows = await cs.fetch_frozen(conn, table, limit=SAMPLE)
    path = os.path.join(_tmp, f"{table}.parquet")
    cs.write_parquet(cols, rows, path)
    return cs.verify_export(cols, rows, path), cols, rows


async def test_every_corpus_column_type_is_mapped(conn):
    """Every Postgres type in every corpus table must have an Arrow mapping.

    THE OBVIOUS CHECK IS THE WRONG ONE. Iterating `_PG_TO_ARROW` and asserting
    each value names a real pyarrow type passes trivially -- it only validates
    the entries that are present, and says nothing about the ones that are
    missing. That check passed while `double precision` and `real` had been
    silently deleted from the map by an inline comment swallowing the rest of
    its line, and the export died on the first `odds_archive` partition.

    This asks the opposite question, which is the one that matters: does the
    map cover what the DATA actually contains?
    """
    unmapped = []
    for table in sorted(cs.CORPUS):
        for r in await conn.fetch(
                """SELECT column_name, data_type FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=$1""", table):
            dt = r["data_type"]
            if dt.startswith("timestamp"):
                continue
            if dt not in cs._PG_TO_ARROW:
                unmapped.append(f"{table}.{r['column_name']} :: {dt}")
    check(f"every corpus column type is mapped ({len(cs._PG_TO_ARROW)} entries)",
          unmapped, [])
    # And the mappings that exist must name real pyarrow constructors.
    import pyarrow as pa
    for pg, name in cs._PG_TO_ARROW.items():
        assert hasattr(pa, name), f"{pg} -> pa.{name} does not exist"
        getattr(pa, name)()
    print("PASS  every mapping resolves to a real pyarrow type")


async def main():
    pool = await _db.get_pool()
    async with pool.acquire(timeout=900.0) as conn:
        await test_every_corpus_column_type_is_mapped(conn)
        for table in sorted(cs.CORPUS):
            verdict, cols, rows = await roundtrip(conn, table)
            n = verdict["pg_rows"]
            if n == 0:
                print(f"SKIP  {table}: no frozen rows to test")
                continue
            check(f"{table}: columns preserved", verdict["columns_match"], True)
            check(f"{table}: row count preserved", verdict["row_count_match"], True)
            check(f"{table}: content digest matches", verdict["digest_match"], True)

            # NULLs must stay NULL. An empty string is a different value and
            # would change what every downstream `IS NULL` test does.
            _fc, file_rows = cs.read_parquet(verdict["path"])
            pg_nulls = sum(1 for r in rows for v in r if v is None)
            file_nulls = sum(1 for r in file_rows for v in r if v is None)
            check(f"{table}: NULLs survive as NULL ({pg_nulls:,})",
                  file_nulls, pg_nulls)

            # jsonb is the real hazard — compare the canonical TEXT, not the
            # parsed object, so key reordering cannot pass.
            #
            # AND REFUSE TO CLAIM A VACUOUS PASS. The first version of this
            # printed PASS for `odds_archive.raw_json` while comparing two empty
            # lists: that column is NULL in all 1,980,544 rows of the table, so
            # there was nothing to round-trip. A test that passes without
            # testing anything is worse than no test, because it is counted.
            for jcol in cs.CORPUS[table].json_columns:
                i = cols.index(jcol)
                pg_vals = [r[i] for r in rows if r[i] is not None]
                file_vals = [r[i] for r in file_rows if r[i] is not None]
                if not pg_vals:
                    print(f"SKIP  {table}.{jcol}: column is NULL in every sampled "
                          f"row — round-trip UNPROVEN for populated values")
                    continue
                check(f"{table}.{jcol}: jsonb text identical "
                      f"({len(pg_vals):,} populated, avg "
                      f"{sum(len(v) for v in pg_vals) // len(pg_vals)} chars)",
                      sorted(file_vals), sorted(pg_vals))

            ratio = verdict["bytes"] / max(n, 1)
            print(f"      {n:,} rows -> {verdict['bytes'] / 1e6:.2f} MB "
                  f"({ratio:.0f} B/row on disk)")

        # A failed verification must REFUSE to authorise a delete, not warn.
        bad = {"ok": False, "path": "/nowhere.parquet", "pg_rows": 10,
               "file_rows": 9, "digest_match": False}
        try:
            cs.deletion_manifest("odds_archive", bad)
            raise AssertionError("FAIL: a failed verification authorised a delete")
        except cs.ExportNotVerified as e:
            assert "NOTHING WILL BE DELETED" in str(e)
            print("PASS  a failed verification refuses to authorise any delete")

    print("\nall corpus round-trip checks passed")


if __name__ == "__main__":
    asyncio.run(main())
