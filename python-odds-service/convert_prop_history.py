"""P5 amendment A1: convert `prop_odds_history` into the compact
`prop_price_history`, prove it row for row, then drop the old table.

    python convert_prop_history.py --status
    python convert_prop_history.py --copy          # dictionaries + every missing row; re-runnable
    python convert_prop_history.py --verify        # row-for-row proof, every chunk
    python convert_prop_history.py --drop          # only after --verify passes AND the legacy
                                                   # corpus proof is in odds_history_exports

EVERYTHING RUNS IN THE DATABASE. No row crosses the wire: the copy is
`INSERT ... SELECT` through the dictionaries, the proof is `EXCEPT` both ways
plus a count, per 200k-id chunk.

RE-RUNNABLE BY CONSTRUCTION. A row is copied only if its id is not already in
the compact table (an anti-join bounded to the partitions that chunk's rows can
live in, since `recorded_at = observed_at` for every converted row). So the same
command is the first copy and the catch-up after the writer moves: rows the old
worker wrote while the new one was deploying are simply the rows still missing.
It is also what makes commit order harmless — a writer transaction that took id
N and committed after id N+1 was copied is found on the next pass, and --verify
would name it if it were not.

THE ORDER (P5 A1; `docs/design/odds-build/P5-schema-and-writers.md`):
  1. --copy, --verify, and the read timings, while the old writer still runs;
  2. deploy the worker (it writes only prop_price_history), then --copy
     (catch-up) and --verify again;
  3. switch the TypeScript readers;
  4. --legacy-proof --apply: every old row proven in the corpus per id (rows
     no file holds go into one supplementary object per id chunk), recorded
     as the 'legacy' ledger row;
  5. --drop.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import corpus_store as cs                                     # noqa: E402
import db                                                     # noqa: E402
import price_history as ph                                    # noqa: E402

OLD = "prop_odds_history"
NEW = ph.PROP_TABLE
CHUNK = 200_000

# The 13 columns, old side. The new side is the shared decode, so the proof
# checks exactly what every reader will see.
OLD_COLS = ", ".join(c for c, _ in ph.PROP_CORPUS_COLUMNS)


async def _conn_exec(pool, sql: str, *args, timeout_s: int = 900, fetch: str = "execute"):
    async with pool.acquire(timeout=120.0) as conn:
        async with conn.transaction():
            await conn.execute(f"SET LOCAL statement_timeout = '{timeout_s}s'")
            # MEASURED 2026-09-25: a chunk writing into a day partition that
            # autovacuum had not yet analysed took 485 s against 3 s for the
            # chunk before it. The planner, believing the partition empty, ran
            # the anti-join as a nested loop re-scanning it per row. A hash join
            # is right for every statement here (whole chunks, whole days).
            await conn.execute("SET LOCAL enable_nestloop = off")
            return await getattr(conn, fetch)(sql, *args)


async def fill_dictionaries(pool) -> None:
    t0 = time.time()
    for table, col, src in (("odds_games", "game_id", "game_id"),
                            ("odds_subjects", "subject_id", "subject_id"),
                            ("odds_markets", "name", "market_key"),
                            ("odds_books", "name", "bookmaker"),
                            ("odds_sides", "name", "side")):
        await _conn_exec(pool, f"INSERT INTO {table} ({col}) SELECT DISTINCT {src} FROM {OLD} "
                               f"ON CONFLICT ({col}) DO NOTHING")
    await _conn_exec(pool, f"""INSERT INTO odds_sources (provider_id, is_delayed, delay_seconds)
                               SELECT DISTINCT provider_id, is_delayed, delay_seconds FROM {OLD}
                               ON CONFLICT ON CONSTRAINT odds_sources_key DO NOTHING""")
    print(f"dictionaries filled ({time.time() - t0:.0f}s)", flush=True)


async def chunks(pool) -> list[tuple[int, int]]:
    row = await _conn_exec(pool, f"SELECT min(id) a, max(id) b FROM {OLD}", fetch="fetchrow")
    if row["a"] is None:
        return []
    if row["b"] >= ph.LEGACY_ID_CEILING:
        raise SystemExit(f"{OLD} reached id {row['b']} >= {ph.LEGACY_ID_CEILING}: the new id space "
                         f"would collide. Raise LEGACY_ID_CEILING and the sequence before converting.")
    lo = (row["a"] // CHUNK) * CHUNK
    return [(a, a + CHUNK) for a in range(lo, row["b"] + 1, CHUNK)]


async def _bounds(pool, lo: int, hi: int):
    return await _conn_exec(pool, f"SELECT min(observed_at) a, max(observed_at) b, count(*) n "
                                  f"FROM {OLD} WHERE id >= $1 AND id < $2", lo, hi, fetch="fetchrow")


async def copy_chunk(pool, lo: int, hi: int) -> int:
    b = await _bounds(pool, lo, hi)
    if not b["n"]:
        return 0
    res = await _conn_exec(pool, f"""
        INSERT INTO {NEW} (id, observed_at, recorded_at, decimal_odds, game, subject, line, price,
                           market, book, source, side)
        SELECT o.id, o.observed_at, o.observed_at, o.decimal_odds, g.id, sj.id, o.line::real,
               o.american_odds, m.id, b.id, s.id, sd.id
          FROM {OLD} o
          JOIN odds_games g     ON g.game_id = o.game_id
          JOIN odds_subjects sj ON sj.subject_id = o.subject_id
          JOIN odds_markets m   ON m.name = o.market_key
          JOIN odds_books b     ON b.name = o.bookmaker
          JOIN odds_sides sd    ON sd.name = o.side
          JOIN odds_sources s   ON s.provider_id = o.provider_id AND s.is_delayed = o.is_delayed
                               AND s.delay_seconds IS NOT DISTINCT FROM o.delay_seconds
         WHERE o.id >= $1 AND o.id < $2
           AND NOT EXISTS (SELECT 1 FROM {NEW} n
                            WHERE n.id = o.id AND n.recorded_at >= $3 AND n.recorded_at <= $4)""",
        lo, hi, b["a"], b["b"])
    return int(res.split()[-1])


async def verify_chunk(pool, lo: int, hi: int) -> dict:
    """Old rows in [lo, hi) against the decoded compact rows in the same range."""
    b = await _bounds(pool, lo, hi)
    if not b["n"]:
        return {"lo": lo, "old": 0, "new": 0, "missing": 0, "extra": 0, "ok": True}
    where = f"h.id >= $1 AND h.id < $2 AND h.recorded_at >= $3 AND h.recorded_at <= $4"
    decoded = ph.decoded_select(NEW, where)
    old = f"SELECT {OLD_COLS} FROM {OLD} WHERE id >= $1 AND id < $2"
    r = await _conn_exec(pool, f"""
        WITH n AS ({decoded}), o AS ({old})
        SELECT (SELECT count(*) FROM o) AS old_n,
               (SELECT count(*) FROM n) AS new_n,
               (SELECT count(*) FROM (SELECT * FROM o EXCEPT ALL SELECT * FROM n) x) AS missing,
               (SELECT count(*) FROM (SELECT * FROM n EXCEPT ALL SELECT * FROM o) y) AS extra,
               (SELECT count(*) FROM {NEW} h WHERE {where}) AS raw_n""",
        lo, hi, b["a"], b["b"], fetch="fetchrow")
    out = {"lo": lo, "old": r["old_n"], "new": r["new_n"], "raw": r["raw_n"],
           "missing": r["missing"], "extra": r["extra"]}
    # raw == new: every stored row decodes (no orphan code); old == new with
    # nothing missing or extra: identical multisets of all 13 columns.
    out["ok"] = (r["missing"] == 0 and r["extra"] == 0 and r["old_n"] == r["new_n"] == r["raw_n"])
    return out


async def status(pool) -> None:
    old = await _conn_exec(pool, f"SELECT count(*) n, max(id) mx FROM {OLD}", fetch="fetchrow")
    new = await _conn_exec(pool, f"SELECT count(*) FILTER (WHERE id < {ph.LEGACY_ID_CEILING}) legacy, "
                                 f"count(*) FILTER (WHERE id >= {ph.LEGACY_ID_CEILING}) fresh FROM {NEW}",
                           fetch="fetchrow")
    size = await _conn_exec(pool, f"""SELECT pg_total_relation_size('{OLD}') o,
                                  (SELECT sum(pg_total_relation_size(i.inhrelid))::bigint FROM pg_inherits i
                                    WHERE i.inhparent = '{NEW}'::regclass) n""", fetch="fetchrow")
    print(f"{OLD}: {old['n']:,} rows (max id {old['mx']}), {size['o'] / 1e9:.2f} GB")
    print(f"{NEW}: {new['legacy']:,} converted + {new['fresh']:,} new rows, {(size['n'] or 0) / 1e9:.2f} GB")
    if new["legacy"]:
        print(f"bytes/row, old {size['o'] / max(old['n'], 1):.0f}  new "
              f"{(size['n'] or 0) / max(new['legacy'] + new['fresh'], 1):.0f}")


async def main(a) -> int:
    pool = await db.get_pool()
    rc = 0
    if a.status:
        await status(pool)
    if a.copy:
        await fill_dictionaries(pool)
        total = 0
        for lo, hi in await chunks(pool):
            t0 = time.time()
            n = await copy_chunk(pool, lo, hi)
            total += n
            print(f"  copy [{lo:>10,}, {hi:>10,})  +{n:>7,}  ({time.time() - t0:.1f}s)", flush=True)
        print(f"copied {total:,} rows")
    if a.verify:
        bad = []
        for lo, hi in await chunks(pool):
            t0 = time.time()
            v = await verify_chunk(pool, lo, hi)
            print(f"  verify [{lo:>10,})  old {v['old']:>7,}  new {v['new']:>7,}  "
                  f"missing {v['missing']}  extra {v['extra']}  {'OK' if v['ok'] else 'FAIL'}  "
                  f"({time.time() - t0:.1f}s)", flush=True)
            if not v["ok"]:
                bad.append(v)
        print("VERIFIED: every row identical in all 13 columns" if not bad
              else f"FAILED: {len(bad)} chunk(s) differ")
        rc = 1 if bad else 0
    if a.legacy_proof:
        rc = await legacy_proof(pool, a.apply)
    if a.drop:
        rc = await drop(pool)
    await pool.close()
    return rc


SUPPLEMENT = "final"


async def _file_fingerprints(backend, table: str, filename: str, cols: list[str]) -> dict[int, int] | None:
    """{id: fingerprint} for one corpus object, or None if it does not exist."""
    import pyarrow.parquet as pq

    try:
        src = await asyncio.to_thread(backend.open_object, table, filename)
    except Exception:                                          # noqa: BLE001
        return None
    pf = pq.ParquetFile(src)
    if list(pf.schema_arrow.names) != cols:
        raise RuntimeError(f"{filename}: schema {pf.schema_arrow.names} != {cols}")
    out: dict[int, int] = {}
    id_i = cols.index("id")
    for b in pf.iter_batches(batch_size=cs.CHUNK_ROWS):
        d = b.to_pydict()
        for row in zip(*(d[c] for c in cols)):
            out[int(row[id_i])] = _fp(row)
    return out


def _fp(row) -> int:
    # The same fingerprint prune_corpus.verify_partition_live authorises deletes with.
    import hashlib

    line = "".join(cs._canon(v) for v in row)
    return int(hashlib.sha256(line.encode()).hexdigest()[:16], 16)


async def legacy_proof(pool, apply: bool) -> int:
    """Prove every `prop_odds_history` row is in the corpus, per id, then record it.

    The id-chunk files are NEVER rewritten here: the oldest hold rows already
    pruned from Postgres, and a re-export would silently drop them. A row that
    no file holds — the newest rows, and any a chunk missed because it closed
    within the 2-hour freeze guard of its last export — goes into ONE
    supplementary object per chunk, `prop_odds_history_<lo>_final.parquet`
    (same directory and schema, disjoint ids, so the glob reads it with the
    rest). A content mismatch between a file and Postgres stops everything.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq
    from corpus_location import corpus_location

    table = OLD
    spec = cs.LEGACY_PROP_HISTORY
    backend = corpus_location()
    stable = await _conn_exec(pool, f"SELECT max(id) a, max(observed_at) b FROM {OLD}", fetch="fetchrow")
    await asyncio.sleep(60)
    again = await _conn_exec(pool, f"SELECT max(id) a FROM {OLD}", fetch="fetchrow")
    if again["a"] != stable["a"]:
        print(f"REFUSING: {OLD} is still being written (max id {stable['a']} -> {again['a']}). "
              f"Deploy the worker that writes {NEW} first.")
        return 2
    total = await _conn_exec(pool, f"SELECT count(*) FROM {OLD}", fetch="fetchval")
    async with pool.acquire(timeout=600.0) as conn:
        await conn.execute(f"SET statement_timeout = '{cs.EXPORT_STATEMENT_TIMEOUT}'")
        cols = await cs.column_names(conn, table)
        schema = await cs.arrow_schema(conn, table)
        parts = await cs.partitions_for(conn, table, spec)
    proven, missing_total, problems = 0, 0, []
    for part in parts:
        name = cs.partition_name(table, part)
        main_fp = await _file_fingerprints(backend, table, f"{name}.parquet", cols) or {}
        sup_name = f"{name}_{SUPPLEMENT}.parquet"
        sup_fp = await _file_fingerprints(backend, table, sup_name, cols) or {}
        fp = {**main_fp, **sup_fp}
        live, ok_n, corrupt, missing = 0, 0, 0, []
        sql, prefix = cs._partition_query(table, cols, part, cs.CHUNK_ROWS, spec)
        last = -1
        async with pool.acquire(timeout=600.0) as conn:
            await conn.execute(f"SET statement_timeout = '{cs.EXPORT_STATEMENT_TIMEOUT}'")
            while True:
                raw = await conn.fetch(sql, *prefix, last)
                if not raw:
                    break
                for r in raw:
                    live += 1
                    row = tuple(cs._cell(r[c]) for c in cols)
                    want = fp.get(int(r["id"]))
                    if want is None:
                        missing.append(row)
                    elif want == _fp(row):
                        ok_n += 1
                    else:
                        corrupt += 1
                last = raw[-1]["id"]
        if not live:
            continue
        print(f"  {name}: live {live:>8,}  in corpus {ok_n:>8,}  missing {len(missing):>7,}  "
              f"corrupt {corrupt}  (files: main {len(main_fp):,}, supplement {len(sup_fp):,})", flush=True)
        if corrupt:
            problems.append(f"{name}: {corrupt} row(s) differ from the corpus")
            continue
        if missing and apply:
            rows = [*missing]
            # The supplement holds every live row the MAIN file lacks, so it is
            # safe to rewrite: none of its rows has been pruned (the old table is
            # no longer pruned) and each is re-verified below.
            if sup_fp:
                async with pool.acquire(timeout=600.0) as conn:
                    await conn.execute(f"SET statement_timeout = '{cs.EXPORT_STATEMENT_TIMEOUT}'")
                    have = await conn.fetch(f"SELECT {', '.join(cols)} FROM {OLD} WHERE id = ANY($1::bigint[])",
                                            [i for i in sup_fp if i not in main_fp])
                rows += [tuple(cs._cell(r[c]) for c in cols) for r in have]
            local = os.path.join(HERE, "corpus", "_legacy_supplements", sup_name)
            os.makedirs(os.path.dirname(local), exist_ok=True)
            pq.write_table(pa.table({c: [r[i] for r in rows] for i, c in enumerate(cols)}, schema=schema),
                           local, compression="zstd")
            await asyncio.to_thread(backend.put, local, table, sup_name)
            back = await _file_fingerprints(backend, table, sup_name, cols) or {}
            still = [r for r in missing if back.get(int(r[0])) != _fp(r)]
            print(f"    wrote {sup_name}: {len(rows):,} rows; {len(still)} still unproven", flush=True)
            if still:
                problems.append(f"{name}: {len(still)} row(s) not proven after the supplement")
            else:
                ok_n += len(missing)
                missing = []
        missing_total += len(missing)
        proven += ok_n
    print(f"\n{OLD}: {total:,} rows; proven in the corpus {proven:,}; missing {missing_total:,}")
    if problems or proven != total or missing_total:
        for p in problems:
            print(f"  PROBLEM {p}")
        print("NOT PROVEN." + ("" if apply else " (dry run: pass --apply to write supplements)"))
        return 1
    if apply:
        await _conn_exec(pool, """INSERT INTO odds_history_exports (table_name, part, rows, digest, object_key, verified_at)
                                  VALUES ($1, 'legacy', $2, 'per-id: prune_corpus fingerprint', $3, now())
                                  ON CONFLICT (table_name, part) DO UPDATE SET rows = excluded.rows,
                                    digest = excluded.digest, object_key = excluded.object_key,
                                    verified_at = excluded.verified_at""",
                         NEW, total, f"{table}/ id < {ph.LEGACY_ID_CEILING}")
        print(f"PROVEN: all {total:,} rows are in the corpus; 'legacy' ledger row written.")
    return 0


