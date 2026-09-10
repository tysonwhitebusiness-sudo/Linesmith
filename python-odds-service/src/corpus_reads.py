"""Phase 5.S.6 — the one way a fit reads `prop_odds_archive`.

Every prop fitter issues the same query against the same table:

    SELECT game_date, athlete_id, line, over_price, under_price[, type_name]
      FROM prop_odds_archive
     WHERE sport = ? AND type_name = ANY(?) AND line IS NOT NULL
       AND athlete_id IS NOT NULL

`fit_mlb_props`, `fit_nfl_props` and `fit_nfl_longest` each wrote their own copy
of it. That was harmless while there was one place to read from; it stops being
harmless the moment the table is split between Postgres and object storage,
because then each copy has to independently remember to read BOTH. This is the
same reasoning `job_runner.run_provider_specs` applies to cap-checking, and the
same failure it prevents: four hand-written job bodies each had to remember the
rate-limit check and two of them didn't.

THE READ IS A UNION, AND CORPUS-ONLY WOULD BE WRONG IN A WAY THAT LOOKS FINE.
The corpus holds everything up to its last export; Postgres holds whatever has
been captured since. Neither alone is complete. `write_history_summary` learned
this first and its comment says it plainly -- corpus-only silently omits the
newest rows, Postgres-only silently truncates the history. A fit reading either
half would train on a quietly different population and nothing downstream could
detect it.

Deduped on the row `id`, which both sides carry, so a row present in both is
counted once. The corpus side is read in a worker thread: DuckDB's S3 read is a
blocking C call, and running it on the event loop starves asyncpg's keepalive
until the pooler drops the connection (see `prune_pitch_events.py`, which found
this the hard way).

THE SORT IS TOTAL AND THAT IS NOT COSMETIC. Callers walk the result and some of
them break on a date boundary; `prop_odds_archive` genuinely holds several rows
per (game_date, athlete_id) -- different books, different lines -- so ties are
broken on `id` exactly as `mlb_props.load_game_history` does for doubleheaders.
"""
from __future__ import annotations

import asyncio
import os

COLUMNS = ("id", "game_date", "athlete_id", "line", "over_price",
           "under_price", "type_name", "sport")

def _corpus_rows(sport: str, type_names: list[str]) -> list[tuple]:
    """The corpus half. Blocking; call through `asyncio.to_thread`."""
    from corpus_location import corpus_location, read_parquet_glob

    con, glob = read_parquet_glob(corpus_location(), "prop_odds_archive")
    try:
        rows = con.execute(
            f"SELECT {', '.join(COLUMNS)} FROM read_parquet(?) "
            f" WHERE sport = ? AND line IS NOT NULL AND athlete_id IS NOT NULL "
            f"   AND list_contains(?::VARCHAR[], type_name)",
            [glob, sport, list(type_names)],
        ).fetchall()
    finally:
        con.close()
    return [tuple(r) for r in rows]


async def load_prop_archive(conn, sport: str, type_names: list[str],
                            source: str | None = None) -> list[dict]:
    """Every archived prop row for one sport and a set of market names.

    `source` exists so the two halves can be compared, which is 5.S.6's gate:
    a fit must produce bit-identical output from `"union"` and from
    `"postgres"` while Postgres still holds everything. A reader nobody has
    checked against the thing it replaces is a guess, not a port.

    `PROP_ARCHIVE_SOURCE` overrides it for a whole process, so a fit script can
    be run BOTH ways without editing it -- which is the only way to compare two
    fits that each take minutes and write their results to the database. It
    stays after 5.S.6 because the same comparison is what any future change to
    this reader will need.
    """
    source = source or os.environ.get("PROP_ARCHIVE_SOURCE") or "union"
    pg: list[tuple] = []
    if source in ("union", "postgres"):
        rows = await conn.fetch(
            f"SELECT {', '.join(COLUMNS)} FROM prop_odds_archive "
            f" WHERE sport = $1 AND line IS NOT NULL AND athlete_id IS NOT NULL"
            f"   AND type_name = ANY($2::text[])",
            sport, list(type_names))
        pg = [tuple(r[c] for c in COLUMNS) for r in rows]

    cp: list[tuple] = []
    if source in ("union", "corpus"):
        cp = await asyncio.to_thread(_corpus_rows, sport, type_names)

    seen: set = set()
    merged: list[tuple] = []
    for r in pg + cp:
        if r[0] in seen:
            continue
        seen.add(r[0])
        merged.append(r)
    # (game_date, athlete_id, id) — total, and the same order every caller got
    # from a bare `SELECT` on a freshly-loaded table, so a fit that depended on
    # incidental ordering keeps behaving.
    merged.sort(key=lambda t: (t[1], str(t[2]), t[0]))
    return [dict(zip(COLUMNS, r)) for r in merged]
