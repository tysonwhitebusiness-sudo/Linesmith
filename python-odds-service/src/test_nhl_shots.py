"""Hermetic tests for Phase 6.7's NHL shot ingestion.

Standalone script, no pytest, one CI step — same convention as every other
`test_*.py` here. Run:

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/test_nhl_shots.py

WHAT THESE GUARD. The live path was verified against a real finished game
(2024010006) before any of this was written: 321 plays, 102 of them shots,
coordinates present. What is asserted here is everything that can go wrong
SILENTLY:

- a shooter id read from the wrong field, which drops the shot from every
  player page while the row still lands in the table looking healthy;
- non-shot plays leaking into a shot table, or shot types being dropped;
- a missing coordinate or time becoming 0 instead of None, which puts a pile
  of phantom shots on the centre red line at 0:00 and reads as a real pattern.

The payload below is the REAL shape the API returns, taken from a live
response, with a deliberately mixed set of event types.
"""
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "src")

import nhl_shots as ns  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {name}")
    else:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")
        print(f"  FAIL {name}{': ' + detail if detail else ''}")


PAYLOAD = {
    "plays": [
        # A faceoff — not a shot, and must not appear.
        {"typeDescKey": "faceoff", "sortOrder": 1, "periodDescriptor": {"number": 1},
         "timeInPeriod": "00:00", "details": {"eventOwnerTeamId": 3}},
        # Shot on goal, with a goalie.
        {"typeDescKey": "shot-on-goal", "sortOrder": 12, "periodDescriptor": {"number": 1},
         "timeInPeriod": "04:35",
         "details": {"xCoord": 62, "yCoord": -8, "shootingPlayerId": 8478400,
                     "goalieInNetId": 8471234, "eventOwnerTeamId": 3,
                     "shotType": "wrist", "zoneCode": "O"}},
        # Blocked shot — the real payload carries BOTH shooter and blocker, and
        # reading `blockingPlayerId` as the shooter would credit the wrong player.
        {"typeDescKey": "blocked-shot", "sortOrder": 31, "periodDescriptor": {"number": 2},
         "timeInPeriod": "11:02",
         "details": {"xCoord": -73, "yCoord": 11, "blockingPlayerId": 8478450,
                     "shootingPlayerId": 8482747, "eventOwnerTeamId": 3,
                     "reason": "blocked", "zoneCode": "D"}},
        # Goal, where some payloads name the shooter `scoringPlayerId`.
        {"typeDescKey": "goal", "sortOrder": 44, "periodDescriptor": {"number": 3},
         "timeInPeriod": "19:58",
         "details": {"xCoord": 80, "yCoord": 3, "scoringPlayerId": 8477500,
                     "eventOwnerTeamId": 6, "shotType": "snap", "zoneCode": "O"}},
        # Missed shot with NO coordinates and an unusable clock — both must stay
        # None rather than collapsing to 0.
        {"typeDescKey": "missed-shot", "sortOrder": 51, "periodDescriptor": {"number": 3},
         "timeInPeriod": "--",
         "details": {"shootingPlayerId": 8479000, "eventOwnerTeamId": 6}},
        # A hit — not a shot.
        {"typeDescKey": "hit", "sortOrder": 60, "details": {"eventOwnerTeamId": 3}},
    ]
}


def rows():
    return ns.parse_play_by_play(PAYLOAD, 2024010006, "20242025", "2024-09-22")


def test_only_shot_events_are_kept() -> None:
    out = rows()
    check("four shot events, not six plays", len(out) == 4, f"got {len(out)}")
    kinds = sorted(r.event_type for r in out)
    check(
        "all four shot kinds survive",
        kinds == ["blocked-shot", "goal", "missed-shot", "shot-on-goal"],
        str(kinds),
    )
    check("no faceoff or hit leaked in", all(r.event_type in ns.SHOT_EVENTS for r in out))


def test_shooter_not_blocker() -> None:
    blocked = next(r for r in rows() if r.event_type == "blocked-shot")
    # THE DEFECT THIS PINS: the payload carries blockingPlayerId FIRST in
    # practice, and crediting it would attribute the shot to the defender.
    check("blocked shot credits the shooter", blocked.shooter_id == 8482747, str(blocked.shooter_id))
    check("not the blocker", blocked.shooter_id != 8478450)


def test_goal_shooter_from_scoring_field() -> None:
    goal = next(r for r in rows() if r.event_type == "goal")
    # A goal with no `shootingPlayerId` must still find its shooter, or every
    # goal silently vanishes from the player's own shot map.
    check("goal shooter resolved", goal.shooter_id == 8477500, str(goal.shooter_id))


def test_missing_values_stay_none() -> None:
    missed = next(r for r in rows() if r.event_type == "missed-shot")
    check("absent x stays None", missed.x_coord is None, str(missed.x_coord))
    check("absent y stays None", missed.y_coord is None, str(missed.y_coord))
    # A pile of shots at 0:00 on the centre line reads as a real pattern.
    check("unparseable clock stays None", missed.period_seconds is None, str(missed.period_seconds))
    check("absent goalie stays None", missed.goalie_id is None)


def test_real_values_survive() -> None:
    sog = next(r for r in rows() if r.event_type == "shot-on-goal")
    check("x", sog.x_coord == 62, str(sog.x_coord))
    check("y", sog.y_coord == -8, str(sog.y_coord))
    check("period", sog.period == 1, str(sog.period))
    check("clock 04:35 -> 275s", sog.period_seconds == 275, str(sog.period_seconds))
    check("goalie", sog.goalie_id == 8471234)
    check("shot type", sog.shot_type == "wrist")
    check("zone", sog.zone_code == "O")
    check("team", sog.team_id == 3)
    check("season passed through", sog.season == "20242025")
    check("game id passed through", sog.game_id == 2024010006)


def test_event_idx_is_unique_within_a_game() -> None:
    # The UNIQUE key is (game_id, event_idx). If every row collapsed to 0 —
    # which is what a missing sortOrder would do — a whole game would store
    # exactly one shot and the rest would be silently dropped by ON CONFLICT.
    idxs = [r.event_idx for r in rows()]
    check("event_idx is distinct per play", len(set(idxs)) == len(idxs), str(idxs))
    check("event_idx is not all zero", any(i != 0 for i in idxs), str(idxs))


def test_negative_x_is_preserved() -> None:
    # x's SIGN depends on which end the team attacks and alternates by period.
    # Normalising at ingest would destroy the information needed to correct it;
    # the raw value is stored and the read side normalises.
    blocked = next(r for r in rows() if r.event_type == "blocked-shot")
    check("negative x kept as-is", blocked.x_coord == -73, str(blocked.x_coord))


def test_period_seconds_parsing() -> None:
    check("00:00 is zero, not None", ns._period_seconds("00:00") == 0)
    check("19:58", ns._period_seconds("19:58") == 1198)
    check("None input", ns._period_seconds(None) is None)
    check("garbage", ns._period_seconds("--") is None)
    check("non-numeric", ns._period_seconds("ab:cd") is None)


if __name__ == "__main__":
    for fn in [
        test_only_shot_events_are_kept,
        test_shooter_not_blocker,
        test_goal_shooter_from_scoring_field,
        test_missing_values_stay_none,
        test_real_values_survive,
        test_event_idx_is_unique_within_a_game,
        test_negative_x_is_preserved,
        test_period_seconds_parsing,
    ]:
        print(f"\n{fn.__name__}")
        fn()

    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("all nhl_shots tests passed")
