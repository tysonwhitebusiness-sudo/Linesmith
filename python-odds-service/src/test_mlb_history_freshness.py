"""MLB rows for player_game_history from a StatsAPI boxscore.

    python src/test_mlb_history_freshness.py

`mlb_rows_from_boxscore` keeps MLB's history current after task 4.7's one-time
backfill (found stopped at 2026-08-28). Its rows must be the same shape as the
backfill's gameLog rows; that was measured on 1,076 stored player-games before
this was written. These checks pin the differences that measurement found.

Payload: real boxscore for gamePk 822935 (SD at TB, 2026-08-28), trimmed to four
players and the stat keys the parser reads.
"""
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "src")

from predict.generic_freshness_job import mlb_game_is_final, mlb_rows_from_boxscore  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {name}")
    else:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")
        print(f"  FAIL {name}{': ' + detail if detail else ''}")


BOX = {"teams": {
    "home": {"team": {"id": 139}, "players": {
        "ID663556": {"person": {"id": 663556}, "stats": {"batting": {}, "pitching": {
            "summary": "5.2 IP, 3 ER, 4 K, 2 BB", "gamesStarted": 1, "runs": 4, "doubles": 0, "triples": 0, "homeRuns": 1,
            "strikeOuts": 4, "baseOnBalls": 2, "hits": 3, "hitByPitch": 0, "atBats": 21, "stolenBases": 0,
            "inningsPitched": "5.2", "earnedRuns": 3, "rbi": 4}}},
        "ID670764": {"person": {"id": 670764}, "stats": {"batting": {
            "hits": 2, "atBats": 4, "plateAppearances": 4, "runs": 2, "doubles": 0, "triples": 0, "homeRuns": 0, "rbi": 1,
            "baseOnBalls": 0, "strikeOuts": 1, "totalBases": 2, "stolenBases": 1, "hitByPitch": 0}, "pitching": {}}},
        "ID663743": {"person": {"id": 663743}, "stats": {"batting": {}, "pitching": {}}},
    }},
    "away": {"team": {"id": 135}, "players": {
        "ID650859": {"person": {"id": 650859}, "stats": {"batting": {
            "hits": 0, "atBats": 4, "plateAppearances": 4, "runs": 0, "doubles": 0, "triples": 0, "homeRuns": 0, "rbi": 0,
            "baseOnBalls": 0, "strikeOuts": 0, "totalBases": 0, "stolenBases": 0, "hitByPitch": 0}, "pitching": {}}},
    }},
}}

ROWS = {r.athlete_id: r for r in mlb_rows_from_boxscore(BOX, 822935, "2026-08-28", 2026)}


def test_players_who_did_not_play_have_no_row():
    check("bench player skipped (gameLog listed him with zeros; he never entered)", "663743" not in ROWS)
    check("three rows", len(ROWS) == 3, str(sorted(ROWS)))


def test_pitching_matches_the_gamelog_shape():
    s = ROWS["663556"].stats
    check("no pit_rbi (a pitching gameLog has none)", "pit_rbi" not in s)
    check("pit_totalBases derived: 3 hits + 3 for the home run", s.get("pit_totalBases") == 6.0, str(s.get("pit_totalBases")))
    check("innings pitched kept in MLB's own .1/.2 notation", s.get("pit_inningsPitched") == 5.2)
    check("the summary string is not a stat", not any("summary" in k for k in s))
    check("no batting keys for a pitcher who did not bat", not any(k.startswith("bat_") for k in s))


def test_batting_and_game_fields():
    r = ROWS["670764"]
    check("batting prefixed", r.stats.get("bat_hits") == 2.0 and r.stats.get("bat_stolenBases") == 1.0)
    check("home side", r.team_id == "139" and r.opponent_id == "135" and r.is_home is True)
    a = ROWS["650859"]
    check("away side", a.team_id == "135" and a.opponent_id == "139" and a.is_home is False)
    check("zeros are real values, kept", a.stats.get("bat_hits") == 0.0)
    check("event, date, season", a.event_id == "822935" and a.game_date == "2026-08-28" and a.season == 2026 and a.sport == "mlb")


def test_only_final_games():
    final = {"status": {"abstractGameState": "Final", "detailedState": "Final"}}
    check("Final", mlb_game_is_final(final))
    check("Completed Early is final", mlb_game_is_final({"status": {"abstractGameState": "Final", "detailedState": "Completed Early"}}))
    check("in progress is not", not mlb_game_is_final({"status": {"abstractGameState": "Live", "detailedState": "In Progress"}}))
    check("suspended is not (partial stats would stick)", not mlb_game_is_final({"status": {"abstractGameState": "Final", "detailedState": "Suspended: Rain"}}))
    check("postponed is not", not mlb_game_is_final({"status": {"abstractGameState": "Final", "detailedState": "Postponed"}}))


if __name__ == "__main__":
    for fn in [test_players_who_did_not_play_have_no_row, test_pitching_matches_the_gamelog_shape,
               test_batting_and_game_fields, test_only_final_games]:
        print(f"\n{fn.__name__}")
        fn()
    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("all mlb history freshness tests passed")
