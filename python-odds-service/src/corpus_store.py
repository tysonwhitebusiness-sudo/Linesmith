"""Phase 5.2 — the corpus store: Parquet for data that is written once and read
in bulk.

NOTHING HERE DELETES ANYTHING. This module only EXPORTS. Dropping the exported
rows from Postgres is 5.2d and happens only after a fit has produced identical
output reading Parquet, because the tables involved are irreplaceable:

    odds_archive         27.3 years   1999-
    game_result          27.0 years
    player_game_history  16.1 years
    prop_odds_archive     1.5 years   and `client.ts` records that NO BACKFILL
                                      EXISTS ANYWHERE for it -- forward
                                      accumulation only

WHY PARQUET AND NOT MORE POSTGRES. These tables are 4.6 GB of an 8,192 MB
ceiling, they are never updated once a game is final, and the only thing that
reads them is a fitter doing a full scan. `odds_archive` carries 663 MB of index
on 539 MB of heap -- point-lookup machinery for something nobody point-looks up.
Columnar storage is what bulk-scanned immutable data is for, and object storage
has no 8 GB wall, so the corpus can grow for decades instead of counting down.

THE FREEZE BOUNDARY IS THE DATA'S OWN, NOT AN AGE WE PICKED. `archival_bridge`
already enforces it as a WHERE clause -- `ON CONFLICT ... DO UPDATE ... WHERE
odds_archive.event_start > now()` -- so a row is mutable until kickoff and
frozen forever after. `FROZEN_PREDICATE` reuses exactly that rule, which is why
no row can ever be exported while something is still writing to it.

ONE MEASURED CORRECTION TO THAT RULE. `event_start <= now()` alone captures only
20% of `odds_archive`: 80.2% of its rows have a NULL `event_start` because they
came from the historical backfill, the oldest dated 1999-09-12. A predicate
using `event_start` alone would have exported a fifth of the table and looked
like it worked. The NULL branch below is why coverage is 99.9% instead.

TYPES. There are NO `numeric` columns in any corpus table -- prices are
`double precision` -- so there is no decimal-to-float precision trap. The two
real risks are `jsonb` (`player_game_history.stats`, `odds_archive.raw_json`),
which are carried as their normalised text form and re-parsed on read, and
`real`/float4 in `mlb_pitch_events`, which Parquet holds natively.
"""
from __future__ import annotations

import json
import os
from datetime import date as _date
from dataclasses import dataclass

# A row is exported only once it can never change again. Both branches matter:
# the first is `archival_bridge`'s own freeze rule; the second covers rows whose
# `event_start` was never recorded, which is 80.2% of `odds_archive`. The extra
# day is a timezone buffer -- a UTC `game_date` of "yesterday" can still be in
# progress somewhere, and exporting a live row is the one mistake this whole
# module exists to make impossible.
FROZEN_PREDICATE = (
    "((event_start IS NOT NULL AND event_start <= now())"
    " OR (event_start IS NULL AND game_date < current_date - 1))"
)

# Tables with no `event_start` at all are frozen on their game date alone.
GAME_DATE_ONLY_PREDICATE = "game_date < current_date - 1"


@dataclass(frozen=True)
class CorpusTable:
    """One table in the corpus, and how to tell a frozen row from a live one.

    `partition_by` IS DICTATED BY THE INDEXES THAT EXIST, not by taste. Every
    date index on these tables is composite with `sport` leading --
    `btree (sport, game_date)` -- so a predicate on a bare `game_date` cannot use
    any of them and falls back to a sequential scan, which is how the first
    version of this export hit the 2-minute `statement_timeout` on its very
    first partition. Partitioning by (sport, year) makes every chunk query match
    the leading index column, and has the side benefit that a single-sport fit
    reads only that sport's files.

    `mlb_pitch_events` is the exception: it has no date index at all -- only
    (batter_id, season), (pitcher_id, season), (game_pk, ...) and (id) -- so it
    is chunked on its primary key instead and partitioned by nothing.
    """

    name: str
    partition_col: str          # what the Parquet layout is keyed on
    frozen_predicate: str
    json_columns: tuple[str, ...] = ()
    partition_by: str = "sport_year"    # "sport_year" | "id_chunk"

    def frozen_where(self) -> str:
        return self.frozen_predicate


