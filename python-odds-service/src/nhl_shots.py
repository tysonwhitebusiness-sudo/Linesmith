"""Phase 6.7 — NHL shot coordinates. APPROVED (operator, 2026-08-29).

WHAT THIS IS FOR. `lib/sports/nhl/nhle.ts` is integrated for rosters, standings
and schedules and pulls no shot data at all. The same official, keyless API
exposes `/gamecenter/{gameId}/play-by-play`, whose plays carry
`details.xCoord`/`details.yCoord`, `shootingPlayerId` and a `typeDescKey` of
`shot-on-goal`, `missed-shot`, `blocked-shot` or `goal`. That is NHL's
`spatialGrid` on all three boards.

Verified against a real finished game before any of this was written
(2024010006): 321 plays, 102 of them shots, coordinates present.

WHY HERE AND NOT IN nhle.ts. That TypeScript module is on the RENDER PATH and
writes read-through caches into `snapshot_cache`. A season is ~230k shot events
and has no business being rebuilt on a page load. Per CLAUDE.md's "Python
writes, TypeScript renders" and the operator's 2026-08-30 decision on new
sourcing tables, this is a Python batch job owning its own table; `nhle.ts` is
untouched.

NO KEY, NO VENDOR, NO COST. The same public API the app already calls.

SWEPT BY GAME, NOT BY DATE. Unlike Savant, there is no range endpoint — the
play-by-play is per game. That makes the request count equal to the game count
(~1,300 a season), which is why `nhl_shot_events_done_games` exists: resuming
skips the FETCH, not just the write. The UNIQUE constraint alone would make a
re-run a no-op but would still pay for every network call again.

RATE LIMITING. The NHL publishes no documented limit. `_MIN_INTERVAL_S` spaces
requests out; this is a courtesy pace against a free public endpoint we do not
own, not a measured ceiling. Do not lower it to make a backfill finish sooner.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import httpx

import db

BASE = "https://api-web.nhle.com/v1"

# Seconds between requests. A courtesy pace, not a measured limit.
_MIN_INTERVAL_S = 0.6

# The feed's own vocabulary. Kept as a set rather than folded to a boolean:
# blocked and missed shots are exactly what separates a volume shooter from an
# efficient one, and a goal is a shot too.
SHOT_EVENTS = {"shot-on-goal", "missed-shot", "blocked-shot", "goal"}

# Every current club, for the season-schedule sweep. The schedule endpoint is
# per club, so a season is covered by walking clubs and de-duplicating game ids
# (each game appears on two clubs' schedules).
TEAM_ABBREVS = [
    "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET",
    "EDM", "FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT",
    "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK",
    "WPG", "WSH",
]

_last_request_at = 0.0


async def _throttle() -> None:
    global _last_request_at
    wait = _MIN_INTERVAL_S - (time.monotonic() - _last_request_at)
    if wait > 0:
        await asyncio.sleep(wait)
    _last_request_at = time.monotonic()


@dataclass
class NhlShotEvent:
    game_id: int
    event_idx: int
    game_date: str
    season: str
    shooter_id: int | None
    goalie_id: int | None
    team_id: int | None
    event_type: str
    shot_type: str | None
    period: int | None
    period_seconds: int | None
    x_coord: int | None
    y_coord: int | None
    zone_code: str | None


def _period_seconds(time_in_period: str | None) -> int | None:
    """'MM:SS' -> seconds. `None` for anything that is not that shape.

    Deliberately not defaulted to 0: a shot at an unknown time is not a shot in
    the first second, and a pile of them at 0:00 would read as a real pattern.
    """
    if not time_in_period or ":" not in time_in_period:
        return None
    mins, _, secs = time_in_period.partition(":")
    try:
        return int(mins) * 60 + int(secs)
    except ValueError:
        return None


def _as_int(value) -> int | None:
    """`None` rather than 0 for a missing value — see `_period_seconds`."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_play_by_play(payload: dict, game_id: int, season: str, game_date: str) -> list[NhlShotEvent]:
    """Shot attempts out of one game's play-by-play.

    Pure, and exported for `test_nhl_shots.py`: a test that re-implements this
    mapping beside it would agree with its bugs, which this repo has already
    been bitten by once (see `understat-venue.test.ts`).

    THE SHOOTER IS NOT IN THE SAME FIELD FOR EVERY EVENT TYPE. A shot-on-goal
    and a goal carry `shootingPlayerId`; a blocked shot carries
    `shootingPlayerId` alongside `blockingPlayerId`; a missed shot uses
    `shootingPlayerId` too. `scoringPlayerId` appears on goals instead on some
    payloads. All the spellings are tried rather than assuming one, because a
    silently-null shooter drops the shot from every player page while the row
    still lands in the table looking healthy.
    """
    out: list[NhlShotEvent] = []
    for play in payload.get("plays") or []:
        event_type = play.get("typeDescKey")
        if event_type not in SHOT_EVENTS:
            continue
        details = play.get("details") or {}

        shooter = (
            details.get("shootingPlayerId")
            or details.get("scoringPlayerId")
            or details.get("playerId")
        )

        out.append(
            NhlShotEvent(
                game_id=game_id,
                event_idx=_as_int(play.get("sortOrder") if play.get("sortOrder") is not None else play.get("eventId")) or 0,
                game_date=game_date,
                season=season,
                shooter_id=_as_int(shooter),
                goalie_id=_as_int(details.get("goalieInNetId")),
                team_id=_as_int(details.get("eventOwnerTeamId")),
                event_type=event_type,
                shot_type=details.get("shotType"),
                period=_as_int((play.get("periodDescriptor") or {}).get("number")),
                period_seconds=_period_seconds(play.get("timeInPeriod")),
                x_coord=_as_int(details.get("xCoord")),
                y_coord=_as_int(details.get("yCoord")),
                zone_code=details.get("zoneCode"),
            )
        )
    return out


