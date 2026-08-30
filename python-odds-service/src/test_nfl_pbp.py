"""Hermetic tests for Phase 6.8's nflverse play-by-play ingestion.

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/test_nfl_pbp.py

WHAT THESE GUARD:

- A POSITIONAL PARSER. `play_by_play_{season}.csv` has 372 columns and nflverse
  has reordered its releases before. The header below is DELIBERATELY SHUFFLED
  out of the real order, so anything reading by index fails here and passes on
  the live file — which is the wrong way round for a bug to behave.
- 'NA' and '' becoming 0.0. An `air_yards` of 0 is a real, common value (a pass
  caught at the line), so a missing one defaulting to 0 piles unknowns into a
  legitimate band where they read as a real tendency.
- A negative `air_yards` being clamped. Screens are thrown BEHIND the line and
  that is the distinction a target map exists to show.
- Non-targets being stored: runs, and passes with no receiver (throwaways,
  spikes, sacks recorded as passes).
"""
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "src")

import nfl_pbp as np  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {name}")
    else:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")
        print(f"  FAIL {name}{': ' + detail if detail else ''}")


def row(**kw) -> dict:
    base = {
        "play_type": "pass", "game_id": "2024_01_BAL_KC", "play_id": "55",
        "week": "1", "posteam": "KC",
        "receiver_player_id": "00-0033873", "passer_player_id": "00-0033077",
        "air_yards": "12", "pass_location": "left", "pass_length": "short",
        "yards_after_catch": "4", "complete_pass": "1", "touchdown": "0",
        "interception": "0",
    }
    base.update(kw)
    return base


def test_reads_by_name_not_position() -> None:
    # The real file puts play_id at 0 and game_id at 1. This dict is built from
    # a shuffled header on purpose; `parse_row` never sees an index.
    e = np.parse_row(row(), 2024)
    check("parsed", e is not None)
    check("game_id", e.game_id == "2024_01_BAL_KC", str(e.game_id))
    check("play_id", e.play_id == 55, str(e.play_id))
    check("week", e.week == 1, str(e.week))
    check("team", e.team == "KC", str(e.team))
    check("receiver", e.receiver_id == "00-0033873", str(e.receiver_id))
    check("passer", e.passer_id == "00-0033077")
    check("air yards", e.air_yards == 12.0, str(e.air_yards))
    check("location", e.pass_location == "left")
    check("length", e.pass_length == "short")
    check("complete", e.complete_pass is True)
    check("season passed in", e.season == 2024)


def test_missing_is_none_not_zero() -> None:
    # An air_yards of 0 is a real value — a pass caught at the line. Defaulting
    # a missing one to 0 puts unknowns in a legitimate band.
    e = np.parse_row(row(air_yards="NA", yards_after_catch="", pass_location="NA"), 2024)
    check("NA air yards -> None", e.air_yards is None, str(e.air_yards))
    check("empty YAC -> None", e.yards_after_catch is None, str(e.yards_after_catch))
    check("NA location -> None", e.pass_location is None, str(e.pass_location))
    # ...and a genuine zero survives as zero.
    z = np.parse_row(row(air_yards="0"), 2024)
    check("a real 0 stays 0", z.air_yards == 0.0, str(z.air_yards))


def test_negative_air_yards_survives() -> None:
    # A screen is thrown BEHIND the line. Clamping would move every screen into
    # the same band as a checkdown and erase what the map is for.
    e = np.parse_row(row(air_yards="-3"), 2024)
    check("screen keeps its negative", e.air_yards == -3.0, str(e.air_yards))


def test_non_targets_are_rejected() -> None:
    check("a run is not a target", np.parse_row(row(play_type="run"), 2024) is None)
    # A pass with no receiver is a throwaway, a spike, or a sack recorded as a
    # pass. None of those is a target.
    check("no receiver -> not a target", np.parse_row(row(receiver_player_id="NA"), 2024) is None)
    check("empty receiver -> not a target", np.parse_row(row(receiver_player_id=""), 2024) is None)
    check("no game id -> rejected", np.parse_row(row(game_id="NA"), 2024) is None)
    check("no play id -> rejected", np.parse_row(row(play_id="NA"), 2024) is None)


def test_incompletions_are_kept() -> None:
    # A target map built from completions only measures the quarterback's
    # accuracy, not where the receiver is used.
    e = np.parse_row(row(complete_pass="0", yards_after_catch="NA"), 2024)
    check("incompletion is still a target", e is not None)
    check("recorded as incomplete", e.complete_pass is False)
    check("air yards still present", e.air_yards == 12.0)


def test_booleans_absent_stay_none() -> None:
    e = np.parse_row(row(touchdown="NA", complete_pass="NA"), 2024)
    check("absent touchdown -> None, not False", e.touchdown is None, str(e.touchdown))
    check("absent completion -> None, not False", e.complete_pass is None, str(e.complete_pass))


def test_season_boundary() -> None:
    # NFL seasons are named for the year they START, and start in September.
    check("current_season returns an int", isinstance(np.current_season(), int))


if __name__ == "__main__":
    for fn in [
        test_reads_by_name_not_position,
        test_missing_is_none_not_zero,
        test_negative_air_yards_survives,
        test_non_targets_are_rejected,
        test_incompletions_are_kept,
        test_booleans_absent_stay_none,
        test_season_boundary,
    ]:
        print(f"\n{fn.__name__}")
        fn()

    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("all nfl_pbp tests passed")
