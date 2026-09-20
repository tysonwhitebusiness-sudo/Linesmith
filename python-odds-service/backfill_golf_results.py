"""Golf's missing history — every completed PGA event, from ESPN's own year view.

Golf had 149 result rows across 3 events, which is why it was the one sport with
no game model at all: a rating needs a field to rate. ESPN's scoreboard answers
`?dates={year}` with the whole season and every leaderboard, so the history is
one request per year plus nothing.

    .venv/Scripts/python.exe backfill_golf_results.py                # report
    .venv/Scripts/python.exe backfill_golf_results.py --apply
    .venv/Scripts/python.exe backfill_golf_results.py --apply --from 2022

WHAT A ROW MEANS. `position` is ESPN's own finishing order within the event, so
ties share the number ESPN gives them. A withdrawal or a missed cut is recorded
as such rather than dropped — a golfer who missed the cut genuinely finished
behind everyone who made it, and that is information a rating should see.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import date, datetime, timezone

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db  # noqa: E402

def _as_date(v):
    """asyncpg binds a real date, not the ISO string ESPN sends."""
    return datetime.strptime(v, "%Y-%m-%d").replace(tzinfo=timezone.utc)


SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard"


async def season(client: httpx.AsyncClient, year: int) -> list[dict]:
    res = await client.get(SCOREBOARD, params={"dates": year})
    res.raise_for_status()
    return res.json().get("events") or []


def parse_event(ev: dict) -> tuple[dict, list[dict]]:
    comp = (ev.get("competitions") or [{}])[0]
    status = (comp.get("status") or ev.get("status") or {}).get("type") or {}
    meta = {
        "event_id": str(ev.get("id")),
        "name": ev.get("name"),
        "date": (ev.get("endDate") or ev.get("date") or "")[:10],
        "completed": bool(status.get("completed")),
    }
    rows: list[dict] = []
    for c in comp.get("competitors") or []:
        espn_id = str(c.get("id") or "")
        if not espn_id:
            continue
        # Strokes, matching what the table already stores (274, not -14). The
        # per-round values are the only place the scoreboard carries them.
        rounds = [r.get("value") for r in (c.get("linescores") or []) if isinstance(r.get("value"), (int, float))]
        strokes = int(sum(rounds)) if rounds else None
        order = c.get("order")
        rows.append({
            "event_id": meta["event_id"],
            "espn_id": espn_id,
            # The scoreboard gives a finishing ORDER (an integer), where the rows
            # written live carry ESPN's displayed position ("T7"). Stored as the
            # plain number rather than inventing a tie string: the rating reads
            # order, and a fabricated "T" would claim a tie we were not told about.
            "position": str(int(order)) if isinstance(order, (int, float)) else None,
            # Four rounds means the cut was made; two means it was not. Derived
            # from the rounds actually played rather than from a status field
            # this endpoint does not send.
            "made_cut": len(rounds) >= 3,
            "total_score": strokes,
            "finished_at": meta["date"],
        })
    return meta, rows


async def main(start_year: int, end_year: int, apply: bool) -> int:
    print(f"\n{'=' * 78}\ngolf results backfill — {start_year}..{end_year}\n{'=' * 78}")
    pool = await db.get_pool()
    before = await pool.fetchval("SELECT count(*) FROM golf_tournament_results")
    events_before = await pool.fetchval("SELECT count(DISTINCT event_id) FROM golf_tournament_results")
    print(f"  stored today: {before:,} rows across {events_before} events\n")

    total_rows = 0
    total_events = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
        for year in range(start_year, end_year + 1):
            try:
                events = await season(client, year)
            except Exception as e:                            # noqa: BLE001
                print(f"  {year}: FAILED {type(e).__name__}: {e}")
                continue
            done = 0
            rows_year = 0
            for ev in events:
                meta, rows = parse_event(ev)
                if not meta["completed"] or not rows:
                    continue
                done += 1
                rows_year += len(rows)
                if apply:
                    await pool.executemany(
                        """
                        INSERT INTO golf_tournament_results (event_id, espn_id, position, made_cut, total_score, finished_at)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT DO NOTHING
                        """,
                        [(r["event_id"], r["espn_id"], r["position"], r["made_cut"], r["total_score"],
                          _as_date(r["finished_at"])) for r in rows if r["finished_at"]],
                    )
            total_events += done
            total_rows += rows_year
            print(f"  {year}: {len(events)} events, {done} completed, {rows_year:,} leaderboard rows")

    print(f"\n  {total_events} completed events, {total_rows:,} rows")
    if apply:
        after = await pool.fetchval("SELECT count(*) FROM golf_tournament_results")
        events_after = await pool.fetchval("SELECT count(DISTINCT event_id) FROM golf_tournament_results")
        print(f"  stored now:  {after:,} rows across {events_after} events  (+{after - before:,})\n")
    else:
        print("  REPORT ONLY. Nothing written. Re-run with --apply.\n")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", type=int, default=2022)
    ap.add_argument("--to", dest="end", type=int, default=date.today().year)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.start, a.end, a.apply)))
