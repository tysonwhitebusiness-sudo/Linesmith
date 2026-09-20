"""Golf's rating is built on a field, and it ranks the people it should.

Golf has no head-to-head game, so the Elo idea is applied to the only contest
there is: each event is its field playing each other, and a player's result is
the share of that field he finished ahead of.

It could not exist at all until 2026-09-20, because golf held 149 result rows
across 3 events. `backfill_golf_results.py` filled 235 events from ESPN's season
view, so there is now something to rate against.

The strongest check here is the last one: the top of the rating has to be the
players a golf follower would name. A rating that ranks the field plausibly and
a rating that is wired up backwards look identical in a unit test.

Run with:  .venv/Scripts/python.exe src/test_golf_elo.py
"""
import asyncio
import sys

from predict import golf_elo as ge

failures: list[str] = []


def ok(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        failures.append(f"{name} {detail}")


print("the two halves of one event")
# Ten players, this one finished 3rd.
positions = list(range(1, 11))
ok("finishing 3rd of 10 beats 7 of the other 9", abs(ge.actual_score(3, positions) - 7 / 9) < 1e-9)
ok("winning beats everyone", abs(ge.actual_score(1, positions) - 1.0) < 1e-9)
ok("finishing last beats nobody", abs(ge.actual_score(10, positions) - 0.0) < 1e-9)
tied = [1, 2, 2, 4]
ok("a tie counts as half", abs(ge.actual_score(2, tied) - ((1 + 0.5) / 3)) < 1e-9,
   f"— got {ge.actual_score(2, tied)}")

ok("an even rating expects to beat half the field",
   abs(ge.expected_score(1500.0, [1500.0] * 9) - 0.5) < 1e-9)
ok("a stronger rating expects more", ge.expected_score(1700.0, [1500.0] * 9) > 0.7)
ok("a weaker rating expects less", ge.expected_score(1300.0, [1500.0] * 9) < 0.3)

print("positions parse the way the table stores them")
ok("'T7' is seventh", ge._position_number("T7") == 7)
ok("'7' is seventh", ge._position_number("7") == 7)
ok("nonsense is nothing", ge._position_number("CUT") is None)


async def live() -> None:
    print("the real rating")
    table = await ge.ratings()
    ok(f"a field of golfers is rated ({len(table):,})", len(table) > 500)
    played = [g for g in table.values() if g.events >= 20]
    ok(f"and many have a real history ({len(played):,} with 20+ events)", len(played) > 100)

    top = sorted(table.values(), key=lambda g: -g.rating)[:10]
    ids = {g.espn_id for g in top}
    # ESPN ids, confirmed against the 2026 leaderboards on 2026-09-20.
    known = {"9478": "Scottie Scheffler", "3470": "Rory McIlroy", "5539": "Tommy Fleetwood",
             "10140": "Xander Schauffele", "5409": "Russell Henley", "5860": "Hideki Matsuyama"}
    hits = ids & set(known)
    ok(f"the top ten contains the players it should ({len(hits)} of six known names)", len(hits) >= 4,
       f"— found {[known[i] for i in hits]}")
    ok("Scheffler is first", top[0].espn_id == "9478", f"— first is {top[0].espn_id}")
    ok("the leader is clear of the pack", top[0].rating - top[1].rating > 30,
       f"— {top[0].rating:.1f} vs {top[1].rating:.1f}")

    print("ranking a field")
    field = [g.espn_id for g in top[:5]] + ["not-a-real-golfer"]
    ranked = await ge.rank_field(field)
    ok("every entrant comes back", len(ranked) == len(field))
    ok("strongest first", ranked[0]["rating"] >= (ranked[1]["rating"] or 0))
    unknown = [r for r in ranked if r["espn_id"] == "not-a-real-golfer"][0]
    ok("an unrated entrant is flagged, not invented", unknown["rating"] is None and unknown["thin"])

    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        sys.exit(1)
    print("all golf rating checks passed")


asyncio.run(live())
