"""P5 — write_splits against the REAL market_splits table (Track V).

Live database: listed in CI's "Not run here, and why". Run:
    python -u src/test_write_splits.py
The same percentages twice -> one row; a change -> two. Fake game; deleted at the end.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from db import SplitInput, get_pool, write_splits

GAME = "test-p5-splits"
_failures = 0


def check(label, actual, expected):
    global _failures
    ok = actual == expected
    _failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f": got {actual!r}, expected {expected!r}"))


def sp(bets, money, at, book="draftkings"):
    return SplitInput(sport="nfl", game_id=GAME, subject_id="", period="fg", market="sp", side="home", line=-3.5,
                      source="dknetwork", book=book, kind="bets_money", pct_bets=bets, pct_money=money,
                      count=None, count_total=None, observed_at=at)


async def main():
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    try:
        check("first split inserts", await write_splits([sp(0.61, 0.44, now - timedelta(minutes=30))]), 1)
        check("same percentages -> no new row", await write_splits([sp(0.61, 0.44, now - timedelta(minutes=15))]), 0)
        check("a change -> a new row", await write_splits([sp(0.63, 0.44, now)]), 1)
        check("another book is its own series", await write_splits([sp(0.63, 0.44, now, book="circa")]), 1)
        n = await pool.fetchval("SELECT count(*) FROM market_splits WHERE game_id = $1", GAME)
        check("three rows in all", n, 3)
        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await pool.execute("DELETE FROM market_splits WHERE game_id = $1", GAME)
    return _failures == 0


if __name__ == "__main__":
    raise SystemExit(0 if asyncio.run(main()) else 1)
