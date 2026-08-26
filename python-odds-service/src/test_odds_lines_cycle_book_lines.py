"""Pure-function test for predict/odds_lines_cycle.py's
_game_odds_book_line_rows — specifically the 2026-08-26 fix (odds-
architecture rebuild, Phase 2) for a real bug: this function used to key
every row by `line.event_id` (the-odds-api's own event UUID), not the real
MLB game_id every other writer and every real reader actually uses, making
every the-odds-api row in game_odds_book_lines unreachable by any real
query. No DB access needed — this exercises the row-building logic only.
Run with:
    python test_odds_lines_cycle_book_lines.py
"""
from predict.mlb_game_lines import BookmakerOdds, GameLine
from predict.odds_lines_cycle import SnapshotGame, _game_odds_book_line_rows

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def _game(game_pk: str, away: str, home: str) -> SnapshotGame:
    return SnapshotGame(
        game_pk=game_pk,
        home_team_id=1,
        away_team_id=2,
        away_team_name=away,
        home_team_name=home,
        matchup=f"{away} @ {home}",
        first_pitch="2026-08-26T23:05:00Z",
        status="pre",
        game_model=None,
        elo=None,
    )


def test_book_lines_keyed_by_real_game_id_not_event_id():
    print("\n_game_odds_book_line_rows")
    line = GameLine(
        event_id="the-odds-api-uuid-abc123",  # deliberately NOT the real game_pk
        commence_time="2026-08-26T23:05:00Z",
        home_team="New York Yankees",
        away_team="Boston Red Sox",
        bookmakers=[BookmakerOdds(bookmaker="DraftKings", home_odds=1.67, away_odds=2.30)],
    )
    games = [_game("778899", "Boston Red Sox", "New York Yankees")]

    rows = _game_odds_book_line_rows([line], games)
    game_ids = {r.game_id for r in rows}
    check("rows keyed by the real MLB game_pk, not the-odds-api's event UUID", game_ids, {"778899"})
    check("real rows were actually produced (not silently empty)", len(rows) > 0, True)


def test_book_lines_unmatched_line_dropped():
    print("\n_game_odds_book_line_rows (no matching game on the slate)")
    line = GameLine(
        event_id="the-odds-api-uuid-xyz",
        commence_time="2026-08-26T23:05:00Z",
        home_team="Team Not On Slate",
        away_team="Also Not On Slate",
        bookmakers=[BookmakerOdds(bookmaker="DraftKings", home_odds=1.5, away_odds=2.5)],
    )
    games = [_game("778899", "Boston Red Sox", "New York Yankees")]
    rows = _game_odds_book_line_rows([line], games)
    check("a line with no matching real game is skipped, not written under a bogus id", rows, [])


if __name__ == "__main__":
    test_book_lines_keyed_by_real_game_id_not_event_id()
    test_book_lines_unmatched_line_dropped()
    print(f"\n{'FAILED' if _failures else 'ALL PASSED'} ({_failures} failure(s))")
    raise SystemExit(1 if _failures else 0)
