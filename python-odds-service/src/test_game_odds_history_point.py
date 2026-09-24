"""P1 (odds workstream, 2026-09-24): write_game_odds_history logs a line move
at an unchanged price. Before the fix the log-on-change comparison was on
american_odds alone, so -4.5 -110 -> -5.5 -110 was never recorded.

Runs against the REAL game_odds_history table (live DB, not CI -- listed in
CI's "Not run here, and why"). Uses a fake event id nothing real will ever
emit and source 'selftest', and deletes its rows at the start and the end.

    python -u src/test_game_odds_history_point.py
"""
import asyncio

from db import GameOddsHistoryInput, get_pool, write_game_odds_history

EVENT = "test-p1-point-20260924"
SOURCE = "selftest"
_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


async def cleanup() -> None:
    pool = await get_pool()
    r = await pool.execute("DELETE FROM game_odds_history WHERE event_id = $1 AND source = $2", EVENT, SOURCE)
    print(f"cleanup: {r}")


async def rows(market: str) -> list:
    pool = await get_pool()
    return await pool.fetch(
        "SELECT american_odds, point FROM game_odds_history WHERE event_id = $1 AND source = $2 AND market = $3 "
        "ORDER BY observed_at, id", EVENT, SOURCE, market)


def row(market: str, odds: int, point) -> GameOddsHistoryInput:
    return GameOddsHistoryInput(event_id=EVENT, market=market, side="home", bookmaker="draftkings",
                                american_odds=odds, point=point, source=SOURCE)


async def main() -> None:
    await cleanup()
    try:
        await write_game_odds_history([row("spread", -110, -4.5)])
        check("(a) first spread price -> 1 row", len(await rows("spread")), 1)
        await write_game_odds_history([row("spread", -110, -4.5)])
        check("(b) same point, same price -> still 1", len(await rows("spread")), 1)
        await write_game_odds_history([row("spread", -110, -5.5)])
        r = await rows("spread")
        check("(c) line moves at the same price -> 2 rows", len(r), 2)
        check("(c) the second row has point -5.5", r[-1]["point"] if r else None, -5.5)
        await write_game_odds_history([row("spread", -115, -5.5)])
        check("(d) price moves -> 3 rows", len(await rows("spread")), 3)
        await write_game_odds_history([row("moneyline", -140, None)])
        await write_game_odds_history([row("moneyline", -140, None)])
        check("(e) moneyline -140 twice (null point) -> 1 row", len(await rows("moneyline")), 1)
    finally:
        await cleanup()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    if _failures:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