CORPUS: dict[str, CorpusTable] = {
    "odds_archive": CorpusTable(
        "odds_archive", "game_date", FROZEN_PREDICATE, json_columns=("raw_json",)),
    "prop_odds_archive": CorpusTable(
        "prop_odds_archive", "game_date", FROZEN_PREDICATE),
    # No `event_start` column at all: these record what HAPPENED, so a row for a
    # past game date is finished by definition.
    "player_game_history": CorpusTable(
        "player_game_history", "game_date", GAME_DATE_ONLY_PREDICATE,
        json_columns=("stats",)),
    "game_result": CorpusTable(
        "game_result", "game_date", GAME_DATE_ONLY_PREDICATE),
    # No sport/game_date index exists here, so it is keyset-chunked on its
    # primary key rather than partitioned by date. It is MLB-only by
    # definition, so nothing is lost by not partitioning on sport.
    "mlb_pitch_events": CorpusTable(
        "mlb_pitch_events", "game_date", GAME_DATE_ONLY_PREDICATE,
        partition_by="id_chunk"),
}


async def column_names(conn, table: str) -> list[str]:
    rows = await conn.fetch(
        """SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position""", table)
    return [r["column_name"] for r in rows]


def _cell(value):
    """Postgres value -> something Arrow can hold without inventing a type.

    asyncpg hands back `dict`/`list` for jsonb. Serialising with sorted keys and
    no incidental whitespace makes the text form CANONICAL, so a round-trip
    compares equal as text and not merely as parsed JSON — a weaker check would
    pass while silently reordering every document in the corpus.
    """
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    return value


async def fetch_frozen(conn, table: str, limit: int | None = None,
                       extra_where: str | None = None) -> tuple[list[str], list[tuple]]:
    """Every frozen row of one table, as (columns, rows). Read-only."""
    spec = CORPUS[table]
    cols = await column_names(conn, table)
    where = spec.frozen_where()
    if extra_where:
        where = f"({where}) AND ({extra_where})"
    sql = (f"SELECT {', '.join(cols)} FROM {table} WHERE {where} "
           f"ORDER BY {spec.partition_col}, id")
    if limit:
        sql += f" LIMIT {int(limit)}"
    raw = await conn.fetch(sql)
    return cols, [tuple(_cell(r[c]) for c in cols) for r in raw]


