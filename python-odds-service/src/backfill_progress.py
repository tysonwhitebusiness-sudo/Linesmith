"""Read-only progress check for the player_game_history backfill. Run any
time (including after an unplanned restart of
backfill_player_game_history.py) — the database is the authoritative
progress state.

    python src/backfill_progress.py
"""
import asyncio

import db

# Real per-sport row-count estimates from the gameplan's scope table — a
# sanity target, not a hard expectation. "games" is the real distinct-game
# estimate; "rows" the total-line estimate.
ESTIMATES = {
    "nba": (24500, 298000),
    "nhl": (20500, 732000),
    "nfl": (3600, 74000),
    "cfb": (7000, 135000),
    "soccer_epl": (6080, 182000),
    "soccer_mls": (5000, 146000),
}


async def main() -> None:
    rows = await db.player_game_history_progress()
    by_sport: dict[str, list[dict]] = {}
    for r in rows:
        by_sport.setdefault(r["sport"], []).append(r)

    total_games = total_rows = 0
    print(f"{'sport':12s} {'seasons':>8s} {'games':>9s} {'rows':>10s}   last write")
    print("-" * 64)
    for sport in sorted(by_sport):
        srows = by_sport[sport]
        g = sum(x["games_done"] for x in srows)
        rw = sum(x["rows_written"] for x in srows)
        total_games += g
        total_rows += rw
        last = max((x["last_write"] for x in srows if x["last_write"]), default=None)
        print(f"{sport:12s} {len(srows):8d} {g:9d} {rw:10d}   {last}")
        for x in sorted(srows, key=lambda z: z["season"]):
            print(f"    {x['season']:<8d} {x['games_done']:9d} games  {x['rows_written']:10d} rows")
        est = ESTIMATES.get(sport)
        if est:
            print(f"    -> estimate ~{est[0]} games / ~{est[1]} rows  "
                  f"({100*g/est[0]:.0f}% games, {100*rw/est[1]:.0f}% rows)")
    print("-" * 64)
    print(f"{'TOTAL':12s} {'':8s} {total_games:9d} {total_rows:10d}")
    print(f"estimate target ~55,264 games / ~1.57M rows  "
          f"({100*total_games/55264:.0f}% games, {100*total_rows/1_570_000:.0f}% rows)")


if __name__ == "__main__":
    asyncio.run(main())
