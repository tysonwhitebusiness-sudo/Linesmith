"""Pure-function tests for the 2026-08-26 MLB source-of-truth flip (odds-
architecture rebuild, Phase 2): SharpAPI's recovered game-lines board
becomes MLB's PRIMARY game-lines source, with the-odds-api demoted to a
per-game fallback (matching every other sport's real pattern, instead of
MLB depending on a single paid, credit-limited API as its sole foundation).
Covers mlb_game_lines.game_lines_from_book_lines (aggregating raw
game_odds_book_lines rows into real GameLines) and
odds_lines_cycle._primary_mlb_lines (the per-game SharpAPI-preferred,
the-odds-api-fallback merge). No DB access needed — both are pure
functions. Run with:
    python test_mlb_source_flip.py
"""
from db import GameOddsBookLineRow
from predict.mlb_game_lines import BookmakerOdds, GameLine, game_lines_from_book_lines
from predict.odds_lines_cycle import SnapshotGame, _primary_mlb_lines

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def _row(game_id, market, side, bookmaker, american_odds, point=None, source="sharpapi") -> GameOddsBookLineRow:
    return GameOddsBookLineRow(
        sport="mlb",
        game_id=game_id,
        market=market,
        side=side,
        bookmaker=bookmaker,
        source=source,
        american_odds=american_odds,
        point=point,
        decimal_odds=None,
        fetched_at="2026-08-26T23:00:00+00:00",
    )


def _snapshot_game(game_pk, away, home) -> SnapshotGame:
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


def test_game_lines_from_book_lines_best_price_and_bookmakers():
    print("\ngame_lines_from_book_lines")
    rows = [
        _row("778899", "moneyline", "home", "draftkings", -150),
        _row("778899", "moneyline", "home", "fanduel", -140),  # worse for home bettor... but -140 > -150, so this is BEST
        _row("778899", "moneyline", "away", "draftkings", 130),
        _row("778899", "total", "over", "draftkings", -105, point=8.5),
        _row("778899", "total", "under", "fanduel", -110, point=8.5),
        # A row for a game not on today's slate — must be silently ignored.
        _row("000000", "moneyline", "home", "draftkings", -200),
    ]
    games = [_snapshot_game("778899", "Boston Red Sox", "New York Yankees")]
    lines = game_lines_from_book_lines(rows, games)

    check("exactly one GameLine produced (stale game_id ignored)", len(lines), 1)
    line = lines[0]
    check("event_id is the real game_pk", line.event_id, "778899")
    check("home_team/away_team from the matched SnapshotGame", (line.away_team, line.home_team), ("Boston Red Sox", "New York Yankees"))
    check("moneyline.home is the BEST (largest) american price across books", line.moneyline.home, -140)
    check("moneyline.away carried through from its only book", line.moneyline.away, 130)
    # .book is a single shared field updated by whichever side's loop runs
    # last — the same disclosed, accepted limitation summarise_odds_event's
    # own docstring already carries ("the two sides of a spread/total can
    # end up attributed to different books"), not something this function
    # is expected to resolve differently.
    check("moneyline.book reflects the away side's own best book (last writer, disclosed limitation)", line.moneyline.book, "draftkings")
    check("total.point carried through", line.total.point, 8.5)
    check("every real bookmaker retained in bookmakers[], not just the best one", {b.bookmaker for b in line.bookmakers}, {"draftkings", "fanduel"})
    check("book_count matches real bookmaker count", line.book_count, 2)


def test_game_lines_from_book_lines_empty_rows():
    print("\ngame_lines_from_book_lines (no rows)")
    check("no rows -> no lines", game_lines_from_book_lines([], [_snapshot_game("1", "A", "B")]), [])


def test_primary_mlb_lines_sharpapi_preferred_odds_api_fallback():
    print("\n_primary_mlb_lines")
    games = [
        _snapshot_game("111", "Boston Red Sox", "New York Yankees"),  # SharpAPI covers this one
        _snapshot_game("222", "Chicago Cubs", "St. Louis Cardinals"),  # SharpAPI does NOT — falls back to the-odds-api
        _snapshot_game("333", "Houston Astros", "Texas Rangers"),  # NEITHER source has it — dropped entirely
    ]
    sharpapi_lines = [
        GameLine(event_id="111", commence_time="", home_team="New York Yankees", away_team="Boston Red Sox", bookmakers=[BookmakerOdds(bookmaker="draftkings")]),
    ]
    the_odds_api_lines = [
        # Keyed by the-odds-api's own foreign UUID, not the real game_pk — matched by team name.
        GameLine(event_id="odds-api-uuid-1", commence_time="", home_team="St. Louis Cardinals", away_team="Chicago Cubs", bookmakers=[]),
        GameLine(event_id="odds-api-uuid-2", commence_time="", home_team="Not On Slate At All", away_team="Also Not On Slate", bookmakers=[]),
    ]

    primary = _primary_mlb_lines(games, sharpapi_lines, the_odds_api_lines)
    by_home = {l.home_team: l for l in primary}

    check("2 of 3 games got a primary line (game 333 has neither source)", len(primary), 2)
    check("game 111 uses the SharpAPI line (real game_id as event_id)", by_home["New York Yankees"].event_id, "111")
    check("game 222 falls back to the-odds-api's line", by_home["St. Louis Cardinals"].event_id, "odds-api-uuid-1")
    check("game 333 (neither source) produces no line at all — not fabricated", "Texas Rangers" in by_home, False)


def test_primary_mlb_lines_no_sharpapi_at_all_falls_back_fully():
    print("\n_primary_mlb_lines (SharpAPI down entirely)")
    games = [_snapshot_game("111", "Boston Red Sox", "New York Yankees")]
    the_odds_api_lines = [GameLine(event_id="odds-api-uuid-1", commence_time="", home_team="New York Yankees", away_team="Boston Red Sox", bookmakers=[])]
    primary = _primary_mlb_lines(games, [], the_odds_api_lines)
    check("with zero SharpAPI lines, the-odds-api still covers every game — the model never goes dark", len(primary), 1)
    check("real fallback event_id used", primary[0].event_id, "odds-api-uuid-1")


if __name__ == "__main__":
    test_game_lines_from_book_lines_best_price_and_bookmakers()
    test_game_lines_from_book_lines_empty_rows()
    test_primary_mlb_lines_sharpapi_preferred_odds_api_fallback()
    test_primary_mlb_lines_no_sharpapi_at_all_falls_back_fully()
    print(f"\n{'FAILED' if _failures else 'ALL PASSED'} ({_failures} failure(s))")
    raise SystemExit(1 if _failures else 0)
