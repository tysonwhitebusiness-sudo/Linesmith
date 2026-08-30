"""Hermetic tests for Phase 6.6's pitch-level Statcast ingestion.

Standalone script, no pytest, one CI step — same convention as every other
`test_*.py` here. Run:

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/test_statcast_pitches.py

WHAT THESE GUARD. The live end-to-end path was verified by running it (4,420
pitches for 2026-08-26, all 14 zones, 8 pitch types, idempotent on re-run).
What is asserted here is everything that can go wrong SILENTLY:

- a positional CSV parser reading the wrong column after Savant reorders one;
- 'null' and '' becoming 0.0 instead of None, which drags every average that
  value lands in;
- `group_by` creeping back into the params, which would collapse the whole
  response to one season-aggregate row per player with no error at all.
"""
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "src")

import statcast_pitches as sp  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {name}")
    else:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")
        print(f"  FAIL {name}{': ' + detail if detail else ''}")


# A real response shape, with the columns in a DELIBERATELY DIFFERENT ORDER
# from Savant's current output — a positional parser passes on the real order
# and fails here, which is the point.
CSV = """batter,pitch_type,game_date,zone,pitcher,description,plate_x,plate_z,estimated_woba_using_speedangle,game_pk,at_bat_number,pitch_number,p_throws,stand,release_speed,launch_speed,launch_angle,events,balls,strikes
642215,FF,2026-08-26,6,666200,called_strike,0.476,2.814,,823096,55,6,L,R,94.1,,,,1,2
545361,SL,2026-08-26,14,666200,hit_into_play,-1.204,1.902,0.712,823096,56,3,L,L,86.3,104.2,18.0,single,0,0
545362,CH,2026-08-26,null,666200,ball,null,null,null,823096,57,1,L,R,null,null,null,null,0,0
"""


def test_parses_by_header_not_position() -> None:
    rows = sp.parse_statcast_csv(CSV)
    check("three rows parsed", len(rows) == 3, f"got {len(rows)}")
    r = rows[0]
    check("game_pk read by name", r.game_pk == 823096, f"got {r.game_pk}")
    check("pitcher read by name", r.pitcher_id == 666200, f"got {r.pitcher_id}")
    check("batter read by name", r.batter_id == 642215, f"got {r.batter_id}")
    check("zone read by name", r.zone == 6, f"got {r.zone}")
    check("pitch_type read by name", r.pitch_type == "FF", f"got {r.pitch_type}")
    check("stand read by name", r.stand == "R", f"got {r.stand}")
    check("season derived from game_date", r.season == 2026, f"got {r.season}")


def test_missing_values_are_none_not_zero() -> None:
    """A zeroed exit velocity is a real number that would drag every average it
    lands in. Savant writes an absent value as BOTH '' and the literal 'null'."""
    rows = sp.parse_statcast_csv(CSV)
    empty = rows[0]
    check("empty estimated_woba -> None", empty.estimated_woba is None, f"got {empty.estimated_woba!r}")
    check("empty launch_speed -> None", empty.launch_speed is None, f"got {empty.launch_speed!r}")
    literal_null = rows[2]
    check("literal 'null' zone -> None", literal_null.zone is None, f"got {literal_null.zone!r}")
    check("literal 'null' plate_x -> None", literal_null.plate_x is None, f"got {literal_null.plate_x!r}")
    check("literal 'null' release_speed -> None", literal_null.release_speed is None, f"got {literal_null.release_speed!r}")
    check("literal 'null' events -> None", literal_null.events is None, f"got {literal_null.events!r}")
    # And a real 0 must survive as 0, not be swallowed as falsy.
    check("real zero balls survives", literal_null.balls == 0, f"got {literal_null.balls!r}")


def test_rows_missing_identity_are_dropped() -> None:
    """A row with no game_pk cannot be deduplicated, so storing it would create
    a duplicate on every re-run of that window."""
    broken = CSV.replace("823096,55,6,L,R", ",55,6,L,R")
    rows = sp.parse_statcast_csv(broken)
    check("row without game_pk dropped", len(rows) == 2, f"got {len(rows)}")


def test_empty_input_is_not_an_error() -> None:
    check("empty string -> []", sp.parse_statcast_csv("") == [])
    check("header only -> []", sp.parse_statcast_csv("game_pk,pitcher\n") == [])


def test_bom_is_stripped() -> None:
    """Savant sometimes sends a UTF-8 BOM, which would otherwise become part of
    the first header's name and make that column unreadable."""
    rows = sp.parse_statcast_csv("﻿" + CSV)
    check("BOM stripped", len(rows) == 3 and rows[0].batter_id == 642215)


def test_group_by_is_never_sent() -> None:
    """THE WHOLE POINT OF THIS MODULE. `group_by=name` is the single parameter
    separating every pitch from one season-aggregate row per player, and
    sending it produces a valid 200 response with no error whatsoever."""
    src = open("src/statcast_pitches.py", encoding="utf-8").read()
    # The params dict literal only -- the docstring above it legitimately names
    # group_by to explain why it is absent, and matching that would make this
    # test fail on its own explanation.
    params_block = src.split("    params = {", 1)[1].split("}", 1)[0]
    check("group_by absent from the request params", "group_by" not in params_block,
          "group_by is back in fetch_range -- the response collapses to season aggregates silently")
    check("type=details still requested", '"type": "details"' in params_block)


def test_windows_cover_a_season_without_gaps_or_overlap() -> None:
    """A gap loses pitches silently; an overlap costs a wasted request and
    relies on the write being idempotent to stay correct."""
    from datetime import date

    w = sp._windows(2024)
    check("windows produced", len(w) > 30, f"got {len(w)}")
    check("starts at season start", w[0][0] == "2024-03-01", f"got {w[0][0]}")
    check("ends at season end", w[-1][1] == "2024-11-30", f"got {w[-1][1]}")
    for (a_start, a_end), (b_start, _) in zip(w, w[1:]):
        end = date.fromisoformat(a_end)
        nxt = date.fromisoformat(b_start)
        if (nxt - end).days != 1:
            check("contiguous windows", False, f"{a_end} -> {b_start} is not contiguous")
            return
    check("contiguous windows", True)

    # A partial current season must stop at `through`, not run to November.
    partial = sp._windows(2026, through=date(2026, 8, 30))
    check("partial season stops at through", partial[-1][1] == "2026-08-30", f"got {partial[-1][1]}")


def test_scope_is_2024_onwards() -> None:
    check("FIRST_SEASON is 2024 per the operator", sp.FIRST_SEASON == 2024, f"got {sp.FIRST_SEASON}")


if __name__ == "__main__":
    for fn in [
        test_parses_by_header_not_position,
        test_missing_values_are_none_not_zero,
        test_rows_missing_identity_are_dropped,
        test_empty_input_is_not_an_error,
        test_bom_is_stripped,
        test_group_by_is_never_sent,
        test_windows_cover_a_season_without_gaps_or_overlap,
        test_scope_is_2024_onwards,
    ]:
        print(f"\n{fn.__name__}")
        fn()

    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("all statcast_pitches tests passed")
