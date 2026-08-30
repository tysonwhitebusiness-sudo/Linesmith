"""Phase 6.6 — pitch-level Statcast ingestion.

WHAT THIS IS FOR. `lib/sports/mlb/savant.ts` already calls Baseball Savant's
pitch-level endpoint but passes `group_by=name`, collapsing it to one
season-aggregate row per player. Ungrouped, the same keyless call returns every
pitch with its zone, pitch type, plate coordinates and expected wOBA — which is
the strike-zone grid (`spatialGrid`), the pitch mix (`usageMix`) and the
opposing-starter zone matchup on all three design boards, plus seven Statcast
metrics the mockups show and the app does not have.

WHY HERE AND NOT IN savant.ts. That TypeScript function is on the RENDER PATH:
it fills a season-aggregate cache the player and team pages read. Ungrouping it
in place would put ~700k rows per season through a page load. Per CLAUDE.md's
"Python writes, TypeScript renders" and the operator's 2026-08-30 decision, the
pitch-level pull is a Python batch job writing its own table; `savant.ts` is not
touched and keeps serving its aggregates.

NO KEY, NO VENDOR, NO COST. Same public endpoint the app already calls.

SWEPT BY DATE RANGE, NOT BY GAME. One request returns every pitch in a window.
A week at a time is ~26 requests per season rather than ~2,430 (one per game),
and the response is a CSV of roughly 20-30k rows. The window is deliberately
conservative: Savant will time out or truncate on a long enough range, and a
silently truncated CSV is worse than a slow one because nothing reports it.

RATE LIMITING. Savant publishes no documented limit. `_MIN_INTERVAL_S` spaces
requests out; this is a courtesy pace against a free public endpoint we do not
own, not a measured ceiling. Do not lower it to make a backfill finish sooner.
"""
from __future__ import annotations

import asyncio
import csv
import io
import time
from dataclasses import dataclass
from datetime import date, timedelta

import httpx

import db

SAVANT_CSV = "https://baseballsavant.mlb.com/statcast_search/csv"

# Days per request. See the module docstring on truncation.
WINDOW_DAYS = 7

# Seconds between requests. A courtesy pace, not a measured limit.
_MIN_INTERVAL_S = 3.0

# Operator decision, 2026-08-30: 2024 onwards.
FIRST_SEASON = 2024

# Savant returns the whole regular season plus postseason for `hfGT=R|PO|S|`.
# Sweeping March through November covers every one of them without needing a
# per-season schedule lookup.
_SEASON_START = (3, 1)
_SEASON_END = (11, 30)


@dataclass
class PitchEvent:
    game_pk: int
    at_bat_number: int
    pitch_number: int
    game_date: str
    season: int
    pitcher_id: int
    batter_id: int
    p_throws: str | None
    stand: str | None
    pitch_type: str | None
    zone: int | None
    plate_x: float | None
    plate_z: float | None
    release_speed: float | None
    launch_speed: float | None
    launch_angle: float | None
    estimated_woba: float | None
    description: str | None
    events: str | None
    balls: int | None
    strikes: int | None


def _num(raw: str | None) -> float | None:
    """Savant writes 'null' as an empty field AND sometimes as the literal
    string 'null'. Both must become None rather than 0.0 — a zeroed exit
    velocity is a real number that would drag every average it lands in."""
    if raw is None:
        return None
    s = raw.strip()
    if not s or s.lower() == "null":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _int(raw: str | None) -> int | None:
    v = _num(raw)
    return int(v) if v is not None else None


