"""Phase 6.8 — nflverse play-by-play, the passing half.

WHAT THIS IS FOR. `lib/sports/nfl/nflverse.ts` pulls that project's WEEKLY BOX
SCORES only. The play-by-play release carries `air_yards`, `pass_location` and
`pass_length` per play, which is NFL's target map (`spatialGrid`) and target mix
(`usageMix`). Same vendor, same release mechanism, no key, no cost.

WHY HERE AND NOT IN nflverse.ts. `play_by_play_{season}.csv` is ~99 MB and 372
columns; that module is on the render path. Per CLAUDE.md and the operator's
2026-08-30 decision, Python owns the table.

================== READ BY HEADER NAME, NEVER BY POSITION =================

372 columns. The ones this needs sit at indexes 0, 1, 6, 7, 28, 36, 37, 38, 39,
129, 154, 164, 170, 173 and 285 TODAY, and nflverse has reordered its releases
before. Every field is resolved through the header row, so a reorder costs
nothing; a positional parser would silently read `week` as `posteam` and write
plausible garbage. `test_nfl_pbp.py` feeds it a deliberately shuffled header.
===========================================================================

STREAMED, NOT BUFFERED. 99 MB is more than this worker should hold at once,
and `httpx.stream` plus an incremental line splitter keeps the peak at one
chunk. That also means the CSV cannot be handed to `csv.reader` wholesale —
the reader is fed line by line.

ONLY PASS PLAYS WITH A RECEIVER ARE KEPT. A season is ~50k plays and the
passing game is roughly 19k of them; storing kickoffs to build a target map
would be storage spent on rows nothing reads.

INCOMPLETIONS ARE KEPT. `air_yards` exists on an incomplete pass, and a target
map built from completions only measures the quarterback rather than where the
receiver is used.
"""
from __future__ import annotations

import asyncio
import csv
import io
from dataclasses import dataclass

import httpx

import db

RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download"

# Rows per write. Well under the 32,767-parameter ceiling at 13 columns
# (2,000 x 13 = 26,000), and small enough that a failure mid-season loses
# little work.
BATCH_ROWS = 2000


@dataclass
class NflTargetEvent:
    game_id: str
    play_id: int
    season: int
    week: int | None
    receiver_id: str | None
    passer_id: str | None
    team: str | None
    air_yards: float | None
    pass_location: str | None
    pass_length: str | None
    yards_after_catch: float | None
    complete_pass: bool | None
    touchdown: bool | None
    interception: bool | None


def _text(value: str | None) -> str | None:
    """nflverse writes a missing value as 'NA' or ''. Neither is a value."""
    if value is None:
        return None
    v = value.strip()
    if v == "" or v == "NA":
        return None
    return v


def _num(value: str | None) -> float | None:
    """`None` rather than 0.0 for a missing number.

    An air-yards of 0 is a real, common value — a pass caught at the line — so
    defaulting a missing one to 0 would pile unknowns into a legitimate band
    and read as a real tendency.
    """
    v = _text(value)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _int(value: str | None) -> int | None:
    n = _num(value)
    return None if n is None else int(n)


def _bool(value: str | None) -> bool | None:
    """nflverse writes 1/0. `None` when absent — not False."""
    n = _num(value)
    return None if n is None else n != 0


def parse_row(row: dict[str, str], season: int) -> NflTargetEvent | None:
    """One CSV row -> one target event, or `None` if it is not one.

    Pure and exported for `test_nfl_pbp.py`, which feeds it a shuffled header:
    a test that re-implemented this mapping would agree with its bugs.
    """
    if _text(row.get("play_type")) != "pass":
        return None
    receiver = _text(row.get("receiver_player_id"))
    if receiver is None:
        # A pass with no receiver is a throwaway, a sack recorded as a pass, or
        # a spike. None of those is a target and none belongs on a target map.
        return None
    game_id = _text(row.get("game_id"))
    play_id = _int(row.get("play_id"))
    if game_id is None or play_id is None:
        return None

    return NflTargetEvent(
        game_id=game_id,
        play_id=play_id,
        season=season,
        week=_int(row.get("week")),
        receiver_id=receiver,
        passer_id=_text(row.get("passer_player_id")),
        team=_text(row.get("posteam")),
        air_yards=_num(row.get("air_yards")),
        pass_location=_text(row.get("pass_location")),
        pass_length=_text(row.get("pass_length")),
        yards_after_catch=_num(row.get("yards_after_catch")),
        complete_pass=_bool(row.get("complete_pass")),
        touchdown=_bool(row.get("touchdown")),
        interception=_bool(row.get("interception")),
    )