def write_parquet(cols: list[str], rows: list[tuple], path: str) -> str:
    """Write one Parquet file. Types are INFERRED FROM THE DATA rather than
    declared, so a column this module has never seen still round-trips."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    table = pa.table({c: [r[i] for r in rows] for i, c in enumerate(cols)})
    # zstd over snappy: this corpus is written once and read rarely, so the
    # trade is entirely in favour of size.
    pq.write_table(table, path, compression="zstd")
    return path


def read_parquet(path: str) -> tuple[list[str], list[tuple]]:
    import pyarrow.parquet as pq

    t = pq.read_table(path)
    cols = list(t.column_names)
    data = {c: t.column(c).to_pylist() for c in cols}
    n = t.num_rows
    return cols, [tuple(data[c][i] for c in cols) for i in range(n)]


# ---------------------------------------------------------------------------
# VERIFICATION. Nothing may be deleted from Postgres that has not been proven
# to exist, identically, in the corpus first.
# ---------------------------------------------------------------------------
#
# THIS IS A GATE, NOT A PROCEDURE. An export that "looked fine" is not a
# backup; a backup is a copy someone has actually read back and compared. These
# tables are irreplaceable -- `prop_odds_archive` has no backfill path anywhere
# in the system, so a bad export followed by a delete destroys 1.5 years of
# evidence that cannot be rebuilt from any source.
#
# `verify_export` re-reads the Parquet FROM DISK -- not the in-memory table
# that was just written, which would only prove pyarrow agrees with itself --
# and compares it to Postgres row for row, value for value. `deletion_manifest`
# turns that into the only thing that authorises a delete, and it raises rather
# than returning a warning, because a delete path that can proceed on a warning
# is a delete path that eventually does.


def _canon(v) -> str:
    """One value -> a canonical string that compares by VALUE, not by repr.

    THE FIRST VERSION OF THIS USED `repr()` AND WAS WRONG. It failed
    `game_result` on a difference that was purely representational: asyncpg
    returns `tzinfo=datetime.timezone.utc` and pyarrow returns
    `tzinfo=zoneinfo.ZoneInfo('UTC')`. Identical instants, `a == b` is True,
    and the digests differed — which would have refused to authorise a delete
    for a corpus copy that was in fact perfect, forever.

    Loose stringification would be the opposite mistake: `1` and `1.0` and
    `"1"` must stay distinguishable, because a column silently changing type is
    exactly the corruption this digest exists to catch. So every branch carries
    a type tag, and only the timezone IMPLEMENTATION is normalised away — a
    naive datetime becoming aware is still a real difference and still fails.
    """
    from datetime import date as _date, datetime as _dt

    if v is None:
        return "\x00"
    if isinstance(v, _dt):
        if v.tzinfo is None:
            return "dt_naive:" + v.isoformat()
        return "dt:" + v.astimezone(_tz_utc()).isoformat()
    if isinstance(v, _date):
        return "d:" + v.isoformat()
    # bool before int: bool IS an int in Python, and True must not digest as 1.
    if isinstance(v, bool):
        return "b:" + repr(v)
    if isinstance(v, int):
        return "i:" + repr(v)
    if isinstance(v, float):
        return "f:" + repr(v)          # repr round-trips a float exactly
    if isinstance(v, str):
        return "s:" + v
    if isinstance(v, (bytes, bytearray)):
        return "y:" + bytes(v).hex()
    return "r:" + repr(v)


def _tz_utc():
    from datetime import timezone

    return timezone.utc


class RowDigest:
    """Order-independent, STREAMING digest of a row set.

    Order-independent because Postgres does not promise row order and a re-read
    may legitimately differ; CONTENT must match, sequence need not.

    Streaming because the first version sorted every row in memory to get order
    independence, and `prop_odds_archive` has a single year of 1,008,830 rows —
    on a 512 MB worker, materialising that to verify it would reintroduce
    exactly the memory problem Phase 5 exists to remove. Summing per-row hashes
    is commutative, so it needs no sort and no accumulation: O(1) memory, and
    the row count travels with the digest so a subset can never collide with
    the whole.
    """

    _MOD = 1 << 256

    def __init__(self, cols: list[str]):
        import hashlib

        self.cols = list(cols)
        self._acc = 0
        self._n = 0
        self._header = hashlib.sha256(
            ("\x1f".join(self.cols)).encode()).hexdigest()

    def update(self, rows) -> "RowDigest":
        import hashlib

        for r in rows:
            line = "\x1f".join(_canon(v) for v in r)
            self._acc = (self._acc + int(hashlib.sha256(line.encode()).hexdigest(), 16)) % self._MOD
            self._n += 1
        return self

    @property
    def rows(self) -> int:
        return self._n

    def hexdigest(self) -> str:
        return f"{self._header[:16]}:{self._n}:{self._acc:064x}"


def rows_digest(cols: list[str], rows: list[tuple]) -> str:
    """Convenience wrapper for a row set that already fits in memory."""
    return RowDigest(cols).update(rows).hexdigest()


def verify_export(pg_cols: list[str], pg_rows: list[tuple], path: str) -> dict:
    """Re-read the Parquet from disk and compare it to what Postgres returned.

    `ok` is True only if the corpus copy is a faithful reproduction. Any caller
    that deletes MUST route through `deletion_manifest`, which checks it.
    """
    file_cols, file_rows = read_parquet(path)
    verdict = {
        "path": path,
        "pg_rows": len(pg_rows),
        "file_rows": len(file_rows),
        "columns_match": file_cols == pg_cols,
        "row_count_match": len(file_rows) == len(pg_rows),
        "pg_digest": rows_digest(pg_cols, pg_rows),
        "file_digest": rows_digest(file_cols, file_rows) if file_cols == pg_cols else None,
        "bytes": os.path.getsize(path) if os.path.exists(path) else 0,
    }
    verdict["digest_match"] = (
        verdict["file_digest"] is not None
        and verdict["file_digest"] == verdict["pg_digest"])
    verdict["ok"] = bool(verdict["columns_match"] and verdict["row_count_match"]
                         and verdict["digest_match"])
    if not verdict["ok"]:
        # Name the first disagreeing rows, so a failure is diagnosable rather
        # than merely alarming.
        # Same canonicaliser as the digest, or the diagnostic would report
        # "differences" the digest does not care about — which is how the first
        # version of this module accused a perfect export of corruption.
        pg_set = {tuple(_canon(v) for v in r) for r in pg_rows}
        file_set = {tuple(_canon(v) for v in r) for r in file_rows}
        verdict["missing_from_file_sample"] = list(pg_set - file_set)[:3]
        verdict["extra_in_file"] = len(file_set - pg_set)
    return verdict


class ExportNotVerified(RuntimeError):
    """Raised INSTEAD of deleting anything when the corpus copy is not proven."""


def deletion_manifest(table: str, verdict: dict) -> dict:
    """The only thing that authorises a delete. Refuses on any doubt."""
    if not verdict.get("ok"):
        raise ExportNotVerified(
            f"{table}: corpus copy at {verdict.get('path')} does NOT match Postgres "
            f"(pg={verdict.get('pg_rows')} file={verdict.get('file_rows')} "
            f"digest_match={verdict.get('digest_match')}). NOTHING WILL BE DELETED. "
            f"These tables have no backfill path; re-export and re-verify first.")
    return {"table": table, "path": verdict["path"], "rows": verdict["pg_rows"],
            "digest": verdict["pg_digest"], "bytes": verdict["bytes"],
            "authorised": True}


# ---------------------------------------------------------------------------
# STREAMING PARTITIONED EXPORT
# ---------------------------------------------------------------------------
#
# TWO REAL CONSTRAINTS SHAPE THIS, both measured rather than anticipated.
#
# 1. `statement_timeout` IS 2 MINUTES. Selecting all 2,807,445 frozen rows of
#    `player_game_history` in one query is cancelled by Postgres, so the export
#    reads in keyset-paginated chunks. Keyset (`id > last`) rather than OFFSET
#    because OFFSET re-scans everything it skips, getting slower every chunk on
#    exactly the tables that are largest.
#
# 2. A PARTITION DOES NOT FIT IN MEMORY. `prop_odds_archive` has a single year
#    of 1,008,830 rows, and the worker has 512 MB. Chunks are written straight
#    into an open ParquetWriter and dropped, so peak memory is one chunk rather
#    than one partition — otherwise this step would reintroduce the OOM that
#    5.1 just removed.
#
# Partitioning is by YEAR of the partition column. That is what makes a later
# incremental export cheap (only the current year is rewritten) and what lets
# DuckDB prune whole files for a date-bounded fit.

CHUNK_ROWS = 100_000
# id-keyset span per file for tables with no date index (mlb_pitch_events).
ID_CHUNK_SPAN = 500_000


def partition_path(out_dir: str, table: str, part: int | str) -> str:
    return os.path.join(out_dir, table, f"{table}_{part}.parquet")


async def partitions_for(conn, table: str) -> list[tuple]:
    """The partitions to export, as (sport, year) or (None, id_lo) tuples.

    Sports come from `DISTINCT sport`, which is an index-prefix scan rather than
    a table scan. Years come from min/max WITHIN a sport, so the composite
    (sport, game_date) index answers it directly -- an unqualified min/max on
    `game_date` cannot use that index and times out.
    """
    spec = CORPUS[table]
    if spec.partition_by == "id_chunk":
        row = await conn.fetchrow(f"SELECT min(id) a, max(id) b FROM {table}")
        if not row or row["a"] is None:
            return []
        return [(None, y) for y in range(row["a"], row["b"] + 1, ID_CHUNK_SPAN)]

    sports = [r["sport"] for r in
              await conn.fetch(f"SELECT DISTINCT sport FROM {table} ORDER BY sport")]
    out: list[tuple] = []
    for sport in sports:
        row = await conn.fetchrow(
            f"SELECT min({spec.partition_col}) a, max({spec.partition_col}) b "
            f"FROM {table} WHERE sport = $1", sport)
        if not row or row["a"] is None:
            continue
        out.extend((sport, y) for y in range(row["a"].year, row["b"].year + 1))
    return out


def _partition_query(table: str, cols: list[str], part: tuple, chunk_rows: int):
    """(sql, args-prefix) for one partition, shaped to the indexes that exist."""
    spec = CORPUS[table]
    sport, key = part
    if spec.partition_by == "id_chunk":
        where = (f"{spec.frozen_where()} AND id >= ${{n}} AND id < ${{m}} "
                 f"AND id > ${{k}}")
        sql = (f"SELECT {', '.join(cols)} FROM {table} "
               f" WHERE {spec.frozen_where()} AND id >= $1 AND id < $2 AND id > $3 "
               f" ORDER BY id LIMIT {int(chunk_rows)}")
        return sql, [key, key + ID_CHUNK_SPAN]
    # sport LEADS, matching btree (sport, game_date) — see CorpusTable.
    sql = (f"SELECT {', '.join(cols)} FROM {table} "
           f" WHERE sport = $1 AND {spec.partition_col} >= $2 "
           f"   AND {spec.partition_col} < $3 AND {spec.frozen_where()} "
           f"   AND id > $4 "
           f" ORDER BY id LIMIT {int(chunk_rows)}")
    return sql, [sport, _date(key, 1, 1), _date(key + 1, 1, 1)]


def partition_name(table: str, part: tuple) -> str:
    sport, key = part
    return f"{table}_{sport}_{key}" if sport else f"{table}_{key:012d}"


async def export_partition(conn, table: str, part: tuple, out_dir: str,
                           chunk_rows: int = CHUNK_ROWS) -> dict:
    """Stream one partition to one Parquet file. Returns a verification verdict.

    The digest is accumulated AS THE ROWS GO PAST, then recomputed by re-reading
    the finished file from disk, so the comparison is between what Postgres sent
    and what actually landed -- not between two views of one in-memory list.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    cols = await column_names(conn, table)
    # Declared, never inferred -- see `arrow_schema`. A chunk of all-NULLs types
    # a column as `null` and poisons the writer for every chunk after it.
    schema = await arrow_schema(conn, table)
    path = os.path.join(out_dir, table, f"{partition_name(table, part)}.parquet")
    os.makedirs(os.path.dirname(path), exist_ok=True)

    sent = RowDigest(cols)
    writer = None
    last_id = -1
    sql, prefix = _partition_query(table, cols, part, chunk_rows)
    try:
        while True:
            raw = await conn.fetch(sql, *prefix, last_id)
            if not raw:
                break
            chunk = [tuple(_cell(r[c]) for c in cols) for r in raw]
            sent.update(chunk)
            batch = pa.table({c: [r[i] for r in chunk] for i, c in enumerate(cols)},
                             schema=schema)
            if writer is None:
                writer = pq.ParquetWriter(path, schema, compression="zstd")
            writer.write_table(batch)
            last_id = raw[-1]["id"]
            del raw, chunk, batch
    finally:
        if writer is not None:
            writer.close()

    if writer is None:
        return {"path": path, "pg_rows": 0, "file_rows": 0, "ok": True,
                "bytes": 0, "skipped": True}

    landed = RowDigest(cols)
    pf = pq.ParquetFile(path)
    for batch in pf.iter_batches(batch_size=chunk_rows):
        d = batch.to_pydict()
        landed.update(zip(*(d[c] for c in cols)))

    verdict = {
        "path": path, "partition": part, "table": table,
        "pg_rows": sent.rows, "file_rows": landed.rows,
        "pg_digest": sent.hexdigest(), "file_digest": landed.hexdigest(),
        "bytes": os.path.getsize(path),
    }
    verdict["row_count_match"] = sent.rows == landed.rows
    verdict["digest_match"] = sent.hexdigest() == landed.hexdigest()
    verdict["columns_match"] = list(pf.schema_arrow.names) == cols
    verdict["ok"] = bool(verdict["row_count_match"] and verdict["digest_match"]
                         and verdict["columns_match"])
    return verdict


