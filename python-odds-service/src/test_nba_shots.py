"""Hermetic tests for Phase 6.7's NBA shot ingestion.

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/test_nba_shots.py

WHAT THESE GUARD. The live path was verified against a real finished game
(401705663): 195 field-goal attempts, threes averaging 26.6 feet from (25,0)
and twos 12.9, against a real three-point line of 22-23.75 feet. What is
asserted here is what can go wrong SILENTLY:

- ESPN's MISSING-COORDINATE SENTINEL (~-214748340, near INT32_MIN) being read
  as a real location. It is finite and passes every null check. 55 of that
  game's 250 shooting plays carried it, and including them made the mean
  two-point distance 72,623,934 feet;
- free throws counted as field-goal attempts, which would put a quarter of a
  player's shots at an invented spot;
- `scoreValue` used to classify a three, which is 0 on a MISS and would file
  every missed three as a two.
"""
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "src")

import nba_shots as ns  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {name}")
    else:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")
        print(f"  FAIL {name}{': ' + detail if detail else ''}")


PAYLOAD = {
    "plays": [
        # Not a shot.
        {"shootingPlay": False, "sequenceNumber": "1", "type": {"text": "Defensive Rebound"},
         "coordinate": {"x": 25, "y": 5}},
        # Made two.
        {"shootingPlay": True, "sequenceNumber": "12", "scoringPlay": True, "scoreValue": 2,
         "type": {"text": "Driving Layup Shot"}, "period": {"number": 1},
         "coordinate": {"x": 29, "y": 7}, "team": {"id": "13"},
         "participants": [{"athlete": {"id": "4277905"}}]},
        # MISSED three — scoreValue is 0 here, so only the type text says three.
        {"shootingPlay": True, "sequenceNumber": "18", "scoringPlay": False, "scoreValue": 0,
         "type": {"text": "Three Point Jump Shot"}, "period": {"number": 2},
         "coordinate": {"x": 5, "y": 24}, "team": {"id": "13"},
         "participants": [{"athlete": {"id": "4277905"}}]},
        # Free throw — not a field-goal attempt, and carrying the sentinel.
        {"shootingPlay": True, "sequenceNumber": "22", "scoringPlay": True, "scoreValue": 1,
         "type": {"text": "Free Throw - 1 of 2"}, "period": {"number": 2},
         "coordinate": {"x": -214748340, "y": -214748365},
         "participants": [{"athlete": {"id": "4277905"}}]},
        # A real field-goal attempt whose location ESPN did not record.
        {"shootingPlay": True, "sequenceNumber": "31", "scoringPlay": False, "scoreValue": 0,
         "type": {"text": "Jump Shot"}, "period": {"number": 3},
         "coordinate": {"x": -214748340, "y": -214748365}, "team": {"id": "7"},
         "participants": [{"athlete": {"id": "3032977"}}]},
    ]
}


def rows():
    return ns.parse_summary(PAYLOAD, 401705663, 2025, "2025-04-01")


def test_free_throws_are_not_field_goals() -> None:
    out = rows()
    check("three attempts, not four", len(out) == 3, f"got {len(out)}")
    check("no free throw leaked", not any("Free Throw" in (r.shot_type or "") for r in out))
    check("the rebound is not a shot", not any("Rebound" in (r.shot_type or "") for r in out))


def test_sentinel_never_becomes_a_location() -> None:
    # THE DEFECT: -214748340 is finite and passes every null check.
    unlocated = next(r for r in rows() if "Jump Shot" == r.shot_type)
    check("sentinel x -> None", unlocated.x_coord is None, str(unlocated.x_coord))
    check("sentinel y -> None", unlocated.y_coord is None, str(unlocated.y_coord))
    # ...and it is still a real attempt, just an unlocated one.
    check("the attempt is still counted", unlocated.made is False and unlocated.point_value == 2)


def test_a_missed_three_is_still_a_three() -> None:
    # `scoreValue` is 0 on a miss. Classifying from it files every missed three
    # as a two, which quietly inflates a player's two-point volume and deflates
    # their three-point attempts.
    three = next(r for r in rows() if r.x_coord == 5)
    check("missed three classified as 3", three.point_value == 3, str(three.point_value))
    check("and recorded as a miss", three.made is False)


