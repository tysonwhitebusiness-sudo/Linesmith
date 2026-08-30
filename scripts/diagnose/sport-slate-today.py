"""Does this sport have a slate today, and has it already started?

Written for the Phase 6.5 diagnosis and kept because the question recurs:
`health_check.py` reports a job as "healthy — 0 rows written", which is
ambiguous between "the job is broken" and "there was nothing to do". This
answers that in one run, without reading any code.

It settled 6.5: NFL, CFB, NBA and NHL all showed **zero scheduled games today
or tomorrow** — they are between seasons — so their empty `pick_history` was
correct behaviour, not a failure. Soccer showed six games and was producing
normally.

Read-only: it calls the same ESPN scoreboard endpoint the production job uses
and applies the same not-yet-started filter, but writes nothing.

Run from `python-odds-service/`:
    ./.venv/Scripts/python.exe -u ../scripts/diagnose/sport-slate-today.py [sport_key ...]
"""
import asyncio, sys
from datetime import datetime, timezone, timedelta
import httpx

sys.path.insert(0, '.')
import db  # noqa
from predict import generic_team_elo as gte
from predict.generic_pick_capture import fetch_scheduled_games, _has_not_started


async def main():
    keys = sys.argv[1:] or ['cfb', 'soccer_epl', 'soccer_mls', 'nfl', 'nba', 'nhl']
    now = datetime.now(timezone.utc)
    print(f"now = {now.isoformat()}  (UTC)\n")
    async with httpx.AsyncClient() as client:
        for key in keys:
            cfg = gte.SPORT_CONFIGS.get(key)
            if not cfg:
                print(f"{key:12s} NO SPORT CONFIG")
                continue
            # Today and tomorrow in UTC — the job only ever looks at `today`.
            for offset in (0, 1):
                date = (now + timedelta(days=offset)).strftime('%Y%m%d')
                try:
                    games = await fetch_scheduled_games(client, cfg, date)
                except Exception as e:
                    print(f"{key:12s} {date} FETCH FAILED {type(e).__name__}: {e}")
                    continue
                upcoming = [g for g in games if _has_not_started(g.commence_time, now)]
                label = 'today' if offset == 0 else 'tomorrow'
                print(f"{key:12s} {date} ({label:8s}) scheduled={len(games):3d}  not-yet-started={len(upcoming):3d}")
                if games and not upcoming:
                    first = min(g.commence_time for g in games)
                    last = max(g.commence_time for g in games)
                    print(f"{'':12s}   -> ALL STARTED. first={first} last={last}")

asyncio.run(main())
