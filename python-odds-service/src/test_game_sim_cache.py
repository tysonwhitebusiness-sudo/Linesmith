"""Verifies game_sim_cache.py's ensure_game_sims / load_game_sim against the
REAL game_sim_cache table in Postgres — not a mock. Same precedent as
test_write_prop_odds.py: an obviously-fake game_pk (999999999) so this row
can never collide with a real game, and deletes it at the end regardless of
pass/fail. Uses real 2026 roster/pitcher data for the actual simulation
(same data any real game would use) — only the game_pk/team ids are fake.
"""
import asyncio

import db
import httpx

from predict import statsapi as sa
from predict.game_sim_cache import GameSimInput, ensure_game_sims, load_game_sim

TEST_GAME_PK = 999999999
_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


async def cleanup():
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM game_sim_cache WHERE sport = 'mlb' AND game_id = $1", str(TEST_GAME_PK))
    print(f"\ncleanup: {result}")


async def main():
    try:
        async with httpx.AsyncClient() as client:
            print("=== load_game_sim: nothing cached yet ===")
            existing = await load_game_sim(TEST_GAME_PK)
            check("no cached row before first run", existing, None)

            home_roster = await sa.get_active_roster(client, 147, 2026)
            away_roster = await sa.get_active_roster(client, 119, 2026)
            home_lineup = [p.id for p in home_roster if p.position != "P"][:9]
            away_lineup = [p.id for p in away_roster if p.position != "P"][:9]
            starters = await sa.get_league_starting_pitcher_stats(client, 2026)
            qualified = [p for p in starters if p.games_started >= 5]
            home_starter_id = qualified[0].person_id
            away_starter_id = next(p.person_id for p in qualified if p.person_id != home_starter_id)

            print("\n=== ensure_game_sims: first run, projected lineup ===")
            inputs = [
                GameSimInput(
                    game_pk=TEST_GAME_PK,
                    season=2026,
                    status="pre",
                    home_lineup=home_lineup,
                    away_lineup=away_lineup,
                    home_lineup_projected=True,
                    away_lineup_projected=False,
                    home_team_id=147,
                    away_team_id=119,
                    home_starter_id=home_starter_id,
                    away_starter_id=away_starter_id,
                    venue_id=3313,
                )
            ]
            await ensure_game_sims(client, inputs)
            cached = await load_game_sim(TEST_GAME_PK)
            check("row cached after first run", cached is not None, True)
            check("lineup_source is projected (one side projected)", cached.lineup_source if cached else None, "projected")
            check("n is 4000", cached.n if cached else None, 4000)
            check("home_win_prob is a real probability", 0 <= (cached.home_win_prob if cached else -1) <= 1, True)
            first_win_prob = cached.home_win_prob if cached else None

            print("\n=== ensure_game_sims: second run, STILL projected -> should NOT re-simulate ===")
            await ensure_game_sims(client, inputs)
            cached2 = await load_game_sim(TEST_GAME_PK)
            check("home_win_prob unchanged (no re-simulation on identical projected inputs)", cached2.home_win_prob if cached2 else None, first_win_prob)

            print("\n=== ensure_game_sims: third run, now POSTED lineup -> should upgrade ===")
            inputs[0].home_lineup_projected = False
            await ensure_game_sims(client, inputs)
            cached3 = await load_game_sim(TEST_GAME_PK)
            check("lineup_source upgraded to posted", cached3.lineup_source if cached3 else None, "posted")

            print("\n=== ensure_game_sims: fourth run, posted again -> should NOT re-simulate (nothing left to improve) ===")
            win_prob_after_upgrade = cached3.home_win_prob if cached3 else None
            await ensure_game_sims(client, inputs)
            cached4 = await load_game_sim(TEST_GAME_PK)
            check("home_win_prob unchanged after already-posted re-run", cached4.home_win_prob if cached4 else None, win_prob_after_upgrade)

            print("\n=== ensure_game_sims: skips non-'pre' status ===")
            inputs[0].status = "live"
            before_status_change = cached4.computed_at if cached4 else None
            await ensure_game_sims(client, inputs)
            cached5 = await load_game_sim(TEST_GAME_PK)
            check("row untouched when status is not 'pre'", cached5.computed_at if cached5 else None, before_status_change)

            print("\n=== ensure_game_sims: skips a lineup short of 9 ===")
            inputs2 = [
                GameSimInput(
                    game_pk=888888888,
                    season=2026,
                    status="pre",
                    home_lineup=home_lineup[:5],
                    away_lineup=away_lineup,
                    home_lineup_projected=True,
                    away_lineup_projected=True,
                    home_team_id=147,
                    away_team_id=119,
                    home_starter_id=home_starter_id,
                    away_starter_id=away_starter_id,
                )
            ]
            await ensure_game_sims(client, inputs2)
            no_row = await load_game_sim(888888888)
            check("no row written for a short lineup", no_row, None)

        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await cleanup()
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
