"""Soccer's simple Elo has three outcomes, and a draw settles.

Re-enabling soccer picks (operator, 2026-09-20) exposed a hole that was
harmless while they were off: `grade_finished_game_picks` SKIPPED any game
whose scores were level, so a quarter of every soccer slate would have sat
ungraded for ever and the record would have been drawn from the decisive
three-quarters alone.

What this holds:
  1. a two-way Elo number splits into three outcomes that sum to 1;
  2. the draw rate is the measured one, per league;
  3. a sport without draws is untouched by any of it;
  4. grading settles a drawn soccer game and still skips a level score in a
     sport where a tie is a push at the book.

Run with:  .venv/Scripts/python.exe src/test_soccer_three_way.py
"""
import asyncio
import sys

from predict import generic_team_elo as gte
from predict.game_pick_lock import _allows_draw

failures: list[str] = []


def ok(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        failures.append(f"{name} {detail}")


def close(name, got, want, tol=1e-9):
    ok(name, abs(got - want) <= tol, f"— got {got}, want {want}")


print("the split")
for sport, rate in (("soccer_epl", 0.2403), ("soccer_mls", 0.2512)):
    p = gte.three_way_from_two(0.62, sport)
    close(f"{sport}: three outcomes sum to 1", p.home_prob + p.draw_prob + p.away_prob, 1.0)
    close(f"{sport}: the draw takes the measured rate", p.draw_prob, rate)
    ok(f"{sport}: the better side still leads", p.home_prob > p.away_prob)

even = gte.three_way_from_two(0.5, "soccer_epl")
close("an even match splits its decisive share evenly", even.home_prob, even.away_prob)
# AND THE PROPERTY THAT SURPRISES PEOPLE: at the measured rate the draw is
# never the single likeliest outcome, not even in a dead-even match — 24% sits
# below the 38% each side takes of the decisive share. A draw would have to be
# above a third of all results to lead, and it is a quarter. So the PICK stays a
# team, while the probability attached to it becomes honest: 0.38, not 0.62.
# The cost is visible and intended: roughly a quarter of soccer picks now lose
# to a draw and are graded as losses rather than skipped.
ok("the draw never leads at the measured rate", even.draw_prob < even.home_prob,
   f"— draw {even.draw_prob:.3f} vs home {even.home_prob:.3f}")
ok("so an even match still picks a side", even.best()[0] in ("home", "away"))
ok("but its probability is the honest one, not the two-way number",
   abs(even.best()[1] - 0.38) < 0.01, f"— {even.best()[1]:.3f}")
ok("a one-sided match picks the favourite", gte.three_way_from_two(0.85, "soccer_epl").best()[0] == "home")

print("sports without draws are untouched")
nfl = gte.three_way_from_two(0.62, "nfl")
close("no draw share", nfl.draw_prob, 0.0)
close("the two-way number is unchanged", nfl.home_prob, 0.62)
ok("allows_draw is per sport", gte.allows_draw("soccer_mls") and not gte.allows_draw("nba"))
ok("grading knows soccer draws", _allows_draw("soccer") and not _allows_draw("nfl"))

print("capture is on for every sport the Elo covers")
from predict.generic_pick_capture import CAPTURE_EXCLUDED, _APP_SPORT_BY_KEY  # noqa: E402

ok("nothing is excluded any more", CAPTURE_EXCLUDED == frozenset(), f"— still excluded: {sorted(CAPTURE_EXCLUDED)}")
ok("both soccer leagues are covered", {"soccer_epl", "soccer_mls"} <= set(_APP_SPORT_BY_KEY))


async def live() -> None:
    print("against a real fixture")
    import db
    import game_context as gc

    games = [g for g in await gc.load_sport_games("soccer_epl") if not g.is_final]
    if not games:
        print("  --  no EPL fixture ahead right now; the split is covered above")
        return
    g = games[0]
    pred = await gte.predict_moneyline("soccer_epl", "soccer", int(g.home_team_id), int(g.away_team_id), 2026, g.game_id)
    if pred.blended_home_prob is None:
        print(f"  --  {g.away_abbr} @ {g.home_abbr}: no rating yet for one side")
        return
    three = gte.three_way_from_two(pred.blended_home_prob, "soccer_epl")
    side, prob = three.best()
    print(f"      {g.away_abbr} @ {g.home_abbr}: home {three.home_prob:.3f} "
          f"draw {three.draw_prob:.3f} away {three.away_prob:.3f} -> picks {side} at {prob:.3f}")
    close("a real fixture also sums to 1", three.home_prob + three.draw_prob + three.away_prob, 1.0)
    ok("and the pick is the likeliest of the three", prob == max(three.home_prob, three.draw_prob, three.away_prob))


asyncio.run(live())

print()
if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)
print("all soccer three-way checks passed")
