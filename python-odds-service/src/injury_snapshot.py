"""
Daily injury/availability snapshot — the one feed that cannot be bought later.

WHY THIS IS NOT NEW INGESTION. ESPN injuries are ALREADY fetched every day and
thrown away. Measured 2026-08-31, `snapshot_cache` held `espn-nfl-injuries`
(8.9 MB), `espnTeamSport:injuries:basketball:nba`, `:hockey:nhl`,
`:college-football` and eight `mlb:injuries:*` keys — and a retention rule
deletes the MLB ones after two days with the comment "an injury list older than
2 days is not an injury list". True for a cache. Exactly wrong for a training
set.

WHY IT MATTERS. No model in this system can currently learn what a player's
absence is worth, and no backtest can know the game it is scoring was played
without a starting quarterback. Unlike odds, this CANNOT be bought
retroactively — every day it does not run is a day of training data that will
never exist.

The table is keyed (sport, captured_on, athlete) so a re-run on the same day
updates rather than duplicating, and a missed day is simply absent rather than
being back-filled with today's list pretending to be yesterday's.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

import httpx

import db

# ESPN's injuries endpoint, per sport. The path is the same shape the app's
# own adapters already use.
SPORT_PATHS = [
    ("nfl", "football/nfl"),
    ("cfb", "football/college-football"),
    ("nba", "basketball/nba"),
    ("nhl", "hockey/nhl"),
    ("mlb", "baseball/mlb"),
    ("soccer_epl", "soccer/eng.1"),
    ("soccer_mls", "soccer/usa.1"),
]

BASE = "https://site.api.espn.com/apis/site/v2/sports"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Linesmith/1.0)"}


async def _fetch(client: httpx.AsyncClient, path: str) -> dict | None:
    try:
        r = await client.get(f"{BASE}/{path}/injuries", headers=HEADERS, timeout=25.0)
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


_ATHLETE_ID_RE = re.compile(r"/id/(\d+)")


def _athlete_id(athlete: dict) -> str | None:
    """THE ATHLETE OBJECT HAS NO `id` FIELD on this endpoint.

    Measured 2026-09-01: `athlete` carries firstName, lastName, displayName,
    shortName, links, headshot, position, team, notes, status -- and no id. The
    id is only present inside a link href:

        https://www.espn.com/nfl/player/_/id/4686338/josh-minkins

    Reading `athlete["id"]` returns None on every row, which is exactly what the
    first run did: 1,265 injuries captured, athlete_id populated 0.0%. Without
    it these rows cannot join to player_game_history and the table is close to
    useless, so this is parsed rather than skipped.
    """
    for link in athlete.get("links") or []:
        m = _ATHLETE_ID_RE.search(link.get("href") or "")
        if m:
            return m.group(1)
    headshot = (athlete.get("headshot") or {}).get("href") or ""
    m = _ATHLETE_ID_RE.search(headshot)
    return m.group(1) if m else None


def _rows(sport: str, payload: dict | None, day) -> list[dict]:
    """ESPN nests injuries as a list of teams, each with its own injury list."""
    out: list[dict] = []
    for team in (payload or {}).get("injuries", []) or []:
        team_id = str(team.get("id")) if team.get("id") is not None else None
        team_name = team.get("displayName")
        for inj in team.get("injuries", []) or []:
            ath = inj.get("athlete") or {}
            out.append({
                "sport": sport,
                "captured_on": day,
                "team_id": team_id,
                "team_name": team_name,
                "athlete_id": _athlete_id(ath),
                "athlete_name": ath.get("displayName"),
                "status": inj.get("status"),
                "detail": (inj.get("type") or {}).get("description") or inj.get("shortComment"),
                "raw_json": json.dumps(inj, separators=(",", ":")),
            })
    return out


async def run_snapshot() -> dict:
    """One capture for every sport. Returns the summary `_run_timed` expects."""
    pool = await db.get_pool()
    day = datetime.now(timezone.utc).date()
    per_sport: dict[str, int] = {}
    total = 0

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for sport, path in SPORT_PATHS:
            payload = await _fetch(client, path)
            rows = _rows(sport, payload, day)
            per_sport[sport] = len(rows)
            if not rows:
                continue
            async with pool.acquire() as conn:
                await conn.executemany(
                    """
                    INSERT INTO injury_report
                        (sport, captured_on, team_id, team_name, athlete_id,
                         athlete_name, status, detail, raw_json)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
                    ON CONFLICT (sport, captured_on, COALESCE(athlete_id,''), COALESCE(athlete_name,''))
                    DO UPDATE SET status = excluded.status,
                                  detail = excluded.detail,
                                  raw_json = excluded.raw_json
                    """,
                    [
                        (r["sport"], r["captured_on"], r["team_id"], r["team_name"],
                         r["athlete_id"], r["athlete_name"], r["status"], r["detail"], r["raw_json"])
                        for r in rows
                    ],
                )
            total += len(rows)

    return {"injuries_written": total, "per_sport": per_sport, "captured_on": str(day)}
