"""R12a — MLB's official finals into game_result, as the authoritative source.

WHY. Diffed against StatsAPI (R12a Step 0, 2026-09-19), game_result misses
19-33 regular-season MLB games a season in 2010-2021 and 59-101 in 2022-2024,
and carries 67 spring-training games in 2025. Every other sport matched its
league's schedule game for game. A deep team history built on those rows is
off by a few games a team a season.

WHAT. For each FINISHED season, every final regular-season and postseason game
from StatsAPI's schedule, written with `source = 'mlb_statsapi'` and
`event_ref = 'statsapi:<gamePk>'`. The TypeScript read
(`lib/history/deepHistory.ts`) treats a season that has these rows as settled
by them alone, so the missing games appear, the spring-training rows and any
wrong score from another source drop out, and doubleheaders are exact (each is
its own gamePk). The current season is not written: the pages read it from the
league schedule (R7-C1), and a half-written season would hide the newest games.

SAFE TO RE-RUN. ON CONFLICT DO NOTHING on the table's natural key, which
includes the event_ref, so a second run writes nothing.

Usage (from python-odds-service/):
    python backfill_mlb_statsapi_results.py              # dry run: counts per season
    python backfill_mlb_statsapi_results.py --apply      # write
    python backfill_mlb_statsapi_results.py --apply 2023 # one season
"""
import asyncio
import os
import sys
from datetime import date, datetime

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402

SCHEDULE = "https://statsapi.mlb.com/api/v1/schedule"
FIRST, LAST_FINISHED = 2010, 2025
GAME_TYPES = "R,F,D,L,W"   # regular season, wild card, division, league, World Series
SOURCE = "mlb_statsapi"


def finals(schedule: dict) -> list[dict]:
    rows = []
    for d in schedule.get("dates", []):
        for g in d.get("games", []):
            status = g.get("status", {})
            if status.get("abstractGameState") != "Final" or status.get("detailedState") == "Postponed":
                continue
            home, away = g["teams"]["home"], g["teams"]["away"]
            if home.get("score") is None or away.get("score") is None:
                continue
            rows.append({
                "sport": "mlb",
                "event_ref": f"statsapi:{g['gamePk']}",
                "game_date": date.fromisoformat(g["officialDate"]),
                "event_start": g.get("gameDate"),
                "home_team_id": str(home["team"]["id"]),
                "away_team_id": str(away["team"]["id"]),
                "home_team_raw": home["team"]["name"],
                "away_team_raw": away["team"]["name"],
                "home_score": int(home["score"]),
                "away_score": int(away["score"]),
                "venue": (g.get("venue") or {}).get("name"),
            })
    # A suspended game is listed under both dates, both "Final", with one gamePk
    # (measured: 2 in 2010, 7 in 2023). It is one game: keep the later date, the
    # day it was finished.
    by_pk: dict[str, dict] = {}
    for r in rows:
        prev = by_pk.get(r["event_ref"])
        if prev is None or r["game_date"] > prev["game_date"]:
            by_pk[r["event_ref"]] = r
    return list(by_pk.values())


async def main() -> None:
    apply = "--apply" in sys.argv
    only = [int(a) for a in sys.argv[1:] if a.isdigit()]
    seasons = only or list(range(FIRST, LAST_FINISHED + 1))
    total = 0
    async with httpx.AsyncClient(timeout=30) as client:
        for season in seasons:
            if season > LAST_FINISHED:
                print(f"{season}: skipped — not a finished season")
                continue
            res = await client.get(SCHEDULE, params={"sportId": 1, "season": season, "gameType": GAME_TYPES})
            res.raise_for_status()
            rows = finals(res.json())
            for r in rows:
                if r["event_start"]:
                    r["event_start"] = datetime.fromisoformat(r["event_start"].replace("Z", "+00:00"))
            print(f"{season}: {len(rows)} official finals" + ("" if apply else " (dry run)"))
            if apply:
                await db.upsert_game_results(rows, SOURCE)
            total += len(rows)
    print(f"total {total} rows {'written (existing rows skipped)' if apply else 'would be written'}")


if __name__ == "__main__":
    asyncio.run(main())