async def drop(pool) -> int:
    """Refuses unless every chunk verifies NOW and the legacy corpus proof exists."""
    legacy = await _conn_exec(pool, "SELECT rows, verified_at FROM odds_history_exports "
                                    "WHERE table_name = $1 AND part = 'legacy'", NEW, fetch="fetchrow")
    if not legacy or legacy["verified_at"] is None:
        print("REFUSING: no verified 'legacy' row in odds_history_exports — the old rows are not "
              "proven to be in the corpus.")
        return 2
    for lo, hi in await chunks(pool):
        v = await verify_chunk(pool, lo, hi)
        if not v["ok"]:
            print(f"REFUSING: chunk {lo} does not verify: {v}")
            return 2
    n_old = await _conn_exec(pool, f"SELECT count(*) FROM {OLD}", fetch="fetchval")
    if n_old != legacy["rows"]:
        print(f"REFUSING: {OLD} holds {n_old:,} rows but the corpus proof covers {legacy['rows']:,}.")
        return 2
    # The price chart's floor moves to the new key: the converted rows reach
    # exactly as far back as the old table did.
    await _conn_exec(pool, """INSERT INTO snapshot_cache (cache_key, payload, fetched_at)
                              SELECT 'corpus:retained-floor:prop_price_history', payload, now() FROM snapshot_cache
                               WHERE cache_key = 'corpus:retained-floor:prop_odds_history'
                              ON CONFLICT (cache_key) DO NOTHING""")
    await _conn_exec(pool, f"DROP TABLE {OLD}")
    print(f"DROPPED {OLD} ({n_old:,} rows, all verified in {NEW} and in the corpus).")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--copy", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--legacy-proof", action="store_true",
                    help="prove every old row is in the corpus (per id); --apply writes supplements + the ledger row")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--drop", action="store_true")
    args = ap.parse_args()
    if not (args.status or args.copy or args.verify or args.drop or args.legacy_proof):
        args.status = True
    raise SystemExit(asyncio.run(main(args)))
