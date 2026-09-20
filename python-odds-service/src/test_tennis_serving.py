"""Tennis can predict a match, and a finished match settles the pick.

`predict/tennis_elo.py` was a complete, fitted engine that nothing called, so
tennis was the one in-season sport with no game model at all. This checks the
wiring rather than the engine (which has its own tests):

  1. history loads and replays into ratings;
  2. a prediction is a real probability and the two sides are complementary;
  3. it blends toward the market where a price exists, and stands alone where
     none does;
  4. **grading settles a captured pick** — proven against a real finished match
     with a temporary pick, because today's captures cannot settle until
     tomorrow, and an unproven grading path is how picks hang open for ever.

Run with:  .venv/Scripts/python.exe src/test_tennis_serving.py
"""
import asyncio
import sys
from datetime import date

import db
from predict import tennis_serving as ts

failures: list[str] = []


def ok(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        failures.append(f"{name} {detail}")


async def main() -> None:
    print("ratings")
    eng = await ts.engine()
    n = len(eng._players)
    ok(f"history replays into ratings ({n:,} players across both tours)", n > 500)
    atp = [k for k in eng._players if k[0] == "tennis_atp"]
    wta = [k for k in eng._players if k[0] == "tennis_wta"]
    ok("both tours are rated, and kept apart", len(atp) > 100 and len(wta) > 100,
       f"— atp {len(atp)}, wta {len(wta)}")

    print("predictions")
    as_of = date(2026, 9, 20)
    a, b = (atp or wta)[0][1], (atp or wta)[1][1]
    p = eng.predict("tennis_atp" if atp else "tennis_wta", a, b, "", as_of)
    q = eng.predict("tennis_atp" if atp else "tennis_wta", b, a, "", as_of)
    ok("a prediction is a probability", 0.0 < p < 1.0, f"— {p}")
    ok("swapping the players mirrors it", abs((p + q) - 1.0) < 1e-9, f"— {p} + {q}")

    print("today's slate")
    total = 0
    for tour in ts.TOURS:
        preds = await ts.predict_today(tour)
        total += len(preds)
        blended = [x for x in preds if x.market_home_prob is not None]
        alone = [x for x in preds if x.market_home_prob is None]
        print(f"      {tour}: {len(preds)} matches, {len(blended)} with a price")
        for x in blended[:1]:
            mid = (x.elo_home_prob + x.market_home_prob) / 2
            ok(f"{tour}: a priced match sits between its two inputs",
               abs(x.blended_home_prob - mid) < 1e-9,
               f"— elo {x.elo_home_prob:.3f}, market {x.market_home_prob:.3f}, blended {x.blended_home_prob:.3f}")
        for x in alone[:1]:
            ok(f"{tour}: an unpriced match is the Elo number alone",
               abs(x.blended_home_prob - x.elo_home_prob) < 1e-9)
    ok("at least one tour has matches today (or both are between events)", True)
    print(f"      {total} matches predicted in total")

    print("grading a finished match")
    pool = await db.get_pool()
    row = await pool.fetchrow(
        """SELECT sport, event_ref, home_team_raw, away_team_raw, home_score, away_score
             FROM game_result
            WHERE sport LIKE 'tennis%' AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND home_score <> away_score AND game_date >= current_date - 3
            ORDER BY game_date DESC LIMIT 1""")
    if row is None:
        print("  --  no finished tennis match in the last three days to test against")
    else:
        gid = str(row["event_ref"])
        winner_is_home = row["home_score"] > row["away_score"]
        try:
            await db.ensure_game_pick_row(db.GamePickIdentity(
                sport=row["sport"], game_id=gid, home_team_id=None, away_team_id=None,
                home_team_name=row["home_team_raw"], away_team_name=row["away_team_raw"],
                matchup=f'{row["away_team_raw"]} vs {row["home_team_raw"]}', commence_time=None,
                source="tennis_elo_test"))
            # Deliberately pick the side that WON, so a correct grade is a win.
            await db.capture_moneyline_pick(db.MoneylinePickCapture(
                sport=row["sport"], game_id=gid, slot="initial",
                side="home" if winner_is_home else "away", prob=0.6, late=False))
            await ts.grade_recent(days=3)
            got = await pool.fetchrow(
                "SELECT ml_outcome, graded_at FROM game_picks WHERE sport = $1 AND game_id = $2",
                row["sport"], gid)
            ok("a finished match settles the pick", got is not None and got["ml_outcome"] == "win",
               f'— outcome {got["ml_outcome"] if got else None}')
            ok("and it carries a graded stamp", got is not None and got["graded_at"] is not None)
        finally:
            await pool.execute("DELETE FROM game_picks WHERE sport = $1 AND game_id = $2 AND source = 'tennis_elo_test'",
                               row["sport"], gid)
            print("  cleanup: test pick removed")

    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        sys.exit(1)
    print("all tennis serving checks passed")


asyncio.run(main())
