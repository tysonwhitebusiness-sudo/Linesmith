"""Verifies write_prop_odds against the REAL prop_odds / prop_price_history /
prop_odds_pulls tables in Postgres — not a mock, the actual write path every
provider job uses. Uses an obviously-fake provider_id ('test_harness_do_not_use')
and game/subject ids nothing real emits, and deletes everything it wrote at the
end regardless of pass/fail — including the dictionary codes only it created.

Live database: listed in CI's "Not run here, and why" step. Run:
    python -u src/test_write_prop_odds.py

P5 (2026-09-25) added: history in the compact `prop_price_history` (read back
through `price_history`), the two times (D23), `extra`, and pulls/returns.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import price_history as ph
from db import PropOddsInput, get_pool, write_prop_odds

TEST_PROVIDER = "test_harness_do_not_use"
GAME, SUBJECT = "test-game", "test-subject"
_failures = 0
T0 = datetime.now(timezone.utc) - timedelta(minutes=1)


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
    b = await pool.execute(
        f"DELETE FROM {ph.PROP_TABLE} WHERE recorded_at >= $1 "
        "AND source IN (SELECT id FROM odds_sources WHERE provider_id = $2)", T0, TEST_PROVIDER)
    c = await pool.execute("DELETE FROM prop_odds_pulls WHERE provider_id = $1", TEST_PROVIDER)
    await pool.execute("DELETE FROM odds_sources WHERE provider_id = $1", TEST_PROVIDER)
    await pool.execute("DELETE FROM odds_games WHERE game_id = $1", GAME)
    await pool.execute("DELETE FROM odds_subjects WHERE subject_id = $1", SUBJECT)
    ph.CODES.reset()
    print(f"\ncleanup: {a}, history {b}, pulls {c}")


async def current_row(line=1.5):
    pool = await get_pool()
    return await pool.fetchrow(
        "SELECT * FROM prop_odds WHERE provider_id = $1 AND game_id = $2 AND subject_id = $3 "
        "AND market_key = 'hits' AND line IS NOT DISTINCT FROM $4 AND side = 'over' AND bookmaker = 'draftkings'",
        TEST_PROVIDER, GAME, SUBJECT, line)


async def history(line=1.5):
    """The decoded history for the test key, oldest first — through the shared decode."""
    pool = await get_pool()
    rows = await pool.fetch(
        ph.decoded_select(ph.PROP_TABLE, "h.recorded_at >= $1 AND s.provider_id = $2 AND g.game_id = $3 "
                                        "AND m.name = 'hits' AND sd.name = 'over' "
                                        "AND h.line::numeric::float8 IS NOT DISTINCT FROM $4",
                          order="h.observed_at, h.id"),
        T0, TEST_PROVIDER, GAME, line)
    return rows


async def recorded_times(line=1.5):
    pool = await get_pool()
    return await pool.fetch(
        f"SELECT h.observed_at, h.recorded_at FROM {ph.PROP_TABLE} h JOIN odds_sources s ON s.id = h.source "
        "WHERE h.recorded_at >= $1 AND s.provider_id = $2 AND h.line::numeric::float8 IS NOT DISTINCT FROM $3 "
        "ORDER BY h.recorded_at, h.id", T0, TEST_PROVIDER, line)


def make_row(american_odds: int, **kw) -> PropOddsInput:
    r = PropOddsInput(
        provider_id=TEST_PROVIDER, game_id=GAME, subject_id=SUBJECT, subject_name="Test Player",
        market_key="hits", line=1.5, side="over", bookmaker="draftkings", american_odds=american_odds,
        decimal_odds=None, is_delayed=False, delay_seconds=None)
    for k, v in kw.items():
        setattr(r, k, v)
    return r


async def main():
    try:
        print("=== first write (no prior row), no times passed: pre-P5 behaviour ===")
        await write_prop_odds([make_row(-120)])
        row = await current_row()
        check("prop_odds row created", row is not None, True)
        check("american_odds correct", row["american_odds"] if row else None, -120)
        check("history row created (no prior)", len(await history()), 1)
        t = (await recorded_times())[0]
        check("no times passed: history observed_at = recorded_at (the write time)", t["observed_at"], t["recorded_at"])
        check("no times passed: changed_at = fetched_at", row["changed_at"], row["fetched_at"])

        print("\n=== second write, SAME price ===")
        await write_prop_odds([make_row(-120)])
        row2 = await current_row()
        check("history NOT incremented (same price = not a movement)", len(await history()), 1)
        check("fetched_at moves (checked)", row2["fetched_at"] > row["fetched_at"], True)
        check("changed_at does NOT move (since)", row2["changed_at"], row["changed_at"])

        print("\n=== third write, DIFFERENT price ===")
        await write_prop_odds([make_row(-135)])
        row3 = await current_row()
        check("prop_odds updated to new price", row3["american_odds"], -135)
        check("history incremented (real price movement)", len(await history()), 2)
        check("changed_at moves with the price", row3["changed_at"], row3["fetched_at"])

        print("\n=== the source's own times (D23) ===")
        changed = datetime.now(timezone.utc) - timedelta(minutes=40)
        seen = datetime.now(timezone.utc) - timedelta(seconds=20)
        await write_prop_odds([make_row(-150, observed_at=seen, changed_at=changed, extra={"limit": 500})])
        row4 = await current_row()
        h = await history()
        # Ordered by observed_at, a change dated 40 minutes back sorts FIRST: find it by price.
        check("history observed_at = the source's change time",
              [r["observed_at"] for r in h if r["american_odds"] == -150], [changed])
        check("prop_odds fetched_at = the source's checked time", row4["fetched_at"], seen)
        check("prop_odds changed_at = the source's change time", row4["changed_at"], changed)
        check("extra stored", row4["extra"] in ({"limit": 500}, '{"limit": 500}'), True)
        await write_prop_odds([make_row(-150, observed_at=datetime.now(timezone.utc), changed_at=None)])
        check("an unchanged price keeps changed_at", (await current_row())["changed_at"], changed)
        check("a write with no extra keeps the last extra", (await current_row())["extra"] is not None, True)

        print("\n=== a source clock ahead of ours is clamped, never stored in the future ===")
        future = datetime.now(timezone.utc) + timedelta(minutes=5)
        await write_prop_odds([make_row(-160, changed_at=future)])
        t = (await recorded_times())[-1]
        check("observed_at <= recorded_at", t["observed_at"] <= t["recorded_at"], True)

        print("\n=== decoded history reads back every column exactly ===")
        h = [r for r in await history() if r["american_odds"] == -160][0]
        check("decoded row", (h["provider_id"], h["game_id"], h["subject_id"], h["market_key"], h["line"],
                              h["side"], h["bookmaker"], h["american_odds"], h["is_delayed"], h["delay_seconds"]),
              (TEST_PROVIDER, GAME, SUBJECT, "hits", 1.5, "over", "draftkings", -160, False, None))

        print("\n=== R5e + P5: a rung a complete fetch did not return is removed AND recorded as a pull ===")
        pool = await get_pool()

        def rung(line, side="over", book="draftkings", market="hits", odds=-110):
            return make_row(odds, line=line, side=side, bookmaker=book, market_key=market)

        async def rungs(market="hits"):
            rows = await pool.fetch(
                "SELECT line, side, bookmaker FROM prop_odds WHERE provider_id = $1 AND market_key = $2 "
                "ORDER BY line NULLS FIRST, side, bookmaker",
                TEST_PROVIDER, market)
            return [(r["line"], r["side"], r["bookmaker"]) for r in rows]

        async def pulls():
            rows = await pool.fetch(
                "SELECT line, side, last_american_odds, reason, returned_at FROM prop_odds_pulls "
                "WHERE provider_id = $1 AND market_key = 'hits' ORDER BY line, side", TEST_PROVIDER)
            return [(r["line"], r["side"], r["last_american_odds"], r["reason"], r["returned_at"] is not None) for r in rows]

        await write_prop_odds([rung(0.5, odds=-300), rung(1.5), rung(2.5), rung(2.5, "under"), rung(0.5, market="runs")])
        await write_prop_odds([rung(1.5), rung(2.5, "under")], complete_providers={TEST_PROVIDER})
        check("withdrawn rungs gone, returned rungs kept", await rungs(),
              [(1.5, "over", "draftkings"), (2.5, "under", "draftkings")])
        check("a market the fetch did not mention is untouched", await rungs("runs"), [(0.5, "over", "draftkings")])
        check("each withdrawn rung is a complete_fetch pull with its last price", await pulls(),
              [(0.5, "over", -300, "complete_fetch", False), (2.5, "over", -110, "complete_fetch", False)])

        await write_prop_odds([rung(0.5, odds=-280)])
        check("the rung coming back closes its pull", [p[4] for p in await pulls()], [True, False])

        await write_prop_odds([rung(3.5)])
        await write_prop_odds([rung(1.5)])
        check("without complete_providers nothing is removed", len(await rungs()), 4)

        await write_prop_odds([rung(1.5, book="fanduel")], complete_providers={"some_other_provider"})
        check("only the named provider's rows are ever removed", len(await rungs()), 5)

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
