"""The compact price history (P5 amendment A1, decision D24) — the ONE Python
module that knows its layout.

`prop_price_history` and `game_lines_history` store every price change as
integer codes into small dictionary tables (`odds_games`, `odds_subjects`,
`odds_markets`, `odds_books`, `odds_sources`, `odds_sides`, `odds_periods`),
one partition per UTC day of `recorded_at`. Measured on 2026-09-25 the layout
costs ~117 B/row against 345 B/row for the text-keyed `prop_odds_history` it
replaces, and D24 needs that: every matched price change from every source is
8.1M rows/day.

Everything that writes or reads those tables goes through here — the writers in
`db.py`, the corpus export in `history_mover.py`, the disk guard, the health
check. Nothing else names them (`test_price_history.py` greps for it), so the
layout can change in one file.

TWO TIMES PER ROW.
  observed_at   when the price changed at the source ("since", D23). Paid feeds
                send no time, so for them it is the write time, exactly as
                `prop_odds_history.observed_at` always was.
  recorded_at   when our writer stored the row. The partition key, because only
                a write time is monotonic: a relay's change time can be hours
                old, and a day that is closed and exported must never receive
                another row. `observed_at <= recorded_at` is a CHECK; a source
                clock ahead of ours is clamped to ours (a clock error, not a
                future price).

CODES ARE RESOLVED OUTSIDE THE CALLER'S TRANSACTION, in their own committed
statements. A code created inside a transaction that later rolls back would
leave this process caching an id that does not exist, and there is no foreign
key to catch it (one per row at 8.1M rows/day is a cost the export's own
row-count check makes unnecessary: a row whose code is missing decodes to
nothing, the decoded count falls short of the partition's, and the export
refuses).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

# New rows start here; `prop_odds_history` ended at 13,151,692. Rows below it
# are the legacy rows, already in the corpus's id-chunk files; rows at or above
# it are exported per day. See corpus_store.PROP_HISTORY and history_mover.
LEGACY_ID_CEILING = 13_500_001

PROP_TABLE = "prop_price_history"
GAME_TABLE = "game_lines_history"
HISTORY_TABLES = (PROP_TABLE, GAME_TABLE)

# (table, text column) per dictionary kind. `sources` is keyed on three columns
# and handled on its own.
_DICTS: dict[str, tuple[str, str]] = {
    "game": ("odds_games", "game_id"),
    "subject": ("odds_subjects", "subject_id"),
    "market": ("odds_markets", "name"),
    "book": ("odds_books", "name"),
    "side": ("odds_sides", "name"),
    "period": ("odds_periods", "name"),
}

SourceKey = tuple[str, bool, "int | None"]


def line_survives(line: float | None) -> bool:
    """True if `line` comes back exactly from a `real` column.

    The column is `real` (4 bytes) and readers decode it as
    `line::numeric::float8`, which restores any value with at most six
    significant digits (24.3, 0.1, 245.5, 1234.25 — checked in Postgres
    2026-09-25). None of the 7,051,336 converted rows fails this. A line that
    does is not stored rounded; the writer rejects it and says so.
    """
    if line is None:
        return True
    if not math.isfinite(line):
        return False
    return float(f"{line:.6g}") == line


class Codes:
    """Process-lifetime cache of dictionary codes. Codes never change meaning,
    so a cached code is valid for as long as the process lives."""

    def __init__(self) -> None:
        self._maps: dict[str, dict[str, int]] = {k: {} for k in _DICTS}
        self._sources: dict[SourceKey, int] = {}

    def code(self, kind: str, value: str) -> int:
        return self._maps[kind][value]

    def source(self, key: SourceKey) -> int:
        return self._sources[key]

    def reset(self) -> None:
        """Tests only: forget everything (after they delete their own codes)."""
        for m in self._maps.values():
            m.clear()
        self._sources.clear()

    async def resolve(self, pool, *, games: dict[str, str | None] | None = None,
                      sources: set[SourceKey] | None = None, **values: set[str]) -> None:
        """Make sure every value has a code, creating missing ones.

        `games` maps game_id -> sport (None when the writer does not know it).
        Other kinds are passed by name: subject=, market=, book=, side=, period=.
        Runs on its own connection, outside any caller transaction (module doc).
        """
        todo: dict[str, list[str]] = {}
        if games:
            missing = [g for g in games if g not in self._maps["game"]]
            if missing:
                todo["game"] = missing
        for kind, vals in values.items():
            if kind not in _DICTS:
                raise KeyError(kind)
            missing = [v for v in vals if v not in self._maps[kind]]
            if missing:
                todo[kind] = sorted(set(missing))
        missing_src = sorted((s for s in (sources or ()) if s not in self._sources),
                             key=lambda s: (s[0], s[1], -1 if s[2] is None else s[2]))
        if not todo and not missing_src:
            return

        async with pool.acquire(timeout=30.0) as conn:
            for kind, vals in todo.items():
                table, col = _DICTS[kind]
                if kind == "game":
                    sports = [games.get(g) for g in vals]
                    await conn.execute(
                        """INSERT INTO odds_games (game_id, sport)
                           SELECT * FROM unnest($1::text[], $2::text[])
                           ON CONFLICT (game_id) DO UPDATE SET sport = excluded.sport
                            WHERE odds_games.sport IS NULL AND excluded.sport IS NOT NULL""",
                        vals, sports)
                else:
                    await conn.execute(
                        f"INSERT INTO {table} ({col}) SELECT unnest($1::text[]) "
                        f"ON CONFLICT ({col}) DO NOTHING", vals)
                rows = await conn.fetch(
                    f"SELECT id, {col} AS v FROM {table} WHERE {col} = ANY($1::text[])", vals)
                for r in rows:
                    self._maps[kind][r["v"]] = r["id"]
                if len(rows) != len(set(vals)):
                    raise RuntimeError(f"{table}: {len(set(vals)) - len(rows)} code(s) not created")
            if missing_src:
                prov = [s[0] for s in missing_src]
                dly = [bool(s[1]) for s in missing_src]
                secs = [s[2] for s in missing_src]
                await conn.execute(
                    """INSERT INTO odds_sources (provider_id, is_delayed, delay_seconds)
                       SELECT * FROM unnest($1::text[], $2::boolean[], $3::integer[])
                       ON CONFLICT ON CONSTRAINT odds_sources_key DO NOTHING""",
                    prov, dly, secs)
                rows = await conn.fetch(
                    """SELECT s.id, s.provider_id, s.is_delayed, s.delay_seconds
                         FROM odds_sources s
                         JOIN unnest($1::text[], $2::boolean[], $3::integer[]) AS k(p, d, n)
                           ON s.provider_id = k.p AND s.is_delayed = k.d
                          AND s.delay_seconds IS NOT DISTINCT FROM k.n""",
                    prov, dly, secs)
                for r in rows:
                    self._sources[(r["provider_id"], r["is_delayed"], r["delay_seconds"])] = r["id"]


CODES = Codes()


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


@dataclass
class PropHistoryRow:
    provider_id: str
    is_delayed: bool
    delay_seconds: int | None
    game_id: str
    subject_id: str
    market_key: str
    line: float | None
    side: str
    bookmaker: str
    american_odds: int
    decimal_odds: float | None
    observed_at: datetime
    recorded_at: datetime


@dataclass
class GameLineHistoryRow:
    sport: str
    game_id: str
    period: str
    market: str
    side: str
    point: float | None
    is_main: bool
    bookmaker: str
    source: str
    american_odds: int
    observed_at: datetime
    recorded_at: datetime


def _clamp(observed: datetime, recorded: datetime) -> datetime:
    return observed if observed <= recorded else recorded


def split_unstorable(rows, line_attr: str) -> tuple[list, list]:
    """(storable, rejected): rejected rows have a line a `real` cannot hold."""
    ok, bad = [], []
    for r in rows:
        (ok if line_survives(getattr(r, line_attr)) else bad).append(r)
    return ok, bad


async def resolve_prop_rows(pool, rows: list[PropHistoryRow]) -> None:
    await CODES.resolve(
        pool,
        games={r.game_id: None for r in rows},
        sources={(r.provider_id, bool(r.is_delayed), r.delay_seconds) for r in rows},
        subject={r.subject_id for r in rows}, market={r.market_key for r in rows},
        book={r.bookmaker for r in rows}, side={r.side for r in rows})


async def insert_prop_history(conn, rows: list[PropHistoryRow]) -> int:
    """Insert already-resolved rows (call `resolve_prop_rows` first, OUTSIDE
    the transaction `conn` is in). One statement for the whole batch."""
    if not rows:
        return 0
    c = CODES
    await conn.execute(
        f"""INSERT INTO {PROP_TABLE}
              (observed_at, recorded_at, decimal_odds, game, subject, line, price, market, book, source, side)
            SELECT * FROM unnest($1::timestamptz[], $2::timestamptz[], $3::float8[], $4::int[], $5::int[],
                                 $6::real[], $7::int[], $8::smallint[], $9::smallint[], $10::smallint[], $11::smallint[])""",
        [_clamp(r.observed_at, r.recorded_at) for r in rows],
        [r.recorded_at for r in rows],
        [r.decimal_odds for r in rows],
        [c.code("game", r.game_id) for r in rows],
        [c.code("subject", r.subject_id) for r in rows],
        [r.line for r in rows],
        [r.american_odds for r in rows],
        [c.code("market", r.market_key) for r in rows],
        [c.code("book", r.bookmaker) for r in rows],
        [c.source((r.provider_id, bool(r.is_delayed), r.delay_seconds)) for r in rows],
        [c.code("side", r.side) for r in rows],
    )
    return len(rows)


async def resolve_game_rows(pool, rows: list[GameLineHistoryRow]) -> None:
    await CODES.resolve(
        pool,
        games={r.game_id: r.sport for r in rows},
        sources={(r.source, False, None) for r in rows},
        market={r.market for r in rows}, period={r.period for r in rows},
        book={r.bookmaker for r in rows}, side={r.side for r in rows})


async def insert_game_line_history(conn, rows: list[GameLineHistoryRow]) -> int:
    if not rows:
        return 0
    c = CODES
    await conn.execute(
        f"""INSERT INTO {GAME_TABLE}
              (observed_at, recorded_at, game, point, price, market, period, side, book, source, is_main)
            SELECT * FROM unnest($1::timestamptz[], $2::timestamptz[], $3::int[], $4::real[], $5::int[],
                                 $6::smallint[], $7::smallint[], $8::smallint[], $9::smallint[], $10::smallint[],
                                 $11::boolean[])""",
        [_clamp(r.observed_at, r.recorded_at) for r in rows],
        [r.recorded_at for r in rows],
        [c.code("game", r.game_id) for r in rows],
        [r.point for r in rows],
        [r.american_odds for r in rows],
        [c.code("market", r.market) for r in rows],
        [c.code("period", r.period) for r in rows],
        [c.code("side", r.side) for r in rows],
        [c.code("book", r.bookmaker) for r in rows],
        [c.source((r.source, False, None)) for r in rows],
        [bool(r.is_main) for r in rows],
    )
    return len(rows)


# ---------------------------------------------------------------------------
# Decode. The column lists are the corpus's Parquet schemas: the prop one is
# EXACTLY `prop_odds_history`'s (A1: the models read the corpus, so it does not
# change), in its column order and with its types.
# ---------------------------------------------------------------------------

# `line::numeric::float8` restores the value the writer was given (see
# `line_survives`); a plain `::float8` would turn 24.3 into 24.299999237.
PROP_DECODED = """
    h.id                         AS id,
    s.provider_id                AS provider_id,
    g.game_id                    AS game_id,
    sj.subject_id                AS subject_id,
    m.name                       AS market_key,
    h.line::numeric::float8      AS line,
    sd.name                      AS side,
    b.name                       AS bookmaker,
    h.price                      AS american_odds,
    h.decimal_odds               AS decimal_odds,
    h.observed_at                AS observed_at,
    s.is_delayed                 AS is_delayed,
    s.delay_seconds              AS delay_seconds"""

PROP_JOINS = """
    JOIN odds_games g     ON g.id = h.game
    JOIN odds_subjects sj ON sj.id = h.subject
    JOIN odds_markets m   ON m.id = h.market
    JOIN odds_books b     ON b.id = h.book
    JOIN odds_sources s   ON s.id = h.source
    JOIN odds_sides sd    ON sd.id = h.side"""

# (name, Postgres type) in Parquet order — prop_odds_history's own catalogue,
# frozen here because that table is dropped once converted.
PROP_CORPUS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("id", "bigint"), ("provider_id", "text"), ("game_id", "text"), ("subject_id", "text"),
    ("market_key", "text"), ("line", "double precision"), ("side", "text"), ("bookmaker", "text"),
    ("american_odds", "integer"), ("decimal_odds", "double precision"),
    ("observed_at", "timestamp with time zone"), ("is_delayed", "boolean"), ("delay_seconds", "integer"),
)

GAME_DECODED = """
    g.sport                      AS sport,
    g.game_id                    AS game_id,
    pr.name                      AS period,
    m.name                       AS market,
    sd.name                      AS side,
    h.point::numeric::float8     AS point,
    h.is_main                    AS is_main,
    b.name                       AS bookmaker,
    s.provider_id                AS source,
    h.price                      AS american_odds,
    h.observed_at                AS observed_at,
    h.recorded_at                AS recorded_at"""

GAME_JOINS = """
    JOIN odds_games g     ON g.id = h.game
    JOIN odds_periods pr  ON pr.id = h.period
    JOIN odds_markets m   ON m.id = h.market
    JOIN odds_books b     ON b.id = h.book
    JOIN odds_sources s   ON s.id = h.source
    JOIN odds_sides sd    ON sd.id = h.side"""

GAME_CORPUS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("sport", "text"), ("game_id", "text"), ("period", "text"), ("market", "text"), ("side", "text"),
    ("point", "double precision"), ("is_main", "boolean"), ("bookmaker", "text"), ("source", "text"),
    ("american_odds", "integer"), ("observed_at", "timestamp with time zone"),
    ("recorded_at", "timestamp with time zone"),
)


def decoded_select(table: str, where: str = "true", order: str | None = None) -> str:
    """`SELECT <decoded columns> FROM <table> h <joins> WHERE <where>`."""
    if table == PROP_TABLE:
        cols, joins = PROP_DECODED, PROP_JOINS
    elif table == GAME_TABLE:
        cols, joins = GAME_DECODED, GAME_JOINS
    else:
        raise ValueError(table)
    sql = f"SELECT {cols}\n  FROM {table} h {joins}\n WHERE {where}"
    return sql + (f"\n ORDER BY {order}" if order else "")


def corpus_columns(table: str) -> tuple[tuple[str, str], ...]:
    return PROP_CORPUS_COLUMNS if table == PROP_TABLE else GAME_CORPUS_COLUMNS


def partition_name(table: str, day) -> str:
    return f"{table}_p{day:%Y%m%d}"


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def read_prop_history_for_key(pool, game_id: str, subject_id: str, market_key: str,
                                    line: float | None) -> list:
    """Every price change for one exact market + line (grading's read).

    The game/subject/market codes are looked up first, so the chart index
    `(game, subject, market, observed_at)` does the work; `line IS NOT DISTINCT
    FROM` because a line-less market has NULL there and `=` never matches it.
    """
    return await pool.fetch(
        f"""SELECT s.provider_id, b.name AS bookmaker, sd.name AS side,
                   h.price AS american_odds, h.observed_at
              FROM {PROP_TABLE} h
              JOIN odds_books b   ON b.id = h.book
              JOIN odds_sources s ON s.id = h.source
              JOIN odds_sides sd  ON sd.id = h.side
             WHERE h.game = (SELECT id FROM odds_games WHERE game_id = $1)
               AND h.subject = (SELECT id FROM odds_subjects WHERE subject_id = $2)
               AND h.market = (SELECT id FROM odds_markets WHERE name = $3)
               AND h.line::numeric::float8 IS NOT DISTINCT FROM $4::float8""",
        game_id, subject_id, market_key, line)


async def partition_days(conn, table: str) -> list[dict]:
    """Every daily partition of `table`: its day, name and total size in bytes."""
    rows = await conn.fetch(
        """SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
             FROM pg_inherits i
             JOIN pg_class c ON c.oid = i.inhrelid
             JOIN pg_class p ON p.oid = i.inhparent
            WHERE p.relname = $1
            ORDER BY c.relname""", table)
    out = []
    for r in rows:
        stamp = r["name"].rsplit("_p", 1)[-1]
        day = datetime.strptime(stamp, "%Y%m%d").date()
        out.append({"day": day, "name": r["name"], "bytes": int(r["bytes"])})
    return out


async def table_size(conn, table: str) -> dict:
    """Total bytes and live-row estimate of a partitioned history table, summed
    over its partitions (a partitioned parent itself reports 0)."""
    r = await conn.fetchrow(
        """SELECT coalesce(sum(pg_total_relation_size(i.inhrelid)), 0)::bigint AS bytes,
                  coalesce(sum(c.reltuples), 0)::bigint AS rows
             FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
             JOIN pg_class p ON p.oid = i.inhparent
            WHERE p.relname = $1""", table)
    return {"bytes": int(r["bytes"]), "rows": int(r["rows"])}
