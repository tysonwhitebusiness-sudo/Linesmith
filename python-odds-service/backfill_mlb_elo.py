"""Backfill MLB Elo and pitcher game scores for a date range.

WHY THIS EXISTS. `maintainMlbEloJob` is deliberately TODAY-ONLY
(`get_schedule_range(client, today, today)`, jobs.py) — it mirrors the TS job it
was ported from. That is a reasonable steady-state design and a guaranteed gap
generator: any day the job does not run, or runs and fails, is a day that never
gets rated, and nothing ever goes back for it.

That is not hypothetical. Migration 20260901091000 turned
`team_elo_history.team_id` into text, no Python was updated, and every elo write
raised `DataError: expected str, got int` for two days. The newest mlb row sat
at 2026-09-01 while games kept being played. The write path is fixed; this
recovers the days it lost.

CHRONOLOGICAL ORDER IS LOAD-BEARING. Elo is sequential — each rating reads the
team's previous rating and adjusts it. Replaying 09-02 before 09-01 does not
merely mis-order rows, it computes the wrong numbers, because the second update
would read a rating that had not yet absorbed the first result. So the dates are
walked forward, one at a time, and never concurrently.

SAFE TO RE-RUN. `write_elo_history` is append-only with
`UNIQUE(sport, team_id, season, game_pk)` and `ON CONFLICT DO NOTHING`, so a
date already recorded is a no-op rather than a double-count. Re-running the whole
range is the intended way to use it.

Usage:
    python backfill_mlb_elo.py --from 2026-09-01 --to 2026-09-03
    python backfill_mlb_elo.py --from 2026-09-01            # ...through today
    python backfill_mlb_elo.py --from 2026-09-01 --dry-run  # count, write nothing
"""
import argparse
import asyncio
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import httpx  # noqa: E402


def _dates(start: str, end: str) -> list[str]:
    a = date.fromisoformat(start)
    b = date.fromisoformat(end)
    if b < a:
        raise SystemExit(f"--to ({end}) is before --from ({start})")
    out, d = [], a
    while d <= b:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


async def backfill(start: str, end: str, dry_run: bool) -> int:
    from predict import elo_model
    from predict import statsapi as sa

    total_elo = total_pitcher = total_final = 0
    async with httpx.AsyncClient() as client:
        for day in _dates(start, end):
            season = int(day[:4])
            games = await sa.get_schedule_range(client, day, day)
            finals = [g for g in games if g.abstract_state == "Final"]
            elo_updates = pitcher_attempts = 0

            for g in finals:
                home = g.teams.get("home") or {}
                away = g.teams.get("away") or {}
                home_team_id = (home.get("team") or {}).get("id")
                away_team_id = (away.get("team") or {}).get("id")
                game_date = g.game_date or day
                home_runs, away_runs = home.get("score"), away.get("score")

                # Ties are excluded exactly as the live job excludes them — an
                # Elo update needs a winner, and MLB regular-season ties are
                # vanishingly rare but do exist (suspended/called games).
                if (home_runs is not None and away_runs is not None
                        and home_runs != away_runs and home_team_id and away_team_id):
                    if not dry_run:
                        await elo_model.update_elo_for_finished_game(
                            season, g.game_pk, game_date, home_team_id, away_team_id,
                            home_runs, away_runs)
                    elo_updates += 1

                for side in (home, away):
                    starter = (side.get("probablePitcher") or {}).get("id")
                    team_id = (side.get("team") or {}).get("id")
                    if starter and team_id:
                        if not dry_run:
                            await elo_model.log_pitcher_game_score(
                                client, g.game_pk, season, starter, team_id, game_date)
                        pitcher_attempts += 1

            total_elo += elo_updates
            total_pitcher += pitcher_attempts
            total_final += len(finals)
            print(f"  {day}  {len(games):>3} games, {len(finals):>3} final"
                  f"  -> {elo_updates:>3} elo, {pitcher_attempts:>3} pitcher"
                  f"{'  (dry run)' if dry_run else ''}", flush=True)

    print(f"\n{total_final} final games over the range: "
          f"{total_elo} elo updates, {total_pitcher} pitcher scores"
          f"{' — DRY RUN, nothing written' if dry_run else ''}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", required=True, help="YYYY-MM-DD, inclusive")
    ap.add_argument("--to", dest="end", default=date.today().isoformat(),
                    help="YYYY-MM-DD, inclusive (default: today)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be written, write nothing")
    a = ap.parse_args()
    print(f"MLB elo backfill {a.start} .. {a.end}"
          f"{'  (DRY RUN)' if a.dry_run else ''}\n")
    return asyncio.run(backfill(a.start, a.end, a.dry_run))


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(main())