# The database's `statement_timeout` is 2 minutes, which is the right guard for
# a query serving a page and the wrong one for a maintenance scan. Discovering
# partitions alone exceeded it: `SELECT DISTINCT sport` cannot skip-scan a
# leading index column in Postgres, so it reads all 2,807,445 rows of
# player_game_history, and it does so while the worker is competing for the same
# 15-connection pooler.
#
# Raised for the EXPORT SESSION ONLY, and set explicitly rather than left to
# whatever the caller inherited, so the value is visible here rather than being
# a property of whoever happened to open the connection.
EXPORT_STATEMENT_TIMEOUT = "30min"

# WHERE THIS RUNS: THE OPERATOR'S MACHINE, NOT THE RENDER WORKER.
#
# An earlier note in this phase argued the opposite, on the grounds that pyarrow
# costs only +14.2 MB to import and 5.1 had left the projection job at 143 MB of
# the 512 MB plan. THAT REASONING WAS WRONG because it costed the IMPORT and not
# the WORK. Measured on a real 71,590-row partition:
#
#     baseline (asyncpg + pyarrow + pool)        62.9 MB
#     one 25,000-row fetch                       86.0 MB
#     after `del` of that fetch                  86.0 MB   <- not returned to OS
#     peak across a full partition export       ~280   MB
#
# The peak is a high-water mark, not concurrent use: each chunk allocates raw
# asyncpg records, a tuple list and an Arrow table, and CPython does not hand
# freed arenas back. It barely moves with chunk size -- 270 MB at 100k rows and
# 260 MB at 10k -- so there is no chunk setting that makes this small.
#
# 280 MB is already past the 60% danger band in `measure_projection_memory.py`,
# on a plan shared with 37 other jobs, which is exactly the arithmetic that
# OOM-killed mlbProjectionsJob for thirteen hours. So this is a maintenance
# operation run deliberately, not a JOB_REGISTRY entry.


