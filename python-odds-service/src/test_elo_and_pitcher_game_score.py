"""Verifies write_elo_history / get_current_elo / get_latest_elo_before_season
and write_pitcher_game_score / recent_pitcher_game_scores /
team_baseline_game_score against the REAL team_elo_history /
pitcher_game_score_history tables in Postgres — not a mock, the actual
read/write path elo_model.py uses. Same precedent as
test_write_prop_odds.py: obviously-fake ids (season 1900, team ids
999901/999902, pitcher id 999903, game_pks 999999001+) so these rows can
never collide with real data, real teams (108-158), or a real season — and
deletes everything it wrote at the end regardless of pass/fail.
"""
import asyncio

import db

TEST_SEASON = 1900
TEST_HOME_TEAM = 999901
TEST_AWAY_TEAM = 999902
TEST_PITCHER = 999903
_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def check_close(label: str, actual, expected, tol=1e-9) -> None:
    global _failures
    if actual is not None and abs(actual - expected) <= tol:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected ~{expected!r}")


async def cleanup():
    pool = await db.get_pool()
    a = await pool.execute("DELETE FROM team_elo_history WHERE team_id IN ($1, $2)", TEST_HOME_TEAM, TEST_AWAY_TEAM)
    b = await pool.execute("DELETE FROM pitcher_game_score_history WHERE pitcher_id = $1", TEST_PITCHER)
    print(f"\ncleanup: {a}, {b}")


