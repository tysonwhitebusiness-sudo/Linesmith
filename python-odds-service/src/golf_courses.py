"""DJ-GOLF — the tournament -> course backfill.

WHAT WAS ACTUALLY WRONG, measured 2026-09-22. `golf_tournament_results` holds
235 events going back to 2022-01-09 and `golf_tournaments` named a course for
**4** of them, which is why golf's "Course history" spotlight could not be
built: there was nothing to group a golfer's past finishes BY.

The plan called this a new data job with a new table and an ownership row. It
needed none of the three:

  * `golf_tournaments` already has `course_name` and `holes_json`;
  * `db.write_golf_tournament` already exists;
  * `ingest_golf_history` already calls it for the LIVE event, which is where
    those four rows came from.

The only gap was history, and the only thing missing was a way to ask ESPN
about an event that is not the current one — `fetch_event_meta`, which the
same leaderboard endpoint answers with `&event=`.

SO THIS IS A BACKFILL THAT BECOMES A NO-OP. It is in `JOB_REGISTRY` rather
than being a one-shot script for two reasons: `health_check` then watches it
for free, and a live event whose leaderboard happened to omit a course still
gets one later without anyone noticing it was missing. Once every event has a
course, each run reads one row and writes nothing.

    # one-off, all of them, from the operator's machine:
    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/golf_courses.py backfill
    ./.venv/Scripts/python.exe -u src/golf_courses.py status
"""
from __future__ import annotations

import asyncio
import json
import sys

import httpx

import db

# Per RUN, not in total. ESPN's golf endpoints are free and public and we do
# not own them, so a run takes a slice and the next run takes the next: 235
# events clear in four scheduled runs without ever asking for 235 things at
# once. The one-off CLI passes its own, larger limit.
BATCH = 60

# Sequential, with a small gap. The other ESPN ingesters in this service do the
# same; nothing here is time-critical enough to justify parallel load on a
# public API.
GAP_SECONDS = 0.25


def _holes_json(course) -> str | None:
    """The same shape `ingest_golf_history` writes, so a backfilled row and a
    live-written one are indistinguishable to every reader."""
    if course is None or not course.holes:
        return None
    return json.dumps(
        [{"number": h.number, "shotsToPar": h.shots_to_par, "totalYards": h.total_yards} for h in course.holes]
    )


async def backfill_courses(client: httpx.AsyncClient, limit: int = BATCH, yield_fn=None) -> dict:
    """Fill the course for up to `limit` events that have none."""
    from predict.golf_espn import fetch_event_meta

    event_ids = await db.golf_events_missing_course(limit)
    if not event_ids:
        with_course, events = await db.golf_course_coverage()
        return {"missing": 0, "written": 0, "unanswered": 0, "coverage": f"{with_course}/{events}"}

    written = 0
    unanswered: list[str] = []
    no_course: list[str] = []
    for i, event_id in enumerate(event_ids):
        if yield_fn is not None:
            await yield_fn()
        meta = await fetch_event_meta(client, event_id)
        if meta is None:
            # ESPN no longer answers for this id. Recorded, not retried: the
            # oldest events here are from 2022 and some will never answer
            # again, and a job that retries them every run is a job that never
            # finishes.
            unanswered.append(event_id)
        elif meta.course is None:
            no_course.append(event_id)
        else:
            await db.write_golf_tournament(
                db.GolfTournamentInput(
                    event_id=meta.event_id,
                    name=meta.name,
                    course_name=meta.course.name,
                    season=meta.season,
                    # Unlike the live path, this feed DOES carry the event's
                    # own date, so these rows get the start date the four
                    # live-written ones lack.
                    start_date=meta.start_date,
                    holes_json=_holes_json(meta.course),
                    field_size=meta.field_size,
                )
            )
            written += 1
        if i + 1 < len(event_ids):
            await asyncio.sleep(GAP_SECONDS)

    with_course, events = await db.golf_course_coverage()
    out = {
        "asked": len(event_ids),
        "written": written,
        "unanswered": len(unanswered),
        "no_course": len(no_course),
        "coverage": f"{with_course}/{events}",
        "covered_pct": round(100 * with_course / events, 1) if events else 0.0,
    }
    if unanswered:
        out["unanswered_ids"] = unanswered[:10]
    if no_course:
        out["no_course_ids"] = no_course[:10]
    return out


async def _cli_backfill(limit: int) -> None:
    async with httpx.AsyncClient() as client:
        remaining = limit
        while remaining > 0:
            took = min(BATCH, remaining)
            result = await backfill_courses(client, took)
            print(json.dumps(result))
            # Nothing written and nothing asked means there is nothing left to
            # do; nothing written but ids asked means every one of them was
            # unanswerable, and asking again would loop on the same ids.
            if result.get("asked", 0) == 0 or result.get("written", 0) == 0:
                break
            remaining -= took


async def _cli_status() -> None:
    with_course, events = await db.golf_course_coverage()
    missing = await db.golf_events_missing_course(5)
    pct = round(100 * with_course / events, 1) if events else 0.0
    print(json.dumps({"with_course": with_course, "events": events, "covered_pct": pct, "next_missing": missing}))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "backfill":
        asyncio.run(_cli_backfill(int(sys.argv[2]) if len(sys.argv) > 2 else 400))
    else:
        asyncio.run(_cli_status())
