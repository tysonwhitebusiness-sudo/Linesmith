"""Permanent test suite for providers.py's game-line recovery functions
(Phase 1 of the odds-architecture rebuild — recovering game-level
moneyline/spread/total data that was already arriving in existing
player-prop responses and being discarded). Run with:
    python test_providers.py

Fixture shapes match sportsGameOdds.ts's own field names exactly (betTypeID
'ml'/'sp'/'ou', periodID 'game', sideID, byBookmaker.odds/spread/overUnder/
available) — the same real shape fetch_sportsgameodds's player-prop loop
already parses, confirmed live this session per that file's own comments.
"""
from db import GameOddsBookLineInput
from game_context import Game
from providers import _propline_game_line_rows, _sgo_game_line_rows, _sharpapi_game_line_rows

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def _row_tuples(rows: list[GameOddsBookLineInput]) -> set[tuple]:
    return {(r.sport, r.game_id, r.market, r.side, r.bookmaker, r.source, r.american_odds, r.point) for r in rows}


def test_sgo_game_line_rows_moneyline_spread_total():
    print("\n_sgo_game_line_rows")
    event = {
        "odds": {
            # Moneyline — home and away, two books each.
            "ml-home": {
                "playerID": None,
                "periodID": "game",
                "betTypeID": "ml",
                "sideID": "home",
                "byBookmaker": {
                    "draftkings": {"odds": "-150", "available": True},
                    "fanduel": {"odds": "-145", "available": True},
                    "caesars": {"odds": "-160", "available": False},  # unavailable — excluded
                },
            },
            "ml-away": {
                "playerID": None,
                "periodID": "game",
                "betTypeID": "ml",
                "sideID": "away",
                "byBookmaker": {
                    "draftkings": {"odds": "130", "available": True},
                },
            },
            # Spread — home side, one book, with a spread point.
            "sp-home": {
                "playerID": None,
                "periodID": "game",
                "betTypeID": "sp",
                "sideID": "home",
                "byBookmaker": {
                    "draftkings": {"odds": "-110", "spread": "-1.5", "available": True},
                },
            },
            # Total — over/under, one book each, with an overUnder point.
            "ou-over": {
                "playerID": None,
                "periodID": "game",
                "betTypeID": "ou",
                "sideID": "over",
                "byBookmaker": {
                    "draftkings": {"odds": "-105", "overUnder": "8.5", "available": True},
                },
            },
            "ou-under": {
                "playerID": None,
                "periodID": "game",
                "betTypeID": "ou",
                "sideID": "under",
                "byBookmaker": {
                    "draftkings": {"odds": "-115", "overUnder": "8.5", "available": True},
                },
            },
            # Player prop — must be entirely excluded from game-line rows.
            "prop-1": {
                "playerID": "AARON_JUDGE_1_MLB",
                "periodID": "game",
                "betTypeID": "ou",
                "sideID": "over",
                "byBookmaker": {"draftkings": {"odds": "-120", "overUnder": "1.5", "available": True}},
            },
            # Inning-scoped (not full game) — must be excluded.
            "inning-ml": {
                "playerID": None,
                "periodID": "1st_inning",
                "betTypeID": "ml",
                "sideID": "home",
                "byBookmaker": {"draftkings": {"odds": "-110", "available": True}},
            },
        }
    }

    rows = _sgo_game_line_rows(event, sport="mlb", game_id="778899")
    actual = _row_tuples(rows)
    expected = {
        ("mlb", "778899", "moneyline", "home", "draftkings", "sportsgameodds", -150, None),
        ("mlb", "778899", "moneyline", "home", "fanduel", "sportsgameodds", -145, None),
        ("mlb", "778899", "moneyline", "away", "draftkings", "sportsgameodds", 130, None),
        ("mlb", "778899", "spread", "home", "draftkings", "sportsgameodds", -110, -1.5),
        ("mlb", "778899", "total", "over", "draftkings", "sportsgameodds", -105, 8.5),
        ("mlb", "778899", "total", "under", "draftkings", "sportsgameodds", -115, 8.5),
    }
    check("moneyline/spread/total recovered, player prop and inning-scoped excluded, unavailable book excluded", actual, expected)
    check("row count matches expected set exactly (no dupes, no extras)", len(rows), len(expected))


