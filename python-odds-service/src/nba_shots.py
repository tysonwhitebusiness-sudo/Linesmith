"""Phase 6.7 — NBA shot coordinates. APPROVED (operator, 2026-08-29).

WHAT THIS IS FOR. `lib/sports/nba/sportsdataverse.ts` is integrated for box
scores only. ESPN's own summary endpoint returns `plays[]` with `coordinate`,
`shootingPlay`, `scoringPlay`, `scoreValue` and the shooter in
`participants[].athlete.id`. That is NBA's `spatialGrid` on all three boards.

Per CLAUDE.md's "Python writes, TypeScript renders" and the operator's
2026-08-30 decision on new sourcing tables, this is a Python batch job owning
its own table; `sportsdataverse.ts` is untouched.

================== THE SENTINEL, AND WHY IT MATTERS ========================

**ESPN encodes "no coordinate" as roughly -214748340**, near INT32_MIN, rather
than as null. A `coordinate.x != null` check accepts it happily.

Measured on one real game (401705663): 55 of 250 shooting plays carried it, and
including them made the mean two-point shot distance **72,623,934 feet**. That
is the kind of number that is obvious in an aggregate and invisible in a heat
map, where it simply lands every affected shot in one corner cell.

`_court_coord` rejects anything outside the real court bounds, so the database
never stores a sentinel and "we do not know where this was taken" stays
representable as NULL.

GEOMETRY, from ground truth rather than assumption: the basket is at (25, 0)
and units are feet. In that game three-pointers averaged 26.6 feet from that
point and two-pointers 12.9, against a real line of 22 feet in the corners and
23.75 at the top — which is what confirms both the origin and the scale.
===========================================================================

FREE THROWS ARE EXCLUDED. They have no floor location, they are not shots from
the field, and ESPN gives them the sentinel anyway. Including them would put a
quarter of every player's attempts at an invented spot.

RATE LIMITING. `_MIN_INTERVAL_S` spaces requests out — a courtesy pace against
a free public endpoint we do not own, not a measured ceiling.
"""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import httpx

import db

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"

# Seconds between requests. A courtesy pace, not a measured limit.
_MIN_INTERVAL_S = 0.6

# The real court, generously bounded. Anything outside is a sentinel or garbage.
_X_MIN, _X_MAX = -5.0, 55.0
_Y_MIN, _Y_MAX = -10.0, 100.0

_FREE_THROW = re.compile(r"free\s*throw", re.I)
_THREE = re.compile(r"three\s*point", re.I)

_last_request_at = 0.0


async def _throttle() -> None:
    global _last_request_at
    wait = _MIN_INTERVAL_S - (time.monotonic() - _last_request_at)
    if wait > 0:
        await asyncio.sleep(wait)
    _last_request_at = time.monotonic()


@dataclass
class NbaShotEvent:
    game_id: int
    event_idx: int
    game_date: str
    season: int
    shooter_id: int | None
    team_id: int | None
    shot_type: str | None
    point_value: int | None
    made: bool
    period: int | None
    x_coord: float | None
    y_coord: float | None


def _court_coord(value, lo: float, hi: float) -> float | None:
    """A real court coordinate, or `None`.

    THE SENTINEL CHECK. ESPN's missing-coordinate value is ~-214748340, which is
    finite and passes every null check. Bounding to the real court is what
    rejects it, and it rejects any other garbage for free.
    """
    if value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n != n or n < lo or n > hi:  # NaN or out of bounds
        return None
    return n


def _as_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_summary(payload: dict, game_id: int, season: int, game_date: str) -> list[NbaShotEvent]:
    """Field-goal attempts out of one game's summary.

    Pure, and exported for `test_nba_shots.py`: a test re-implementing this
    mapping beside it would agree with its bugs.
    """
    out: list[NbaShotEvent] = []
    for play in payload.get("plays") or []:
        if not play.get("shootingPlay"):
            continue
        type_text = ((play.get("type") or {}).get("text")) or play.get("text") or ""
        # Free throws are not shots from the floor — see the module docstring.
        if _FREE_THROW.search(type_text):
            continue

        coord = play.get("coordinate") or {}
        participants = play.get("participants") or []
        shooter = None
        if participants:
            shooter = ((participants[0].get("athlete") or {}).get("id"))

        score_value = _as_int(play.get("scoreValue"))
        # `scoreValue` is 0 on a MISS, so it cannot be the source of truth for
        # whether a shot was a three. The type text is.
        point_value = 3 if _THREE.search(type_text) else (score_value if score_value in (2, 3) else 2)

        out.append(
            NbaShotEvent(
                game_id=game_id,
                event_idx=_as_int(play.get("sequenceNumber")) or _as_int(play.get("id")) or 0,
                game_date=game_date,
                season=season,
                shooter_id=_as_int(shooter),
                team_id=_as_int((play.get("team") or {}).get("id")),
                shot_type=type_text or None,
                point_value=point_value,
                made=bool(play.get("scoringPlay")),
                period=_as_int((play.get("period") or {}).get("number")),
                x_coord=_court_coord(coord.get("x"), _X_MIN, _X_MAX),
                y_coord=_court_coord(coord.get("y"), _Y_MIN, _Y_MAX),
            )
        )
    return out


