"""Pure-function tests for harvester_scrape.py's record-parsing logic —
specifically the 2026-08-26 addition of real Asian Handicap (spread) parsing
for the umbrella-market discovery feature (odds-architecture rebuild, Phase
4). Previously any asian_handicap_* row was silently dropped (no branch
existed for it at all); NFL/CFB's SCRAPE_CONFIG now requests
"asian_handicap" (the umbrella token), so a real discovered handicap line
must actually reach game_odds_book_lines, not vanish. Run with:
    python test_harvester_scrape.py
"""
from db import GameOddsBookLineRow
from harvester_scrape import (
    _closest_line_token,
    _handicap_point,
    _market_point,
    _parse_line_number,
    _record_to_game_line,
    _reference_points_by_game,
)

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def test_handicap_point_parsing():
    print("\n_handicap_point")
    check("negative whole+frac", _handicap_point("asian_handicap_-21_5"), -21.5)
    check("positive whole+frac", _handicap_point("asian_handicap_+3_5"), 3.5)
    check("zero", _handicap_point("asian_handicap_0"), 0.0)
    check("negative half without explicit whole digit before the dash", _handicap_point("asian_handicap_-0_5"), -0.5)
    check("not a handicap token -> None", _handicap_point("over_under_44_5"), None)
    check("garbage -> None", _handicap_point("home_away"), None)


def test_market_point_still_only_matches_over_under():
    print("\n_market_point (regression: must not match handicap tokens)")
    check("over/under token parses", _market_point("over_under_44_5"), 44.5)
    check("handicap token does NOT parse as a total point", _market_point("asian_handicap_-3_5"), None)


def test_record_to_game_line_parses_real_handicap_data():
    print("\n_record_to_game_line (asian_handicap branch)")
    record = {
        "home_team": "Kansas City Chiefs",
        "away_team": "Buffalo Bills",
        "match_date": "2026-09-10T00:20:00Z",
        "home_away_market": [
            {"bookmaker_name": "DraftKings", "1": "1.67", "2": "2.30"},
        ],
        "asian_handicap_-3_5_market": [
            {"bookmaker_name": "DraftKings", "1": "1.91", "2": "1.95"},
            {"bookmaker_name": "FanDuel", "1": "1.87", "2": "1.98"},
        ],
    }
    line = _record_to_game_line(record, game_id="778899")
    check("event_id is the real game_id passed in", line.event_id, "778899")
    dk = next(b for b in line.bookmakers if b.bookmaker == "DraftKings")
    fd = next(b for b in line.bookmakers if b.bookmaker == "FanDuel")

    check("home spread == the discovered signed line", dk.spread_home, -3.5)
    check("away spread == the mirrored (negated) line, not independently reported", dk.spread_away, 3.5)
    check("home spread price parsed from label '1'", dk.spread_home_price, 1.91)
    check("away spread price parsed from label '2'", dk.spread_away_price, 1.95)
    check("a second real bookmaker's handicap row is also captured", (fd.spread_home, fd.spread_away), (-3.5, 3.5))
    check("moneyline data from the SAME book untouched by the handicap branch", dk.home_odds, 1.67)


def test_record_to_game_line_handicap_conflict_keeps_first():
    print("\n_record_to_game_line (asian_handicap conflict across two requested lines)")
    record = {
        "home_team": "Kansas City Chiefs",
        "away_team": "Buffalo Bills",
        "asian_handicap_-3_5_market": [{"bookmaker_name": "DraftKings", "1": "1.91", "2": "1.95"}],
        "asian_handicap_-2_5_market": [{"bookmaker_name": "DraftKings", "1": "1.80", "2": "2.05"}],
    }
    line = _record_to_game_line(record, game_id="1")
    dk = line.bookmakers[0]
    # Dict iteration order in CPython 3.7+ is insertion order, matching the record's own
    # key order above — -3.5 was inserted first, so it's the one that survives.
    check("first-seen handicap line wins on conflict, not silently overwritten", dk.spread_home, -3.5)


def test_record_to_game_line_no_handicap_data_leaves_spread_unset():
    print("\n_record_to_game_line (no handicap market present)")
    record = {
        "home_team": "A",
        "away_team": "B",
        "home_away_market": [{"bookmaker_name": "DraftKings", "1": "1.5", "2": "2.5"}],
    }
    line = _record_to_game_line(record, game_id="1")
    dk = line.bookmakers[0]
    check("spread fields stay None with no handicap market in the record", (dk.spread_home, dk.spread_away), (None, None))