def test_real_values_survive() -> None:
    made = next(r for r in rows() if r.made)
    check("x", made.x_coord == 29.0, str(made.x_coord))
    check("y", made.y_coord == 7.0, str(made.y_coord))
    check("shooter", made.shooter_id == 4277905, str(made.shooter_id))
    check("team", made.team_id == 13, str(made.team_id))
    check("period", made.period == 1)
    check("point value", made.point_value == 2)
    check("season", made.season == 2025)


def test_event_idx_is_distinct() -> None:
    # UNIQUE is (game_id, event_idx). All-zero would store one shot per game and
    # silently drop the rest via ON CONFLICT.
    idxs = [r.event_idx for r in rows()]
    check("distinct", len(set(idxs)) == len(idxs), str(idxs))
    check("not all zero", any(i != 0 for i in idxs), str(idxs))


def test_court_bounds_reject_garbage_but_keep_real_shots() -> None:
    check("a corner-three x is kept", ns._court_coord(2, ns._X_MIN, ns._X_MAX) == 2.0)
    check("behind the baseline is kept", ns._court_coord(-2, ns._Y_MIN, ns._Y_MAX) == -2.0)
    check("the sentinel is rejected", ns._court_coord(-214748340, ns._X_MIN, ns._X_MAX) is None)
    check("a wild positive is rejected", ns._court_coord(999999, ns._X_MIN, ns._X_MAX) is None)
    check("None stays None", ns._court_coord(None, ns._X_MIN, ns._X_MAX) is None)


def test_season_boundary() -> None:
    from datetime import date
    # ESPN calls the 2024-25 season 2025, and it starts in October.
    check("october is next year's season", ns.season_for(date(2024, 10, 22)) == 2025)
    check("april is the same season", ns.season_for(date(2025, 4, 13)) == 2025)


def test_misses_are_worth_what_they_were_worth_on_a_real_game() -> None:
    """R5c. Every miss used to be stored as a two. On a real saved game (OKC vs
    LAL, tests/fixtures/espn/summary-nba.json), makes keep ESPN's value and
    misses beyond the arc (rim at 25, 1) are threes."""
    import json
    import os

    path = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "espn", "summary-nba.json")
    payload = json.load(open(path, encoding="utf-8"))
    rows = ns.parse_summary(payload, 1, 2026, "2026-01-01")
    by_idx = {r.event_idx: r for r in rows}
    makes_ok = misses = missed_threes = 0
    for play in payload["plays"]:
        r = by_idx.get(ns._as_int(play.get("sequenceNumber")))
        if r is None:
            continue
        if r.made:
            makes_ok += r.point_value == play.get("scoreValue")
        else:
            misses += 1
            missed_threes += r.point_value == 3
    check("every make keeps ESPN's value", makes_ok == sum(1 for r in rows if r.made), f"{makes_ok}")
    check("some misses are threes (it used to be none)", 0 < missed_threes < misses, f"{missed_threes} of {misses}")
    check("the stored value agrees with the arc on every placed miss",
          all(r.point_value == (3 if ns.beyond_arc(r.x_coord, r.y_coord) else 2) for r in rows if not r.made and r.x_coord is not None))


def test_an_unplaced_miss_reads_its_text() -> None:
    check("'three point' in the text", ns.shot_value(False, 0, None, None, "X misses 26-foot three point jumper Jump Shot") == 3)
    check("a 25-foot shot is a three", ns.shot_value(False, 0, None, None, "X misses 25-foot pullup jump shot") == 3)
    check("a 16-foot shot is a two", ns.shot_value(False, 0, None, None, "X misses 16-foot jumper") == 2)
    check("a make keeps scoreValue", ns.shot_value(True, 3, 25.0, 5.0, "") == 3)
    check("the corner three is a three", ns.beyond_arc(3.0, 5.0) is True)
    check("a long two at the top is a two", ns.beyond_arc(25.0, 23.5) is False)


if __name__ == "__main__":
    for fn in [
        test_free_throws_are_not_field_goals,
        test_sentinel_never_becomes_a_location,
        test_a_missed_three_is_still_a_three,
        test_real_values_survive,
        test_event_idx_is_distinct,
        test_court_bounds_reject_garbage_but_keep_real_shots,
        test_season_boundary,
        test_misses_are_worth_what_they_were_worth_on_a_real_game,
        test_an_unplaced_miss_reads_its_text,
    ]:
        print(f"\n{fn.__name__}")
        fn()

    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("all nba_shots tests passed")
