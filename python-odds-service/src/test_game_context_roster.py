"""Verifies roster parsing against the REAL, already-populated Postgres
snapshots (mlb:snapshot, odds-context:{nfl,cfb,soccer_epl}) — no provider
API calls involved, just a DB read, so this is safe to run regardless of
what state SportsGameOdds/Odds-API.io's rate limits are in.

Not a permanent CI-style suite (real snapshot content varies day to day —
today's slate, today's rosters) — a one-off sanity check that the parsing
logic in game_context.py actually produces non-trivial, correctly-shaped
roster data against real data, not just synthetic fixtures.
"""
import asyncio

from game_context import load_mlb_games, load_sport_games


async def main():
    mlb_games = await load_mlb_games()
    print(f"MLB: {len(mlb_games)} games")
    with_roster = [g for g in mlb_games if g.roster]
    print(f"  {len(with_roster)}/{len(mlb_games)} games have a non-empty roster")
    if with_roster:
        sample = with_roster[0]
        print(f"  sample: {sample.away_abbr} @ {sample.home_abbr}, {len(sample.roster)} roster entries")
        for r in sample.roster[:3]:
            print(f"    - {r.subject_name} ({r.team_abbr}) [{r.subject_id}]")
    else:
        print("  WARNING: no MLB game had any roster entries — either no live slate right now, or a real parsing gap")

    for sport in ("nfl", "cfb", "soccer_epl"):
        games = await load_sport_games(sport)
        with_roster = [g for g in games if g.roster]
        print(f"\n{sport}: {len(games)} games, {len(with_roster)} with a non-empty roster")
        if with_roster:
            sample = with_roster[0]
            print(f"  sample: {sample.away_abbr} @ {sample.home_abbr}, {len(sample.roster)} roster entries")
            for r in sample.roster[:3]:
                print(f"    - {r.subject_name} ({r.team_abbr}) [{r.subject_id}]")


if __name__ == "__main__":
    asyncio.run(main())