async def export_table(conn, table: str, out_dir: str,
                       chunk_rows: int = CHUNK_ROWS,
                       parts: list[tuple] | None = None,
                       progress=None, resume: bool = True) -> dict:
    """Every frozen partition of one table. Exports only; deletes nothing.

    THIS IS A MAINTENANCE OPERATION, not something a request path calls. It
    holds one pooler connection (of 15) for its duration and competes with the
    live worker, so it should be run deliberately rather than on a schedule
    that can collide with a busy slate.
    """
    await conn.execute(f"SET statement_timeout = '{EXPORT_STATEMENT_TIMEOUT}'")
    parts = parts if parts is not None else await partitions_for(conn, table)
    verdicts = []
    for part in parts:
        path = os.path.join(out_dir, table, f"{partition_name(table, part)}.parquet")
        done = completed_manifest(path) if resume else None
        if done is not None:
            v = {"path": path, "partition": part, "table": table,
                 "pg_rows": done["rows"], "file_rows": done["rows"],
                 "pg_digest": done["digest"], "file_digest": done["digest"],
                 "bytes": done["bytes"], "row_count_match": True,
                 "digest_match": True, "columns_match": True, "ok": True,
                 "resumed": True}
        else:
            v = await export_partition(conn, table, part, out_dir, chunk_rows)
            if v.get("ok") and not v.get("skipped"):
                write_manifest(path, v)
        verdicts.append(v)
        if progress:
            progress(part, v)
    real = [v for v in verdicts if not v.get("skipped")]
    names = {partition_name(table, p) for p in parts}
    return {
        "table": table,
        "partitions": len(real),
        "resumed": sum(1 for v in real if v.get("resumed")),
        # Reported, never auto-deleted: a file this run did not write is not a
        # file this run understands.
        "stale_files": stale_partition_files(out_dir, table, names),
        "rows": sum(v["pg_rows"] for v in real),
        "bytes": sum(v["bytes"] for v in real),
        "all_verified": all(v["ok"] for v in real),
        "failed": [v["path"] for v in real if not v["ok"]],
        "verdicts": verdicts,
    }


