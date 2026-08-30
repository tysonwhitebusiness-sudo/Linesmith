"""One bad row must not cost the whole cycle — the guard added 2026-08-30.

Runs against REAL Postgres, deliberately. The bug this covers was invisible to
every in-process check: `write_game_odds_book_lines` wrapped every row in one
transaction, so a single CHECK-constraint violation aborted the batch and raised
out to the job. `refreshTier1` failed outright on one draftkings row
(`mlb total under point=5.5 odds=-225`, an alternate-scope market landing in the
game-total slot) and wrote none of the ~1,500 others.

A mock connection cannot reproduce that: the abort comes from Postgres' own
transaction semantics, not from Python. So this inserts a real batch containing
a real violating row, against the real constraint, and asserts the survivors
landed.

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/test_book_line_rejection.py
"""

import asyncio

import db
from db import GameOddsBookLineInput

# A game id no real feed will ever emit, so nothing here can collide with or
# overwrite a genuine row. Cleaned up at the end regardless of outcome.
FAKE_GAME = "test-rejection-20260830"


def _row(market: str, side: str, book: str, point, odds: int) -> GameOddsBookLineInput:
    return GameOddsBookLineInput(
        sport="mlb",
        game_id=FAKE_GAME,
        market=market,
        side=side,
        bookmaker=book,
        source="selftest",
        point=point,
        american_odds=odds,
        decimal_odds=None,
    )


async def main() -> None:
    pool = await db.get_pool()
    await pool.execute("DELETE FROM game_odds_book_lines WHERE game_id = $1", FAKE_GAME)

    batch = [
        _row("total", "over", "fanduel", 8.5, -110),
        _row("total", "under", "fanduel", 8.5, -110),
        # The real failing row from the live log. `gobl_point_plausible` bounds
        # MLB totals to [6, 14]; 5.5 is outside it.
        _row("total", "under", "draftkings", 5.5, -225),
        _row("moneyline", "home", "betmgm", None, -140),
        _row("total", "over", "caesars", 9.0, -105),
    ]

    # Before the fix this call RAISED, and nothing at all was written.
    await db.write_game_odds_book_lines(batch)

    rows = await pool.fetch(
        "SELECT market, side, bookmaker, point FROM game_odds_book_lines WHERE game_id = $1 ORDER BY bookmaker, side",
        FAKE_GAME,
    )
    landed = {(r["market"], r["side"], r["bookmaker"]) for r in rows}

    failures = []
    if len(landed) != 4:
        failures.append(f"expected 4 surviving rows, got {len(landed)}: {sorted(landed)}")
    if ("total", "under", "draftkings") in landed:
        failures.append("the implausible row was written — the constraint is not doing its job")
    for expected in [
        ("total", "over", "fanduel"),
        ("total", "under", "fanduel"),
        ("moneyline", "home", "betmgm"),
        ("total", "over", "caesars"),
    ]:
        if expected not in landed:
            failures.append(f"a plausible row was lost with the bad one: {expected}")

    # The guard must also be REACHED. If the constraint were dropped, every row
    # would land and the first assertion above would fail — but a batch with no
    # violating row at all would pass this file while proving nothing, so assert
    # the violation is genuinely still rejected by the database.
    try:
        await pool.execute(
            """INSERT INTO game_odds_book_lines
                 (sport, game_id, market, side, bookmaker, source, point, american_odds, fetched_at)
               VALUES ('mlb', $1, 'total', 'under', 'probe', 'selftest', 5.5, -225, now())""",
            FAKE_GAME,
        )
        failures.append("gobl_point_plausible did not reject 5.5 — this test proves nothing")
        await pool.execute("DELETE FROM game_odds_book_lines WHERE game_id = $1 AND bookmaker = 'probe'", FAKE_GAME)
    except Exception as e:  # noqa: BLE001 — any rejection is the point
        if "gobl_point_plausible" not in str(e):
            failures.append(f"rejected for an unexpected reason: {e}")

    await pool.execute("DELETE FROM game_odds_book_lines WHERE game_id = $1", FAKE_GAME)

    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        raise SystemExit(1)
    print(f"PASS: 1 of {len(batch)} rows rejected, the other 4 landed, constraint still active")


if __name__ == "__main__":
    asyncio.run(main())
