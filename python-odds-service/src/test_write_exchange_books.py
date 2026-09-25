"""P5 — write_exchange_books and write_game_reference against the REAL tables.

Live database: listed in CI's "Not run here, and why". Run:
    python -u src/test_write_exchange_books.py
One row per contract with the ladder stored as jsonb; game_reference keeps the
latest observation and never lets an older one overwrite it. Fake ids; deleted
at the end.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

from db import ExchangeBookInput, GameReferenceInput, get_pool, write_exchange_books, write_game_reference

GAME = "test-p5-exchange"
_failures = 0


def check(label, actual, expected):
    global _failures
    ok = actual == expected
    _failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f": got {actual!r}, expected {expected!r}"))


def eb(bid, ask, ladder):
    now = datetime.now(timezone.utc)
    return ExchangeBookInput(exchange="kalshi", contract_id="TEST-P5-CONTRACT", sport="nfl", game_id=GAME,
                             subject_id="", period="fg", market="ml", side="home", point=None, best_bid=bid,
                             best_ask=ask, bid_size=100, ask_size=80, volume_24h=None, open_interest=None,
                             liquidity=None, ladder=ladder, changed_at=now, fetched_at=now)


async def main():
    pool = await get_pool()
    try:
        await write_exchange_books([eb(0.55, 0.57, {"bids": [[0.55, 100]], "asks": [[0.57, 80]]})])
        await write_exchange_books([eb(0.56, 0.58, {"bids": [[0.56, 120], [0.55, 40]], "asks": [[0.58, 90]]})])
        rows = await pool.fetch("SELECT best_bid, ladder FROM exchange_books WHERE contract_id = 'TEST-P5-CONTRACT'")
        check("one row per contract", len(rows), 1)
        check("latest book kept", rows[0]["best_bid"], 0.56)
        ladder = rows[0]["ladder"]
        ladder = json.loads(ladder) if isinstance(ladder, str) else ladder
        check("ladder stored as jsonb", ladder["bids"], [[0.56, 120], [0.55, 40]])

        t = datetime.now(timezone.utc)
        ref = lambda v, at: GameReferenceInput(sport="nfl", game_id=GAME, source="vsin", kind="power_rating",
                                               subject="KC", data={"rating": v}, observed_at=at)
        await write_game_reference([ref(7.5, t)])
        await write_game_reference([ref(6.0, t - timedelta(hours=1))])
        data = await pool.fetchval("SELECT data FROM game_reference WHERE game_id = $1", GAME)
        data = json.loads(data) if isinstance(data, str) else data
        check("an older observation never overwrites a newer one", data, {"rating": 7.5})
        await write_game_reference([ref(8.0, t + timedelta(minutes=5))])
        data = await pool.fetchval("SELECT data FROM game_reference WHERE game_id = $1", GAME)
        data = json.loads(data) if isinstance(data, str) else data
        check("a newer one does", data, {"rating": 8.0})
        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await pool.execute("DELETE FROM exchange_books WHERE contract_id = 'TEST-P5-CONTRACT'")
        await pool.execute("DELETE FROM game_reference WHERE game_id = $1", GAME)
    return _failures == 0


if __name__ == "__main__":
    raise SystemExit(0 if asyncio.run(main()) else 1)
