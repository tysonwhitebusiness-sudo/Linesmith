"""Soccer's moneyline is three-way — the draw must reach `game_odds_book_lines`.

Both paid builders dropped any moneyline side that was not home/away, so the
draw price was discarded at ingest even though the table has always allowed
`side = 'draw'` (`gobl_side_valid`). Measured 2026-09-19: every draw row in the
archive (EPL 44, MLS 53) came from OddsHarvester; the paid providers' draws,
if they send them, were filtered out by us.

Run with:  .venv/Scripts/python.exe src/test_soccer_draw_line.py
"""
import sys

import providers
from game_context import Game

failures: list[str] = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok  {name}")


def soccer_game():
    return Game(sport="soccer", game_id="401879269", away_team_name="Aston Villa",
                home_team_name="Tottenham Hotspur", away_abbr="AVL", home_abbr="TOT",
                game_date="2026-09-19T11:30:00Z")


def mlb_game():
    return Game(sport="mlb", game_id="824545", away_team_name="Detroit Tigers",
                home_team_name="Chicago White Sox", away_abbr="DET", home_abbr="CWS",
                game_date="2026-09-19T18:10:00Z")


print("SharpAPI")
ml = providers._SHARPAPI_MONEYLINE_TYPE
compact = [("Tottenham Hotspur", "Aston Villa", "FanDuel", ml, side, None, None, price)
           for side, price in (("home", -140), ("away", 360), ("draw", 280))]
rows = providers._sharpapi_game_line_rows(compact, [soccer_game()])
check("three sides kept", sorted(r.side for r in rows), ["away", "draw", "home"])
check("draw price", next((r.american_odds for r in rows if r.side == "draw"), None), 280)
check("draw has no point", next((r.point for r in rows if r.side == "draw"), "x"), None)

mlb_compact = [("Chicago White Sox", "Detroit Tigers", "FanDuel", ml, s, None, None, p)
               for s, p in (("home", -130), ("away", 110), ("draw", 999))]
mlb_rows = providers._sharpapi_game_line_rows(mlb_compact, [mlb_game()])
check("baseball has no draw", sorted(r.side for r in mlb_rows), ["away", "home"])

print("SportsGameOdds")
event = {"odds": {
    "a": {"betTypeID": "ml", "periodID": "game", "sideID": "home",
          "byBookmaker": {"fanduel": {"available": True, "odds": "-140"}}},
    "b": {"betTypeID": "ml", "periodID": "game", "sideID": "draw",
          "byBookmaker": {"fanduel": {"available": True, "odds": "280"}}},
    "c": {"betTypeID": "ml", "periodID": "game", "sideID": "away",
          "byBookmaker": {"fanduel": {"available": True, "odds": "360"}}},
}}
sgo = providers._sgo_game_line_rows(event, "soccer", "401879269")
check("three sides kept", sorted(r.side for r in sgo), ["away", "draw", "home"])
sgo_mlb = providers._sgo_game_line_rows(event, "mlb", "824545")
check("baseball has no draw", sorted(r.side for r in sgo_mlb), ["away", "home"])

print("Propline / odds-api outcomes")
bookmakers = [{"key": "fanduel", "title": "FanDuel", "markets": [{"key": "h2h", "outcomes": [
    {"name": "Tottenham Hotspur", "price": -140},
    {"name": "Aston Villa", "price": 360},
    {"name": "Draw", "price": 280},
]}]}]
pl = providers._propline_game_line_rows(bookmakers, soccer_game(), "soccer")
check("three sides kept", sorted(r.side for r in pl), ["away", "draw", "home"])
check("draw is a moneyline", next((r.market for r in pl if r.side == "draw"), None), "moneyline")
pl_mlb = providers._propline_game_line_rows(
    [{"key": "fanduel", "title": "FanDuel", "markets": [{"key": "h2h", "outcomes": [
        {"name": "Chicago White Sox", "price": -130}, {"name": "Detroit Tigers", "price": 110},
        {"name": "Draw", "price": 999}]}]}], mlb_game(), "mlb")
check("baseball has no draw", sorted(r.side for r in pl_mlb), ["away", "home"])

print()
if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)
print("all soccer draw-line checks passed")
