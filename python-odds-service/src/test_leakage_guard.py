"""Task 2.2 / finding P3 H4 — the two leakage guards.

Standalone script, not pytest, matching every other test_*.py here:
    python -u src/test_leakage_guard.py
No database and no network: both guards are pure functions over plain
data, which is most of the reason they were worth extracting at all.
"""
import sys
from datetime import datetime, timedelta, timezone

from predict.generic_pick_capture import _has_not_started, _is_final_capture_due
from predict.generic_player_gamelog import PlayerGameStat
from predict.generic_prop_production import _RosterPlayer, _without_game

FAILURES: list[str] = []


def check(name: str, got, want) -> None:
    if got != want:
        FAILURES.append(f"{name}: got {got!r}, want {want!r}")
        print(f"FAIL  {name}: got {got!r}, want {want!r}")
    else:
        print(f"PASS  {name}")


NOW = datetime(2026, 8, 28, 18, 0, 0, tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# --- guard 1: the start filter ------------------------------------------
check("upcoming game is predictable", _has_not_started(iso(NOW + timedelta(hours=3)), NOW), True)
check("game one minute away is predictable", _has_not_started(iso(NOW + timedelta(minutes=1)), NOW), True)
check("game starting exactly now is NOT", _has_not_started(iso(NOW), NOW), False)
check("in-progress game is NOT", _has_not_started(iso(NOW - timedelta(hours=1)), NOW), False)
check("finished game is NOT", _has_not_started(iso(NOW - timedelta(hours=6)), NOW), False)

# Fails closed. This is the property that matters: an unknown start time
# must skip the game, never predict it.
check("empty commence_time fails closed", _has_not_started("", NOW), False)
check("garbage commence_time fails closed", _has_not_started("not-a-date", NOW), False)
check("offset form parses", _has_not_started("2026-08-28T21:00:00+00:00", NOW), True)

# Sanity: the sibling window function still works after sharing the parser.
check("_is_final_capture_due true inside window", _is_final_capture_due(iso(NOW + timedelta(hours=1)), NOW), True)
check("_is_final_capture_due false outside window", _is_final_capture_due(iso(NOW + timedelta(hours=9)), NOW), False)


# --- guard 2: the predicted game is stripped from history ----------------
def stat(event_id) -> PlayerGameStat:
    return PlayerGameStat(event_id=event_id, game_date="2026-08-20", opponent_id=1, is_home=True, stats={"points": 10.0})


roster = [
    _RosterPlayer(athlete_id="a1", name="A", position_abbr="G", games=[stat("100"), stat("200"), stat("300")]),
    _RosterPlayer(athlete_id="a2", name="B", position_abbr="F", games=[stat("100"), stat("200")]),
]

stripped = _without_game(roster, "200")
check("predicted game removed for player 1", [g.event_id for g in stripped[0].games], ["100", "300"])
check("predicted game removed for player 2", [g.event_id for g in stripped[1].games], ["100"])
check("input roster not mutated", [g.event_id for g in roster[0].games], ["100", "200", "300"])

untouched = _without_game(roster, "999")
check("absent game leaves history intact", [g.event_id for g in untouched[0].games], ["100", "200", "300"])
check("absent game returns the same objects", untouched[0] is roster[0], True)

# ESPN event ids arrive as str from the API and as whatever the DB
# round-trip produces. The comparison must survive that.
mixed = [_RosterPlayer(athlete_id="a3", name="C", position_abbr=None, games=[stat(401), stat("402")])]
check("int/str event id mismatch still matches", [g.event_id for g in _without_game(mixed, "401")[0].games], ["402"])

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURE(S)")
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("all leakage-guard checks passed")