async def main():
    try:
        print("=== write_elo_history: first write (no prior row) ===")
        rows = [
            db.EloHistoryInput(team_id=TEST_HOME_TEAM, season=TEST_SEASON, game_pk=999999001, game_date="1900-04-01", elo=1520.0, games_played=1, opponent_team_id=TEST_AWAY_TEAM, was_home=True),
            db.EloHistoryInput(team_id=TEST_AWAY_TEAM, season=TEST_SEASON, game_pk=999999001, game_date="1900-04-01", elo=1480.0, games_played=1, opponent_team_id=TEST_HOME_TEAM, was_home=False),
        ]
        written = await db.write_elo_history(rows)
        check("2 rows written on first insert", written, 2)

        cur = await db.get_current_elo(TEST_HOME_TEAM, TEST_SEASON)
        check("get_current_elo found the row", cur is not None, True)
        check_close("get_current_elo elo matches", cur.elo if cur else None, 1520.0)
        check("get_current_elo game_date round-trips as ISO string", cur.game_date if cur else None, "1900-04-01")
        check("get_current_elo was_home True", cur.was_home if cur else None, True)
        check("get_current_elo opponent_team_id", cur.opponent_team_id if cur else None, TEST_AWAY_TEAM)

        print("\n=== write_elo_history: idempotent re-write (ON CONFLICT DO NOTHING) ===")
        written2 = await db.write_elo_history(rows)
        check("re-write of identical rows writes 0 (dedup)", written2, 0)

        print("\n=== write_elo_history: second game, later date ===")
        rows2 = [
            db.EloHistoryInput(team_id=TEST_HOME_TEAM, season=TEST_SEASON, game_pk=999999002, game_date="1900-04-03", elo=1535.0, games_played=2, opponent_team_id=TEST_AWAY_TEAM, was_home=True),
            db.EloHistoryInput(team_id=TEST_AWAY_TEAM, season=TEST_SEASON, game_pk=999999002, game_date="1900-04-03", elo=1465.0, games_played=2, opponent_team_id=TEST_HOME_TEAM, was_home=False),
        ]
        written3 = await db.write_elo_history(rows2)
        check("2 more rows written for the second game", written3, 2)

        cur2 = await db.get_current_elo(TEST_HOME_TEAM, TEST_SEASON)
        check_close("get_current_elo now returns the LATEST game's elo", cur2.elo if cur2 else None, 1535.0)
        check("get_current_elo games_played updated", cur2.games_played if cur2 else None, 2)

        print("\n=== get_latest_elo_before_season ===")
        prior = await db.get_latest_elo_before_season(TEST_HOME_TEAM, TEST_SEASON + 1)
        check("get_latest_elo_before_season found a row from the next season's perspective", prior is not None, True)
        check_close("that row is the test season's final rating (1535)", prior.elo if prior else None, 1535.0)
        none_prior = await db.get_latest_elo_before_season(TEST_HOME_TEAM, TEST_SEASON)
        check("no prior season exists before the test season itself", none_prior, None)

        print("\n=== pitcher_game_score: write_pitcher_game_score ===")
        pg_rows = [
            db.PitcherGameScoreInput(pitcher_id=TEST_PITCHER, team_id=TEST_HOME_TEAM, season=TEST_SEASON, game_pk=999999001, game_date="1900-04-01", game_score=68.0),
        ]
        pg_written = await db.write_pitcher_game_score(pg_rows)
        check("1 pitcher game score row written", pg_written, 1)

        pg_written_dup = await db.write_pitcher_game_score(pg_rows)
        check("re-write of identical pitcher row writes 0 (dedup)", pg_written_dup, 0)

        pg_rows2 = [
            db.PitcherGameScoreInput(pitcher_id=TEST_PITCHER, team_id=TEST_HOME_TEAM, season=TEST_SEASON, game_pk=999999002, game_date="1900-04-08", game_score=54.0),
        ]
        await db.write_pitcher_game_score(pg_rows2)

        recent = await db.recent_pitcher_game_scores(TEST_PITCHER, 5)
        check("recent_pitcher_game_scores returns both starts, most recent first", recent, [54.0, 68.0])

        baseline = await db.team_baseline_game_score(TEST_HOME_TEAM, TEST_SEASON, "1900-04-09")
        check_close("team_baseline_game_score averages both starts", baseline, (68.0 + 54.0) / 2)

        baseline_none = await db.team_baseline_game_score(TEST_HOME_TEAM, TEST_SEASON, "1900-01-01")
        check("team_baseline_game_score returns None with nothing before that date", baseline_none, None)

        print("\n=== elo_model.py integration: update_elo_for_finished_game ===")
        from predict import elo_model

        await elo_model.update_elo_for_finished_game(TEST_SEASON, 999999003, "1900-04-05", TEST_HOME_TEAM, TEST_AWAY_TEAM, 6, 2)
        cur3 = await elo_model.get_current_elo(TEST_HOME_TEAM, TEST_SEASON)
        check("update_elo_for_finished_game advanced games_played to 3", cur3.games_played, 3)
        check("update_elo_for_finished_game home team won -> elo increased vs pre-game 1535", cur3.elo > 1535.0, True)

        print("\n=== elo_model.py integration: pitcher_adjustment ===")
        # TEST_PITCHER is the only pitcher with any game-score rows for
        # TEST_HOME_TEAM, so his own rolling average IS the team baseline —
        # the adjustment collapses to exactly 0 in this fixture.
        adj = await elo_model.pitcher_adjustment(TEST_PITCHER, TEST_HOME_TEAM, TEST_SEASON, "1900-04-09")
        check_close("pitcher_adjustment is 0 (pitcher IS the whole baseline sample)", adj, 0.0)

        adj_no_pitcher = await elo_model.pitcher_adjustment(None, TEST_HOME_TEAM, TEST_SEASON, "1900-04-09")
        check("pitcher_adjustment is 0 with no pitcher_id", adj_no_pitcher, 0)

        adj_unknown_pitcher = await elo_model.pitcher_adjustment(999999999, TEST_HOME_TEAM, TEST_SEASON, "1900-04-09")
        check("pitcher_adjustment is 0 for a pitcher with no starts on record", adj_unknown_pitcher, 0)

        print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    finally:
        await cleanup()
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
