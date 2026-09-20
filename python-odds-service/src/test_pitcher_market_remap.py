"""R6-F8 — a pitcher's strikeouts must not land under the batter market.

ParlayAPI sends one generic `strikeouts` / `walks` market for both sides of
the ball. Measured live 2026-09-15: 29 pitchers filed under `batter-strikeouts`
and 9 under `walks`, so every pitcher market missed those books entirely.

The fix has two halves and this checks both:
  1. game_context carries the MLB snapshot's `meta.role` onto the roster entry
     (it was parsed and dropped);
  2. providers._normalize_row remaps the two batter-only markets when the
     resolved player is a pitcher.

Run with:  .venv/Scripts/python.exe src/test_pitcher_market_remap.py
"""
import json
import sys

sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else ".")

import game_context as gc
import providers
from entity_resolution import RosterEntry

failures: list[str] = []


def check(name: str, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok  {name}")


# ---------------------------------------------------------------- roster role
subjects = [
    {"subjectId": "1", "subjectName": "Sean Burke", "meta": {"gamePk": 7, "team": "CWS", "role": "pitcher"}},
    {"subjectId": "2", "subjectName": "Kyle Schwarber", "meta": {"gamePk": 7, "team": "PHI", "role": "batter"}},
    {"subjectId": "3", "subjectName": "Other Game", "meta": {"gamePk": 8, "team": "NYY", "role": "pitcher"}},
]
roster = gc._roster_for_mlb_game(subjects, 7)
print("roster from the snapshot's own meta.role")
check("only this game's subjects", [r.subject_id for r in roster], ["1", "2"])
check("pitcher gets a position", roster[0].position, "P")
check("batter gets none", roster[1].position, None)


# ------------------------------------------------------------- market remap
def game(sport="mlb"):
    return gc.Game(sport=sport, game_id="7", away_team_name="Philadelphia Phillies", home_team_name="Chicago White Sox",
                   away_abbr="PHI", home_abbr="CWS", game_date="2026-09-19T18:10:00Z", roster=roster)


pitcher = RosterEntry(subject_id="1", subject_name="Sean Burke", team_abbr="CWS", position="P")
batter = RosterEntry(subject_id="2", subject_name="Kyle Schwarber", team_abbr="PHI", position=None)

print("the remap")
check("pitcher strikeouts", providers._pitcher_market("batter-strikeouts", game(), pitcher), "pitcher-strikeouts")
check("pitcher walks", providers._pitcher_market("walks", game(), pitcher), "pitcher-walks-allowed")
check("batter strikeouts untouched", providers._pitcher_market("batter-strikeouts", game(), batter), "batter-strikeouts")
check("batter walks untouched", providers._pitcher_market("walks", game(), batter), "walks")
check("other markets untouched", providers._pitcher_market("total-bases", game(), pitcher), "total-bases")
check("non-MLB untouched", providers._pitcher_market("walks", game("nfl"), pitcher), "walks")
check("relief positions count", providers._pitcher_market("walks", game(), RosterEntry("9", "X", "CWS", "RP")), "pitcher-walks-allowed")

# ------------------------------------------------- end to end through the writer
print("through _normalize_row")
out = providers.FetchOutcome(provider_id="parlayapi")
index = providers.build_roster_index(roster)
providers._normalize_row(out, game(), index, raw_player_name="Sean Burke", raw_market_label="strikeouts",
                         raw_bookmaker="FanDuel", context="test", side="over", line=5.5, american_odds=-115,
                         decimal_odds=None)
providers._normalize_row(out, game(), index, raw_player_name="Kyle Schwarber", raw_market_label="strikeouts",
                         raw_bookmaker="FanDuel", context="test", side="over", line=0.5, american_odds=-140,
                         decimal_odds=None)
check("rows written", len(out.rows), 2)
if len(out.rows) == 2:
    check("pitcher row", out.rows[0].market_key, "pitcher-strikeouts")
    check("batter row", out.rows[1].market_key, "batter-strikeouts")

print()
if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)
print("all pitcher-market remap checks passed")
