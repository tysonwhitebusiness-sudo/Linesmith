"""P5 — write_game_lines / write_game_line_pulls against the REAL tables.

Live database: listed in CI's "Not run here, and why". Run:
    python -u src/test_write_game_lines.py

Fake game `test-p5-gl-<date>` and source `test_harness_do_not_use`; everything
written (game_lines, game_lines_history, game_line_pulls, game_odds_book_lines
and the dictionary codes only this test creates) is deleted at the end.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import price_history as ph
from db import GameLineInput, GameLinePullInput, get_pool, write_game_line_pulls, write_game_lines

SRC = "test_harness_do_not_use"
GAME = f"test-p5-gl-{datetime.now(timezone.utc):%Y%m%d}"
T0 = datetime.now(timezone.utc) - timedelta(minutes=1)
_failures = 0


def check(label, actual, expected):
    global _failures
    ok = actual == expected
    _failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f": got {actual!r}, expected {expected!r}"))


def gl(market, side, point, odds, period="fg", is_main=False, book="draftkings"):
    return GameLineInput(sport="mlb", game_id=GAME, period=period, market=market, side=side, point=point,
                         is_main=is_main, bookmaker=book, source=SRC, american_odds=odds)


async def current(pool):
    rows = await pool.fetch("SELECT period, market, side, point, is_main, american_odds FROM game_lines "
                            "WHERE game_id = $1 ORDER BY period, market, side, point NULLS FIRST", GAME)
    return [tuple(r) for r in rows]


async def history(pool):
    rows = await pool.fetch(ph.decoded_select(ph.GAME_TABLE, "h.recorded_at >= $1 AND g.game_id = $2",
                                              order="h.recorded_at, pr.name, m.name, sd.name, h.point"), T0, GAME)
    return [(r["period"], r["market"], r["side"], r["point"], r["is_main"], r["american_odds"]) for r in rows]


async def cleanup(pool):
    await pool.execute("DELETE FROM game_lines WHERE game_id = $1", GAME)
    await pool.execute("DELETE FROM game_line_pulls WHERE game_id = $1", GAME)
    await pool.execute("DELETE FROM game_odds_book_lines WHERE game_id = $1", GAME)
    await pool.execute(f"DELETE FROM {ph.GAME_TABLE} WHERE recorded_at >= $1 "
                       "AND game = (SELECT id FROM odds_games WHERE game_id = $2)", T0, GAME)
    await pool.execute("DELETE FROM odds_games WHERE game_id = $1", GAME)
    await pool.execute("DELETE FROM odds_sources WHERE provider_id = $1", SRC)
    ph.CODES.reset()


async def main():
    pool = await get_pool()
    try:
        print("=== alternates coexist; 1h and fg are separate keys ===")
        await write_game_lines([
            gl("sp", "home", -3.5, 150), gl("sp", "home", -4.5, 105, is_main=True), gl("sp", "home", -5.5, -120),
            gl("sp", "away", 4.5, -125, is_main=True),
            gl("sp", "home", -4.5, 110, period="1h", is_main=True),
            gl("ml", "home", None, -140, is_main=True), gl("ml", "away", None, 120, is_main=True),
            gl("tot", "over", 8.5, -110, is_main=True), gl("tot", "under", 8.5, -110, is_main=True),
        ])
        cur = await current(pool)
        check("three home spread rungs coexist",
              [c for c in cur if c[0] == "fg" and c[1] == "sp" and c[2] == "home"],
              [("fg", "sp", "home", -5.5, False, -120), ("fg", "sp", "home", -4.5, True, 105),
               ("fg", "sp", "home", -3.5, False, 150)])
        check("1h is its own key", [c for c in cur if c[0] == "1h"], [("1h", "sp", "home", -4.5, True, 110)])
        check("every first write is a history row", len(await history(pool)), 9)

        print("\n=== FG main ml/sp/tot mirror into game_odds_book_lines ===")
        mirror = await pool.fetch("SELECT market, side, point, american_odds FROM game_odds_book_lines "
                                  "WHERE game_id = $1 AND source = $2 ORDER BY market, side", GAME, SRC)
        check("mirrored rows", [tuple(r) for r in mirror],
              [("moneyline", "away", None, 120), ("moneyline", "home", None, -140),
               ("spread", "away", 4.5, -125), ("spread", "home", -4.5, 105),
               ("total", "over", 8.5, -110), ("total", "under", 8.5, -110)])

        print("\n=== main line moves -4.5 -> -5.5 with prices unchanged: history logs it ===")
        n0 = len(await history(pool))
        await write_game_lines([gl("sp", "home", -4.5, 105, is_main=False), gl("sp", "home", -5.5, -120, is_main=True)])
        h = await history(pool)
        check("two history rows for the flag change", h[n0:],
              [("fg", "sp", "home", -5.5, True, -120), ("fg", "sp", "home", -4.5, False, 105)])
        await write_game_lines([gl("sp", "home", -4.5, 105, is_main=False)])
        check("no change -> no history row", len(await history(pool)), n0 + 2)

        print("\n=== the sanity constraint rejects -50 without sinking the batch ===")
        await write_game_lines([gl("tot", "over", 9.5, -50), gl("tot", "over", 7.5, -150)])
        cur = await current(pool)
        check("-50 rejected", any(c[3] == 9.5 for c in cur if c[1] == "tot"), False)
        check("its neighbour landed", any(c[3] == 7.5 for c in cur if c[1] == "tot"), True)
        check("no history for the rejected row", any(r[3] == 9.5 for r in await history(pool)), False)

        print("\n=== complete_sources: an unreturned rung becomes a pull; its return closes it ===")
        await write_game_lines([gl("sp", "home", -4.5, 105), gl("sp", "home", -5.5, -120, is_main=True),
                                gl("sp", "away", 4.5, -125, is_main=True)], complete_sources=frozenset({SRC}))
        cur = await current(pool)
        check("-3.5 removed from game_lines", any(c[1] == "sp" and c[3] == -3.5 for c in cur if c[0] == "fg"), False)
        check("other markets untouched", sum(1 for c in cur if c[1] in ("ml", "tot")), 5)
        pulls = await pool.fetch("SELECT point, last_american_odds, reason, returned_at FROM game_line_pulls "
                                 "WHERE game_id = $1", GAME)
        check("one complete_fetch pull with the last price",
              [(p["point"], p["last_american_odds"], p["reason"], p["returned_at"]) for p in pulls],
              [(-3.5, 150, "complete_fetch", None)])
        await write_game_lines([gl("sp", "home", -3.5, 160)])
        ret = await pool.fetchval("SELECT returned_at FROM game_line_pulls WHERE game_id = $1", GAME)
        check("the return closes the pull", ret is not None, True)

        print("\n=== write_game_line_pulls: an explicit pull deletes and records ===")
        n = await write_game_line_pulls([GameLinePullInput(
            sport="mlb", game_id=GAME, period="1h", market="sp", side="home", point=-4.5, bookmaker="draftkings",
            source=SRC, pulled_at=datetime.now(timezone.utc), reason="line")])
        check("one pull written", n, 1)
        check("the 1h row is gone", [c for c in await current(pool) if c[0] == "1h"], [])
        n = await write_game_line_pulls([GameLinePullInput(
            sport="mlb", game_id=GAME, period="1h", market="sp", side="home", point=-4.5, bookmaker="draftkings",
            source=SRC, pulled_at=datetime.now(timezone.utc), reason="line")])
        check("an already-open pull is not pulled twice", n, 0)

        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await cleanup(pool)
    return _failures == 0


if __name__ == "__main__":
    raise SystemExit(0 if asyncio.run(main()) else 1)
