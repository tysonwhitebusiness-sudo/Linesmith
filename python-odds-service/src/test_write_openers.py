"""P5 — write_openers against the REAL market_openers table (D21).

Live database: listed in CI's "Not run here, and why". Run:
    python -u src/test_write_openers.py
first_seen inserts once; a second first_seen does nothing; vsin_open replaces
first_seen; check_flag is stored. Fake game id; deleted at the end.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from db import OpenerInput, get_pool, write_openers

GAME = "test-p5-openers"
_failures = 0


def check(label, actual, expected):
    global _failures
    ok = actual == expected
    _failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f": got {actual!r}, expected {expected!r}"))


def op(src, odds, book="circa", at=None, flag=False, reason=None):
    return OpenerInput(kind="game", sport="nfl", game_id=GAME, subject_id="", period="fg", market="sp", side="home",
                       bookmaker=book, point=-3.5, american_odds=odds,
                       opened_at=at or datetime.now(timezone.utc), opener_source=src,
                       check_flag=flag, check_reason=reason)


async def main():
    pool = await get_pool()
    try:
        t1 = datetime.now(timezone.utc) - timedelta(days=2)
        check("first_seen inserts", await write_openers([op("first_seen", -110, at=t1)]), 1)
        check("a second first_seen does nothing", await write_openers([op("first_seen", -120)]), 0)
        row = await pool.fetchrow("SELECT american_odds, opener_source FROM market_openers WHERE game_id = $1", GAME)
        check("the first price stands", (row["american_odds"], row["opener_source"]), (-110, "first_seen"))
        check("vsin_open replaces first_seen", await write_openers([op("vsin_open", -105)]), 1)
        row = await pool.fetchrow("SELECT american_odds, opener_source FROM market_openers WHERE game_id = $1", GAME)
        check("VSiN's OPEN row is the opener", (row["american_odds"], row["opener_source"]), (-105, "vsin_open"))
        check("first_seen never replaces vsin_open", await write_openers([op("first_seen", -130)]), 0)
        await write_openers([op("first_seen", 2500, book="wynn", flag=True, reason="implied 0.04 vs median 0.52")])
        row = await pool.fetchrow("SELECT check_flag, check_reason FROM market_openers WHERE game_id = $1 AND bookmaker = 'wynn'", GAME)
        check("check_flag stored, row kept", (row["check_flag"], row["check_reason"]), (True, "implied 0.04 vs median 0.52"))
        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await pool.execute("DELETE FROM market_openers WHERE game_id = $1", GAME)
    return _failures == 0


if __name__ == "__main__":
    raise SystemExit(0 if asyncio.run(main()) else 1)
