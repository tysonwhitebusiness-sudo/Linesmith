"""M3 — the two rules that make a Specials receipt mean anything.

1. **A frozen ranking never moves.** If a row could still change after its
   sport's first game, tomorrow's "receipts" would be grading a ranking that had
   already seen the results. The freeze lives in the WRITE (`WHERE frozen_at IS
   NULL`), so it holds even if a caller asks twice.

2. **A missing factor is missing, not average.** A batter with no Statcast split
   against the starter's hand is scored on the factors he has. Filling the gap
   with a league average would rank him as if we knew something we do not.

Also checks the scoring itself: percentiles over the day's pool, equal weights,
direction respected.

Run with:  .venv/Scripts/python.exe src/test_slate_rankings.py
"""
import asyncio
import json
import sys
from datetime import date

import db
import slate_rankings as sr

failures: list[str] = []


def ok(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        failures.append(f"{name} {detail}")


def close(name, got, want, tol=1e-9):
    ok(name, abs(got - want) <= tol, f"— got {got}, want {want}")


print("scoring")
F = (sr.Factor("a", "A"), sr.Factor("b", "B"), sr.Factor("c", "C", higher_better=False))
cands = [
    sr.Candidate("1", "Best", "X", "Y", "g", {"a": 10.0, "b": 10.0, "c": 1.0}),
    sr.Candidate("2", "Middle", "X", "Y", "g", {"a": 5.0, "b": 5.0, "c": 5.0}),
    sr.Candidate("3", "Worst", "X", "Y", "g", {"a": 1.0, "b": 1.0, "c": 10.0}),
    sr.Candidate("4", "Partial", "X", "Y", "g", {"a": 10.0, "b": None, "c": None}),
]
sr.score(cands, F)
ok("the best on every factor scores highest", cands[0].values["_score"] > cands[1].values["_score"] > cands[2].values["_score"])
ok("a lower-is-better factor is inverted", cands[0].values["_pct"]["c"] > cands[2].values["_pct"]["c"])
ok("a missing factor is skipped, not imputed", set(cands[3].values["_pct"]) == {"a"},
   f"— percentiles present: {sorted(cands[3].values['_pct'])}")
ok("and the partial player is still scored on what he has", cands[3].values["_score"] is not None)
close("a factor everyone ties on gives everyone the same percentile",
      *(lambda c: (c[0].values["_pct"]["a"], c[1].values["_pct"]["a"]))(
          (lambda cs: (sr.score(cs, (sr.Factor("a", "A"),)), cs)[1])(
              [sr.Candidate("1", "", None, None, None, {"a": 3.0}), sr.Candidate("2", "", None, None, None, {"a": 3.0})])))

print("percentile direction")
ranks = sr.percentile_ranks([1.0, 2.0, 3.0], True)
ok("higher is better ascends", ranks[0] < ranks[1] < ranks[2])
ranks = sr.percentile_ranks([1.0, 2.0, 3.0], False)
ok("lower is better descends", ranks[0] > ranks[1] > ranks[2])
ok("None stays None", sr.percentile_ranks([1.0, None], True)[1] is None)

print("the registry")
ids = [r.id for r in sr.RANKINGS]
ok("every ranking id is unique", len(ids) == len(set(ids)))
ok("every ranking has factors", all(r.factors for r in sr.RANKINGS))
ok("every factor explains itself", all(f.info for r in sr.RANKINGS for f in r.factors),
   f"— missing: {[(r.id, f.key) for r in sr.RANKINGS for f in r.factors if not f.info]}")
ok("every ranking knows how it is graded", all(r.grade_stat in sr._GRADE_SQL for r in sr.RANKINGS))


async def freeze_rules() -> None:
    print("the freeze (against the real table)")
    slate = date(2000, 1, 2)   # a date no slate will ever use
    row = {"sport": "test", "slate_date": slate, "ranking_id": "test-freeze", "subject_id": "s1",
           "rank": 1, "score": 50.0, "subject_name": "First", "team": "A", "opponent": "B",
           "game_id": "g1", "factors": json.dumps({"x": 1})}
    pool = await db.get_pool()
    try:
        await db.write_slate_rankings([row])
        await db.write_slate_rankings([{**row, "score": 60.0, "subject_name": "Second"}])
        got = await pool.fetchrow(
            "SELECT score, subject_name, frozen_at FROM slate_rankings WHERE sport='test' AND slate_date=$1", slate)
        ok("an unfrozen row still updates", float(got["score"]) == 60.0 and got["subject_name"] == "Second")

        n = await db.freeze_slate_rankings("test", slate, ["test-freeze"])
        ok("freezing stamps the row", n == 1)

        await db.write_slate_rankings([{**row, "score": 99.0, "subject_name": "Third"}])
        got = await pool.fetchrow(
            "SELECT score, subject_name, frozen_at FROM slate_rankings WHERE sport='test' AND slate_date=$1", slate)
        ok("a frozen row does NOT move", float(got["score"]) == 60.0 and got["subject_name"] == "Second",
           f"— it became {got['score']} / {got['subject_name']}")
        ok("and it carries its frozen stamp", got["frozen_at"] is not None)

        again = await db.freeze_slate_rankings("test", slate, ["test-freeze"])
        ok("freezing twice changes nothing", again == 0)
    finally:
        await pool.execute("DELETE FROM slate_rankings WHERE sport = 'test' AND slate_date = $1", slate)
        print("  cleanup: test rows removed")


asyncio.run(freeze_rules())

print()
if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)
print("all slate ranking checks passed")