async def _get_json(client: httpx.AsyncClient, url: str) -> dict | None:
    await _throttle()
    try:
        res = await client.get(url, timeout=25.0)
    except Exception:  # noqa: BLE001 — one failed game must not abort a sweep
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except Exception:  # noqa: BLE001
        return None


async def games_on(client: httpx.AsyncClient, day: date) -> list[tuple[int, str]]:
    """Finished games on one date, as (game_id, game_date)."""
    data = await _get_json(client, f"{BASE}/scoreboard?dates={day.strftime('%Y%m%d')}")
    out: list[tuple[int, str]] = []
    for ev in (data or {}).get("events") or []:
        # Only finished games have a complete play-by-play. An in-progress game
        # would be ingested partially and never revisited, since the resume set
        # keys on "has any row".
        if ((ev.get("status") or {}).get("type") or {}).get("state") != "post":
            continue
        gid = _as_int(ev.get("id"))
        if gid is not None:
            out.append((gid, str(ev.get("date") or "")[:10]))
    return out


def season_for(day: date) -> int:
    """ESPN's season year — 2025 for the 2024-25 season, which starts in October."""
    return day.year + 1 if day.month >= 10 else day.year


async def ingest_days(client: httpx.AsyncClient, days: list[date], yield_fn=None) -> dict:
    written = 0
    considered = 0
    failures: list[str] = []
    done_by_season: dict[int, set[int]] = {}

    for day in days:
        season = season_for(day)
        if season not in done_by_season:
            done_by_season[season] = await db.nba_shot_events_done_games(season)
        for gid, gdate in await games_on(client, day):
            considered += 1
            if gid in done_by_season[season]:
                continue
            payload = await _get_json(client, f"{BASE}/summary?event={gid}")
            if not payload:
                failures.append(str(gid))
                continue
            rows = parse_summary(payload, gid, season, gdate or day.isoformat())
            if rows:
                written += await db.write_nba_shot_events(rows)
            done_by_season[season].add(gid)
            if yield_fn:
                await yield_fn(0.0)

    return {"considered": considered, "written": written, "failed_games": failures}


async def ingest_recent(client: httpx.AsyncClient, days: int = 3, yield_fn=None) -> dict:
    """The scheduled path: finished games from the last few days.

    Mirrors the Statcast and NHL jobs' own lookback reasoning — enough that a
    missed tick or short outage is covered, and cheap because the resume set
    skips the fetch for anything already stored.
    """
    today = datetime.now(timezone.utc).date()
    return await ingest_days(client, [today - timedelta(days=d) for d in range(days + 1)], yield_fn)


async def backfill(start_iso: str, end_iso: str) -> dict:
    """Operator-triggered historical pull over a date range.

    NOT on any schedule: a season is ~1,300 games of per-game requests. Run it
    directly:

        cd python-odds-service
        ./.venv/Scripts/python.exe -u src/nba_shots.py backfill 2024-10-22 2025-04-13

    Resumable by construction — `nba_shot_events_done_games` skips both the
    fetch and the write for anything already stored.
    """
    start = date.fromisoformat(start_iso)
    end = date.fromisoformat(end_iso)
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    async with httpx.AsyncClient() as client:
        return await ingest_days(client, days)


if __name__ == "__main__":
    import sys

    async def _main() -> None:
        if len(sys.argv) > 3 and sys.argv[1] == "backfill":
            print(await backfill(sys.argv[2], sys.argv[3]))
        else:
            async with httpx.AsyncClient() as client:
                print(await ingest_recent(client))

    asyncio.run(_main())