def test_sgo_game_line_rows_empty_odds():
    print("\n_sgo_game_line_rows (empty/missing odds)")
    check("missing odds key -> []", _sgo_game_line_rows({}, "mlb", "1"), [])
    check("empty odds dict -> []", _sgo_game_line_rows({"odds": {}}, "mlb", "1"), [])


def test_sgo_game_line_rows_missing_point_excluded():
    print("\n_sgo_game_line_rows (missing spread/total point)")
    event = {
        "odds": {
            "sp-no-point": {
                "playerID": None,
                "periodID": "game",
                "betTypeID": "sp",
                "sideID": "home",
                "byBookmaker": {"draftkings": {"odds": "-110", "available": True}},  # no "spread" key
            },
            "ou-no-point": {
                "playerID": None,
                "periodID": "game",
                "betTypeID": "ou",
                "sideID": "over",
                "byBookmaker": {"draftkings": {"odds": "-105", "available": True}},  # no "overUnder" key
            },
        }
    }
    rows = _sgo_game_line_rows(event, "mlb", "1")
    check("spread/total rows with no point are dropped, not written with point=None", rows, [])


def _propline_game() -> Game:
    return Game(
        sport="mlb",
        game_id="778899",
        away_team_name="Boston Red Sox",
        home_team_name="New York Yankees",
        away_abbr="BOS",
        home_abbr="NYY",
        game_date="2026-08-26T23:05:00Z",
    )


def test_propline_game_line_rows_h2h_spreads_totals():
    print("\n_propline_game_line_rows")
    bookmakers = [
        {
            "key": "draftkings",
            "markets": [
                {
                    "key": "h2h",
                    "outcomes": [
                        {"name": "New York Yankees", "price": -150},
                        {"name": "Boston Red Sox", "price": 130},
                    ],
                },
                {
                    "key": "spreads",
                    "outcomes": [
                        {"name": "New York Yankees", "price": -110, "point": -1.5},
                        {"name": "Boston Red Sox", "price": -110, "point": 1.5},
                    ],
                },
                {
                    "key": "totals",
                    "outcomes": [
                        {"name": "Over", "price": -105, "point": 8.5},
                        {"name": "Under", "price": -115, "point": 8.5},
                    ],
                },
                # A real player-prop market must never be picked up here.
                {
                    "key": "player_hits",
                    "outcomes": [{"name": "Over", "description": "Aaron Judge", "price": -120, "point": 1.5}],
                },
            ],
        }
    ]

    rows = _propline_game_line_rows(bookmakers, _propline_game(), "mlb")
    actual = _row_tuples(rows)
    expected = {
        ("mlb", "778899", "moneyline", "home", "draftkings", "propline", -150, None),
        ("mlb", "778899", "moneyline", "away", "draftkings", "propline", 130, None),
        ("mlb", "778899", "spread", "home", "draftkings", "propline", -110, -1.5),
        ("mlb", "778899", "spread", "away", "draftkings", "propline", -110, 1.5),
        ("mlb", "778899", "total", "over", "draftkings", "propline", -105, 8.5),
        ("mlb", "778899", "total", "under", "draftkings", "propline", -115, 8.5),
    }
    check("h2h/spreads/totals recovered, player-prop market excluded", actual, expected)
    check("row count exact", len(rows), len(expected))


def test_propline_game_line_rows_unmatched_team_name_dropped():
    print("\n_propline_game_line_rows (unmatched team name)")
    bookmakers = [
        {
            "key": "fanduel",
            "markets": [{"key": "h2h", "outcomes": [{"name": "Some Other Team", "price": 100}]}],
        }
    ]
    rows = _propline_game_line_rows(bookmakers, _propline_game(), "mlb")
    check("outcome name matching neither team is dropped, not guessed", rows, [])