def test_parse_line_number():
    print("\n_parse_line_number")
    check("over/under label", _parse_line_number("Over/Under +44.5"), 44.5)
    check("negative handicap label", _parse_line_number("Asian Handicap -2.5"), -2.5)
    check("positive handicap label", _parse_line_number("Asian Handicap +2.5"), 2.5)
    check("no number -> None", _parse_line_number("Over/Under"), None)


def _book_line_row(game_id, market, side, point, source, fetched_at="2026-08-26T20:00:00+00:00") -> GameOddsBookLineRow:
    return GameOddsBookLineRow(
        sport="nfl", game_id=game_id, market=market, side=side, bookmaker="draftkings",
        source=source, american_odds=-110, point=point, decimal_odds=None, fetched_at=fetched_at,
    )


def test_reference_points_by_game_excludes_oddsharvester_and_picks_freshest():
    print("\n_reference_points_by_game")
    rows = [
        _book_line_row("1", "total", "over", 44.5, "sportsgameodds", fetched_at="2026-08-26T20:00:00+00:00"),
        _book_line_row("1", "total", "over", 45.5, "sportsgameodds", fetched_at="2026-08-26T21:00:00+00:00"),  # fresher, same game/market
        _book_line_row("1", "spread", "home", -3.5, "sportsgameodds"),
        _book_line_row("1", "spread", "away", 3.5, "sportsgameodds"),  # away side ignored — only home is the reference
        _book_line_row("1", "total", "over", 99.0, "oddsharvester"),  # must be excluded regardless of freshness
        _book_line_row("2", "total", "over", 8.5, "sportsgameodds"),  # different game, unrelated
    ]
    ref = _reference_points_by_game(rows)
    check("game 1 total = freshest real value, oddsharvester's own guess excluded", ref[("1", "total")], 45.5)
    check("game 1 spread = home side's own signed point", ref[("1", "spread")], -3.5)
    check("game 2's own total present and separate", ref[("2", "total")], 8.5)
    check("no bogus entry created for a market/side never seen", ("1", "moneyline") in ref, False)


def test_closest_line_token_picks_nearest_and_converts_to_a_real_token():
    print("\n_closest_line_token")
    discovered = [
        {"submarket_name": "Over/Under +14.5"},
        {"submarket_name": "Over/Under +44.5"},
        {"submarket_name": "Over/Under +45.5"},
        {"submarket_name": "Over/Under +54.5"},
    ]
    token = _closest_line_token(discovered, "Over/Under", "american-football", reference=45.2)
    check("picks the discovered line closest to the reference (45.5, not 44.5 or 14.5)", token, "over_under_45_5")


def test_closest_line_token_out_of_registered_range_returns_none():
    print("\n_closest_line_token (discovered value outside the registered enum's range)")
    discovered = [{"submarket_name": "Over/Under +999.5"}]
    token = _closest_line_token(discovered, "Over/Under", "american-football", reference=999.5)
    check("a discovered line with no matching registered token is dropped, not fabricated", token, None)


def test_closest_line_token_no_discovered_rows():
    print("\n_closest_line_token (nothing discovered)")
    check("empty discovery -> None, not an arbitrary default", _closest_line_token([], "Over/Under", "american-football", reference=45.0), None)


if __name__ == "__main__":
    test_handicap_point_parsing()
    test_market_point_still_only_matches_over_under()
    test_record_to_game_line_parses_real_handicap_data()
    test_record_to_game_line_handicap_conflict_keeps_first()
    test_record_to_game_line_no_handicap_data_leaves_spread_unset()
    test_parse_line_number()
    test_reference_points_by_game_excludes_oddsharvester_and_picks_freshest()
    test_closest_line_token_picks_nearest_and_converts_to_a_real_token()
    test_closest_line_token_out_of_registered_range_returns_none()
    test_closest_line_token_no_discovered_rows()
    print(f"\n{'FAILED' if _failures else 'ALL PASSED'} ({_failures} failure(s))")
    raise SystemExit(1 if _failures else 0)
