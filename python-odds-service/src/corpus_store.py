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
    """One table in the corpus, and how to tell a frozen row from a live one."""

    name: str
    partition_col: str          # what the Parquet layout is keyed on
    frozen_predicate: str
    json_columns: tuple[str, ...] = ()

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
    "mlb_pitch_events": CorpusTable(
        "mlb_pitch_events", "game_date", GAME_DATE_ONLY_PREDICATE),
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


def rows_digest(cols: list[str], rows: list[tuple]) -> str:
    """Order-independent digest of a row set.

    Order-independent because Postgres does not promise row order and a re-read
    may legitimately differ; CONTENT must match, sequence need not.
    """
    import hashlib

    h = hashlib.sha256()
    h.update(("\x1f".join(cols) + "\x1e").encode())
    for line in sorted("\x1f".join(_canon(v) for v in r) for r in rows):
        h.update(line.encode())
        h.update(b"\x1e")
    return h.hexdigest()


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