def _text(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = raw.strip()
    return s if s and s.lower() != "null" else None


def parse_statcast_csv(text: str) -> list[PitchEvent]:
    """Parses one ungrouped Savant CSV response.

    Column ORDER is not relied on anywhere — Savant has reordered and added
    columns before, and a positional parser would silently read the wrong
    field rather than fail. Everything is looked up by header name, and a row
    missing any of the four identity fields is dropped rather than guessed at.
    """
    if not text.strip():
        return []
    # Strip a UTF-8 BOM, which Savant sometimes sends and which would otherwise
    # become part of the first header's name.
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    out: list[PitchEvent] = []
    for row in reader:
        game_pk = _int(row.get("game_pk"))
        at_bat = _int(row.get("at_bat_number"))
        pitch_no = _int(row.get("pitch_number"))
        pitcher = _int(row.get("pitcher"))
        batter = _int(row.get("batter"))
        game_date = _text(row.get("game_date"))
        if game_pk is None or at_bat is None or pitch_no is None or pitcher is None or batter is None or not game_date:
            continue
        out.append(
            PitchEvent(
                game_pk=game_pk,
                at_bat_number=at_bat,
                pitch_number=pitch_no,
                game_date=game_date,
                season=int(game_date[:4]),
                pitcher_id=pitcher,
                batter_id=batter,
                p_throws=_text(row.get("p_throws")),
                stand=_text(row.get("stand")),
                pitch_type=_text(row.get("pitch_type")),
                zone=_int(row.get("zone")),
                plate_x=_num(row.get("plate_x")),
                plate_z=_num(row.get("plate_z")),
                release_speed=_num(row.get("release_speed")),
                launch_speed=_num(row.get("launch_speed")),
                launch_angle=_num(row.get("launch_angle")),
                estimated_woba=_num(row.get("estimated_woba_using_speedangle")),
                description=_text(row.get("description")),
                events=_text(row.get("events")),
                balls=_int(row.get("balls")),
                strikes=_int(row.get("strikes")),
            )
        )
    return out


_last_request_at = 0.0


async def fetch_range(client: httpx.AsyncClient, start: str, end: str) -> list[PitchEvent]:
    """One inclusive date window, 'YYYY-MM-DD'.

    Params mirror `savant.ts`'s own working call EXCEPT `group_by`, which is
    omitted — that single parameter is the whole difference between a season
    aggregate and every pitch.
    """
    global _last_request_at
    wait = _MIN_INTERVAL_S - (time.monotonic() - _last_request_at)
    if wait > 0:
        await asyncio.sleep(wait)
    _last_request_at = time.monotonic()

    params = {
        "all": "true",
        "hfGT": "R|PO|S|",
        "player_type": "pitcher",
        "type": "details",
        "min_pitches": "0",
        "min_results": "0",
        "min_abs": "0",
        "game_date_gt": start,
        "game_date_lt": end,
    }
    res = await client.get(SAVANT_CSV, params=params, timeout=httpx.Timeout(180.0))
    if res.status_code != 200:
        raise RuntimeError(f"Savant HTTP {res.status_code} for {start}..{end}")
    return parse_statcast_csv(res.text)


def _windows(season: int, through: date | None = None) -> list[tuple[str, str]]:
    """Inclusive date windows covering one season, oldest first."""
    start = date(season, *_SEASON_START)
    end = date(season, *_SEASON_END)
    if through and through < end:
        end = through
    out: list[tuple[str, str]] = []
    cur = start
    while cur <= end:
        last = min(cur + timedelta(days=WINDOW_DAYS - 1), end)
        out.append((cur.isoformat(), last.isoformat()))
        cur = last + timedelta(days=1)
    return out


async def ingest_season(client: httpx.AsyncClient, season: int, through: date | None = None, yield_fn=None) -> dict:
    """One season, window by window.

    A failed window is recorded and skipped rather than aborting the season:
    the write is idempotent on (game_pk, at_bat_number, pitch_number), so a
    re-run picks up exactly what was missed and re-inserts nothing. Failing the
    whole season on one bad window would throw away every window before it.
    """
    written = 0
    fetched = 0
    failures: list[str] = []
    for start, end in _windows(season, through):
        try:
            events = await fetch_range(client, start, end)
        except Exception as exc:  # noqa: BLE001 — recorded, not swallowed
            failures.append(f"{start}..{end}: {type(exc).__name__}: {exc}")
            print(f"[statcast_pitches] {start}..{end} FAILED: {exc}", flush=True)
            continue
        fetched += len(events)
        if events:
            written += await db.write_mlb_pitch_events(events)
        print(f"[statcast_pitches] {start}..{end} fetched={len(events)} written={written}", flush=True)
        if yield_fn:
            await yield_fn(0.0)
    return {"season": season, "fetched": fetched, "written": written, "failed_windows": failures}


async def ingest_recent(client: httpx.AsyncClient, days: int = 3, yield_fn=None) -> dict:
    """The scheduled path: just the last few days.

    `days=3` mirrors `genericPlayerHistoryFreshnessJob`'s own LOOKBACK_DAYS —
    enough that a missed tick or a short outage is covered on the next run,
    and cheap because the write is idempotent so re-covered days cost one
    request and zero inserts.
    """
    today = date.today()
    start = today - timedelta(days=days)
    try:
        events = await fetch_range(client, start.isoformat(), today.isoformat())
    except Exception as exc:  # noqa: BLE001
        return {"fetched": 0, "written": 0, "failed_windows": [f"{start}..{today}: {exc}"]}
    written = await db.write_mlb_pitch_events(events) if events else 0
    return {"fetched": len(events), "written": written, "failed_windows": []}


async def backfill(seasons: list[int] | None = None) -> dict:
    """Operator-triggered historical pull, 2024 onwards by default.

    NOT on any schedule and deliberately not wired into JOB_REGISTRY: it is a
    long multi-season sweep, and the worker's job loop is for recurring work.
    Run it directly:

        cd python-odds-service
        ./.venv/Scripts/python.exe -u src/statcast_pitches.py backfill

    Resumable by construction — re-running skips everything already stored.
    """
    seasons = seasons or list(range(FIRST_SEASON, date.today().year + 1))
    summary = {"seasons": [], "written": 0}
    async with httpx.AsyncClient() as client:
        for season in seasons:
            through = date.today() if season == date.today().year else None
            result = await ingest_season(client, season, through)
            summary["seasons"].append(result)
            summary["written"] += result["written"]
    return summary


if __name__ == "__main__":
    import sys

    async def _main() -> None:
        if len(sys.argv) > 1 and sys.argv[1] == "backfill":
            seasons = [int(a) for a in sys.argv[2:]] or None
            print(await backfill(seasons))
        else:
            async with httpx.AsyncClient() as client:
                print(await ingest_recent(client))

    asyncio.run(_main())