async def _get_json(client: httpx.AsyncClient, url: str) -> dict | None:
    await _throttle()
    try:
        res = await client.get(url, timeout=20.0)
    except Exception:  # noqa: BLE001 — a single failed game must not abort a sweep
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except Exception:  # noqa: BLE001
        return None


async def season_game_ids(client: httpx.AsyncClient, season: str) -> list[tuple[int, str]]:
    """Every finished game in a season, as (game_id, game_date).

    Walks each club's own season schedule because the API has no league-wide
    one, and de-duplicates: every game appears on two clubs' schedules.
    """
    seen: dict[int, str] = {}
    for abbrev in TEAM_ABBREVS:
        data = await _get_json(client, f"{BASE}/club-schedule-season/{abbrev}/{season}")
        if not data:
            continue
        for game in data.get("games") or []:
            # Only finished games have a complete play-by-play. An in-progress
            # game would be ingested partially and then never revisited, since
            # the resume set keys on "has any row".
            if game.get("gameState") not in {"OFF", "FINAL"}:
                continue
            gid = _as_int(game.get("id"))
            if gid is not None:
                seen[gid] = str(game.get("gameDate") or "")
    return sorted(seen.items())


async def ingest_season(client: httpx.AsyncClient, season: str, yield_fn=None) -> dict:
    """One season, game by game, skipping anything already stored."""
    games = await season_game_ids(client, season)
    done = await db.nhl_shot_events_done_games(season)
    todo = [(gid, gdate) for gid, gdate in games if gid not in done]

    written = 0
    failures: list[str] = []
    for gid, gdate in todo:
        payload = await _get_json(client, f"{BASE}/gamecenter/{gid}/play-by-play")
        if not payload:
            failures.append(str(gid))
            continue
        rows = parse_play_by_play(payload, gid, season, gdate)
        if rows:
            written += await db.write_nhl_shot_events(rows)
        if yield_fn:
            await yield_fn()
    print(
        f"[nhl_shots] season={season} games={len(games)} already={len(done)} "
        f"fetched={len(todo)} written={written} failed={len(failures)}",
        flush=True,
    )
    return {"season": season, "games": len(games), "skipped": len(done), "written": written, "failed_games": failures}


def current_season() -> str:
    """NHL seasons run Oct-Jun and are written '20242025'."""
    today = date.today()
    start = today.year if today.month >= 9 else today.year - 1
    return f"{start}{start + 1}"


async def ingest_recent(client: httpx.AsyncClient, days: int = 3, yield_fn=None) -> dict:
    """The scheduled path: finished games from the last few days.

    Mirrors `statcast_pitches.ingest_recent`'s reasoning — enough that a missed
    tick or a short outage is covered on the next run, and cheap because the
    resume set skips the fetch for anything already stored.
    """
    season = current_season()
    games = await season_game_ids(client, season)
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    recent = [(gid, gdate) for gid, gdate in games if gdate >= cutoff]
    done = await db.nhl_shot_events_done_games(season)

    written = 0
    failures: list[str] = []
    for gid, gdate in recent:
        if gid in done:
            continue
        payload = await _get_json(client, f"{BASE}/gamecenter/{gid}/play-by-play")
        if not payload:
            failures.append(str(gid))
            continue
        rows = parse_play_by_play(payload, gid, season, gdate)
        if rows:
            written += await db.write_nhl_shot_events(rows)
        if yield_fn:
            await yield_fn()
    return {"season": season, "considered": len(recent), "written": written, "failed_games": failures}


async def backfill(seasons: list[str] | None = None) -> dict:
    """Operator-triggered historical pull.

    NOT on any schedule and deliberately not in JOB_REGISTRY: it is a long
    multi-season sweep and the worker's job loop is for recurring work. Run it
    directly:

        cd python-odds-service
        ./.venv/Scripts/python.exe -u src/nhl_shots.py backfill 20242025

    Resumable by construction — `nhl_shot_events_done_games` skips both the
    fetch and the write for anything already stored.
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
            print(await backfill(sys.argv[2:] or None))
        else:
            async with httpx.AsyncClient() as client:
                print(await ingest_recent(client))

    asyncio.run(_main())