def test_propline_game_line_rows_missing_price_or_point_dropped():
    print("\n_propline_game_line_rows (missing price/point)")
    bookmakers = [
        {
            "key": "fanduel",
            "markets": [
                {"key": "h2h", "outcomes": [{"name": "New York Yankees"}]},  # no price
                {"key": "spreads", "outcomes": [{"name": "New York Yankees", "price": -110}]},  # no point
                {"key": "totals", "outcomes": [{"name": "Over", "price": -105}]},  # no point
            ],
        }
    ]
    rows = _propline_game_line_rows(bookmakers, _propline_game(), "mlb")
    check("rows missing a required price/point are dropped, never written with a null placeholder", rows, [])


def _sharpapi_game() -> Game:
    return Game(
        sport="mlb",
        game_id="778899",
        away_team_name="Boston Red Sox",
        home_team_name="New York Yankees",
        away_abbr="BOS",
        home_abbr="NYY",
        game_date="2026-08-26T23:05:00Z",
    )


def test_sharpapi_game_line_rows_moneyline_spread_total():
    print("\n_sharpapi_game_line_rows")
    # (home, away, sportsbook, market_type, team_side, selection_type, line, american_odds)
    compact = [
        ("New York Yankees", "Boston Red Sox", "draftkings", "moneyline", "home", None, None, -150),
        ("New York Yankees", "Boston Red Sox", "draftkings", "moneyline", "away", None, None, 130),
        ("New York Yankees", "Boston Red Sox", "draftkings", "run_line", "home", None, -1.5, -110),
        ("New York Yankees", "Boston Red Sox", "draftkings", "total_runs", None, "over", 8.5, -105),
        ("New York Yankees", "Boston Red Sox", "draftkings", "total_runs", None, "under", 8.5, -115),
        # Doesn't match either team in the games list — must be dropped.
        ("Some Other", "Team Entirely", "fanduel", "moneyline", "home", None, None, -200),
    ]
    rows = _sharpapi_game_line_rows(compact, [_sharpapi_game()])
    actual = _row_tuples(rows)
    expected = {
        ("mlb", "778899", "moneyline", "home", "draftkings", "sharpapi", -150, None),
        ("mlb", "778899", "moneyline", "away", "draftkings", "sharpapi", 130, None),
        ("mlb", "778899", "spread", "home", "draftkings", "sharpapi", -110, -1.5),
        ("mlb", "778899", "total", "over", "draftkings", "sharpapi", -105, 8.5),
        ("mlb", "778899", "total", "under", "draftkings", "sharpapi", -115, 8.5),
    }
    check("moneyline/spread(run_line)/total(total_runs) recovered, unmatched game dropped", actual, expected)
    check("row count exact", len(rows), len(expected))


def test_sharpapi_game_line_rows_missing_line_dropped():
    print("\n_sharpapi_game_line_rows (missing spread/total line)")
    compact = [
        ("New York Yankees", "Boston Red Sox", "draftkings", "run_line", "home", None, None, -110),  # no line
        ("New York Yankees", "Boston Red Sox", "draftkings", "total_runs", None, "over", None, -105),  # no line
    ]
    rows = _sharpapi_game_line_rows(compact, [_sharpapi_game()])
    check("spread/total rows missing a line are dropped, never written with point=None", rows, [])


def test_sharpapi_game_line_rows_unknown_market_type_dropped():
    print("\n_sharpapi_game_line_rows (unknown market_type)")
    compact = [("New York Yankees", "Boston Red Sox", "draftkings", "mvp_futures", "home", None, None, 500)]
    rows = _sharpapi_game_line_rows(compact, [_sharpapi_game()])
    check("a market_type outside moneyline/spread/total is ignored, not guessed", rows, [])


if __name__ == "__main__":
    test_sgo_game_line_rows_moneyline_spread_total()
    test_sgo_game_line_rows_empty_odds()
    test_sgo_game_line_rows_missing_point_excluded()
    test_propline_game_line_rows_h2h_spreads_totals()
    test_propline_game_line_rows_unmatched_team_name_dropped()
    test_propline_game_line_rows_missing_price_or_point_dropped()
    test_sharpapi_game_line_rows_moneyline_spread_total()
    test_sharpapi_game_line_rows_missing_line_dropped()
    test_sharpapi_game_line_rows_unknown_market_type_dropped()
    print(f"\n{'FAILED' if _failures else 'ALL PASSED'} ({_failures} failure(s))")
    raise SystemExit(1 if _failures else 0)
