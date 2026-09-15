"""Verifies write_prop_odds against the REAL prop_odds/prop_odds_history
tables in Postgres — not a mock, the actual write path a real job would use.
Uses an obviously-fake provider_id ('test_harness_do_not_use') so these rows
can never collide with real provider data, and deletes everything it wrote
at the end regardless of pass/fail, so this leaves no trace in the database.

Not wired into any real job — this is exactly the kind of test the task
asked for: prove the write path works correctly in isolation, before any
later decision to actually call it from a live fetch.
"""
import asyncio

from db import PropOddsInput, get_pool, write_prop_odds

TEST_PROVIDER = "test_harness_do_not_use"
_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


async def cleanup():
    pool = await get_pool()
    a = await pool.execute("DELETE FROM prop_odds WHERE provider_id = $1", TEST_PROVIDER)
    b = await pool.execute("DELETE FROM prop_odds_history WHERE provider_id = $1", TEST_PROVIDER)
    print(f"\ncleanup: {a}, {b}")


async def current_row():
    pool = await get_pool()
    return await pool.fetchrow(
        "SELECT * FROM prop_odds WHERE provider_id = $1 AND game_id = 'test-game' AND subject_id = 'test-subject' "
        "AND market_key = 'hits' AND side = 'over' AND bookmaker = 'draftkings'",
        TEST_PROVIDER,
    )


async def history_count():
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT count(*) AS n FROM prop_odds_history WHERE provider_id = $1 AND game_id = 'test-game' "
        "AND subject_id = 'test-subject' AND market_key = 'hits' AND side = 'over' AND bookmaker = 'draftkings'",
        TEST_PROVIDER,
    )
    return row["n"]


def make_row(american_odds: int) -> PropOddsInput:
    return PropOddsInput(
        provider_id=TEST_PROVIDER,
        game_id="test-game",
        subject_id="test-subject",
        subject_name="Test Player",
        market_key="hits",
        line=1.5,
        side="over",
        bookmaker="draftkings",
        american_odds=american_odds,
        decimal_odds=None,
        is_delayed=False,
        delay_seconds=None,
    )


async def main():
    try:
        print("=== first write (no prior row) ===")
        await write_prop_odds([make_row(-120)])
        row = await current_row()
        check("prop_odds row created", row is not None, True)
        check("american_odds correct", row["american_odds"] if row else None, -120)
        check("history row created (no prior)", await history_count(), 1)

        print("\n=== second write, SAME price ===")
        await write_prop_odds([make_row(-120)])
        check("prop_odds still one row (upsert, not insert)", await current_row() is not None, True)
        check("history NOT incremented (same price = not a movement)", await history_count(), 1)

        print("\n=== third write, DIFFERENT price ===")
        await write_prop_odds([make_row(-135)])
        row = await current_row()
        check("prop_odds updated to new price", row["american_odds"] if row else None, -135)
        check("history incremented (real price movement)", await history_count(), 2)

        print("\n=== R5e: a rung a complete fetch did not return is removed ===")
        pool = await get_pool()

        def rung(line, side="over", book="draftkings", market="hits", odds=-110):
            r = make_row(odds)
            r.line, r.side, r.bookmaker, r.market_key = line, side, book, market
            return r

        async def rungs(market="hits"):
            rows = await pool.fetch(
                "SELECT line, side, bookmaker FROM prop_odds WHERE provider_id = $1 AND market_key = $2 "
                "ORDER BY line NULLS FIRST, side, bookmaker",
                TEST_PROVIDER, market)
            return [(r["line"], r["side"], r["bookmaker"]) for r in rows]

        await write_prop_odds([rung(0.5), rung(1.5), rung(2.5), rung(2.5, "under"), rung(0.5, market="runs")])
        await write_prop_odds([rung(1.5), rung(2.5, "under")], complete_providers={TEST_PROVIDER})
        check("withdrawn rungs gone, returned rungs kept", await rungs(),
              [(1.5, "over", "draftkings"), (2.5, "under", "draftkings")])
        check("a market the fetch did not mention is untouched", await rungs("runs"), [(0.5, "over", "draftkings")])

        await write_prop_odds([rung(3.5)])
        await write_prop_odds([rung(1.5)])
        check("without complete_providers nothing is removed", len(await rungs()), 3)

        await write_prop_odds([rung(1.5, book="fanduel")], complete_providers={"some_other_provider"})
        check("only the named provider's rows are ever removed", len(await rungs()), 4)

        await write_prop_odds([rung(None, market="to-win-a-set"), rung(None, "under", market="to-win-a-set"),
                               rung(None, "other", market="to-win-a-set")])
        await write_prop_odds([rung(None, market="to-win-a-set"), rung(None, "under", market="to-win-a-set")],
                              complete_providers={TEST_PROVIDER})
        check("a categorical market (NULL line) keeps what was returned and drops the rest",
              await rungs("to-win-a-set"), [(None, "over", "draftkings"), (None, "under", "draftkings")])

        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await cleanup()
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