# ---------------------------------------------------------------------------
# THE SCHEMA IS DECLARED FROM POSTGRES, NOT INFERRED FROM THE DATA.
# ---------------------------------------------------------------------------
#
# Inferring per chunk is what a first draft does, and it breaks on real data in
# a way that is obvious only afterwards: `player_game_history.team_id` is NULL
# in every row of the first chunk, so Arrow typed that chunk's column as `null`,
# opened the ParquetWriter with `team_id: null`, and then rejected a later chunk
# where the same column arrived as `string`. The export died mid-table.
#
# A chunk is not a sample of the schema; only the catalogue knows the schema.
# Declaring it up front also guarantees every partition of a table shares one
# schema, which is what lets DuckDB read the whole directory as a single
# relation -- files that disagree on a column's type cannot be globbed together.
#
# `numeric` maps to string deliberately. There are none in the corpus today
# (checked), but a float64 would silently lose precision on money, and losing
# precision quietly is the one failure this module cannot be allowed to have.

_PG_TO_ARROW = {
    "bigint": "int64", "integer": "int32", "smallint": "int16",
    "boolean": "bool_",   # pa.bool_(), not pa.bool "double precision": "float64", "real": "float32",
    "text": "string", "character varying": "string", "character": "string",
    "uuid": "string", "date": "date32",
    "jsonb": "string", "json": "string",   # canonicalised to text by `_cell`
    "numeric": "string",                   # never lose precision silently
}