async def ingest_season(client: httpx.AsyncClient, season: int, yield_fn=None) -> dict:
    """Stream one season's play-by-play and write its target events.

    Idempotent on UNIQUE (game_id, play_id), so a re-run after an interruption
    re-inserts nothing. The stream is the expensive part, not the write.
    """
    url = f"{RELEASE_BASE}/pbp/play_by_play_{season}.csv"
    written = 0
    rows_seen = 0
    batch: list[NflTargetEvent] = []
    reader: csv.DictReader | None = None
    header: list[str] | None = None
    pending = ""

    async with client.stream("GET", url, timeout=180.0, follow_redirects=True) as res:
        if res.status_code != 200:
            return {"season": season, "written": 0, "error": f"HTTP {res.status_code}"}
        async for chunk in res.aiter_text():
            pending += chunk
            *lines, pending = pending.split("\n")
            for line in lines:
                if not line.strip():
                    continue
                if header is None:
                    header = next(csv.reader([line]))
                    continue
                try:
                    values = next(csv.reader([line]))
                except Exception:  # noqa: BLE001 — one malformed line must not end a season
                    continue
                if len(values) != len(header):
                    continue
                rows_seen += 1
                event = parse_row(dict(zip(header, values)), season)
                if event is None:
                    continue
                batch.append(event)
                if len(batch) >= BATCH_ROWS:
                    written += await db.write_nfl_target_events(batch)
                    batch = []
                    if yield_fn:
                        await yield_fn()

    # The final partial line, and whatever is left in the batch.
    if header is not None and pending.strip():
        try:
            values = next(csv.reader([pending]))
            if len(values) == len(header):
                event = parse_row(dict(zip(header, values)), season)
                if event is not None:
                    batch.append(event)
        except Exception:  # noqa: BLE001
            pass
    if batch:
        written += await db.write_nfl_target_events(batch)

    print(f"[nfl_pbp] season={season} rows={rows_seen} written={written}", flush=True)
    return {"season": season, "rows": rows_seen, "written": written}


def current_season() -> int:
    """NFL seasons are named for the year they start, and start in September."""
    from datetime import date

    today = date.today()
    return today.year if today.month >= 9 else today.year - 1


async def ingest_recent(client: httpx.AsyncClient, yield_fn=None) -> dict:
    """The scheduled path: re-stream the CURRENT season.

    There is no incremental endpoint — nflverse republishes the whole season
    file. That makes this the one ingester here whose cost does not fall as it
    catches up, which is why it runs DAILY rather than hourly: a 99 MB pull for
    a handful of new plays is not worth doing twelve times a day, and the write
    is idempotent so nothing is gained by it.

    Out of season this re-streams a finished file and writes zero rows.
    """
    return await ingest_season(client, current_season(), yield_fn)


async def backfill(seasons: list[int] | None = None) -> dict:
    """Operator-triggered historical pull.

        cd python-odds-service
        ./.venv/Scripts/python.exe -u src/nfl_pbp.py backfill 2023 2024
    """
    seasons = seasons or [current_season()]
    summary: dict = {"seasons": [], "written": 0}
    async with httpx.AsyncClient() as client:
        for season in seasons:
            result = await ingest_season(client, season)
            summary["seasons"].append(result)
            summary["written"] += result["written"]
    return summary


if __name__ == "__main__":
    import sys

    async def _main() -> None:
        if len(sys.argv) > 1 and sys.argv[1] == "backfill":
            print(await backfill([int(a) for a in sys.argv[2:]] or None))
        else:
            async with httpx.AsyncClient() as client:
                print(await ingest_recent(client))

    asyncio.run(_main())