async def arrow_schema(conn, table: str):
    """The Arrow schema for one corpus table, from `information_schema`."""
    import pyarrow as pa

    rows = await conn.fetch(
        """SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position""", table)
    fields = []
    for r in rows:
        dt = r["data_type"]
        if dt.startswith("timestamp"):
            # Every timestamp in this database is tz-aware; normalising to UTC
            # here is what makes the round-trip digest comparable, since
            # asyncpg and pyarrow disagree only on the tzinfo IMPLEMENTATION.
            arrow_t = pa.timestamp("us", tz="UTC")
        else:
            name = _PG_TO_ARROW.get(dt)
            if name is None:
                raise ValueError(
                    f"{table}.{r['column_name']}: no Arrow mapping for Postgres "
                    f"type {dt!r}. Add one deliberately rather than letting "
                    f"inference guess -- a wrong guess corrupts the corpus.")
            arrow_t = getattr(pa, name)()
        fields.append(pa.field(r["column_name"], arrow_t, nullable=True))
    return pa.schema(fields)


# ---------------------------------------------------------------------------
# RESUMABILITY. A long export must survive an interruption.
# ---------------------------------------------------------------------------
#
# The first real run died 30 minutes in with `ConnectionDoesNotExistError:
# connection was closed in the middle of operation` when the machine went down,
# having completed 17 partitions. Without resume the next attempt repeats all of
# it -- and this project has now lost long runs to a sleeping machine twice.
#
# A partition writes a MANIFEST next to its file on success, recording the row
# count, the digest and the byte size. Resume skips a partition whose manifest
# exists AND whose file is still exactly that size.
#
# THAT IS DELIBERATELY A CHEAP CHECK, NOT A FULL RE-VERIFICATION, and it is safe
# only because of what comes after it: 5.2d re-verifies every partition against
# Postgres from scratch before a single row is deleted. Resume optimises the
# EXPORT; it has no authority over the DELETE. If those two ever collapse into
# one step, this shortcut has to go with it.
#
# A file with no manifest is treated as absent and rewritten, which is what
# makes an interrupted partial file harmless -- and what stops a leftover from
# an older partitioning scheme being mistaken for valid output.


def manifest_path(parquet_path: str) -> str:
    return parquet_path + ".manifest.json"


def write_manifest(parquet_path: str, verdict: dict) -> None:
    with open(manifest_path(parquet_path), "w", encoding="utf-8") as fh:
        json.dump({"rows": verdict["pg_rows"], "digest": verdict["pg_digest"],
                   "bytes": verdict["bytes"], "table": verdict["table"],
                   "partition": list(verdict["partition"])}, fh)


def completed_manifest(parquet_path: str) -> dict | None:
    """The manifest for an already-finished partition, or None."""
    mp = manifest_path(parquet_path)
    if not (os.path.exists(mp) and os.path.exists(parquet_path)):
        return None
    try:
        with open(mp, encoding="utf-8") as fh:
            m = json.load(fh)
    except (OSError, ValueError):
        return None
    if m.get("bytes") != os.path.getsize(parquet_path):
        return None            # truncated or rewritten since — redo it
    return m


def stale_partition_files(out_dir: str, table: str, valid_names: set[str]) -> list[str]:
    """Parquet files in the table's directory that no current partition claims.

    Exists because a changed partitioning scheme leaves the old files sitting
    beside the new ones: switching from year to (sport, year) left
    `player_game_history_2010.parquet` next to
    `player_game_history_mlb_2010.parquet`, and a directory glob would have read
    BOTH and silently double-counted every row.
    """
    d = os.path.join(out_dir, table)
    if not os.path.isdir(d):
        return []
    return [os.path.join(d, f) for f in sorted(os.listdir(d))
            if f.endswith(".parquet") and f[:-len(".parquet")] not in valid_names]
