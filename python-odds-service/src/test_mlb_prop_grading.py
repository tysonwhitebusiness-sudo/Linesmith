"""Task 2.7b — the MLB prop grading port (predict/mlb_prop_grading.py).

    python -u src/test_mlb_prop_grading.py

Pure functions only: no DB, no network. The grading decisions are where a
port silently diverges from its original, so those are what this covers —
especially the two the TS original documents as having been wrong once
(P3 C3's under-side market probability, and the home/away pitching
convention in the 1st inning).
"""
import sys

import db
from predict.mlb_prop_grading import (
    find_closest_price_pair,
    grade_moneyline_row,
    grade_row,
    grade_total_row,
)
from predict.statsapi import MlbLiveFeed

FAILURES: list[str] = []


def check(name, got, want):
    if got != want:
        FAILURES.append(name)
        print(f"FAIL  {name}: got {got!r}, want {want!r}")
    else:
        print(f"PASS  {name}")


def row(**kw) -> db.UngradedRow:
    base = dict(id=1, subject_id="123", dimension="hit-in-game", category="hit",
                line=None, market_key=None, model_prob=None, surfaced_at="2026-08-28T18:00:00Z")
    base.update(kw)
    return db.UngradedRow(**base)


def feed(home_runs=5, away_runs=3, home_id=147, away_id=111, innings=None, boxscore=None) -> MlbLiveFeed:
    return MlbLiveFeed(
        game_pk=1,
        linescore={"teams": {"home": {"runs": home_runs}, "away": {"runs": away_runs}},
                   "innings": innings or []},
        boxscore=boxscore or {},
        game_data={"teams": {"home": {"id": home_id}, "away": {"id": away_id}},
                   "status": {"abstractGameState": "Final"}},
        plays={},
    )


# --- moneyline ----------------------------------------------------------
g = grade_moneyline_row(row(subject_id="team-147", dimension="moneyline", category="win"), feed())
check("moneyline winner graded win", (g.outcome, g.actual_value), ("win", 1.0))
g = grade_moneyline_row(row(subject_id="team-111", dimension="moneyline", category="win"), feed())
check("moneyline loser graded loss", (g.outcome, g.actual_value), ("loss", 0.0))
check("tie is not graded", grade_moneyline_row(row(subject_id="team-147", dimension="moneyline"), feed(4, 4)), None)
check("missing runs not graded", grade_moneyline_row(row(subject_id="team-147", dimension="moneyline"), feed(None, 3)), None)

# --- total --------------------------------------------------------------
g = grade_total_row(row(dimension="total", category="over", line=7.5), feed(5, 3))
check("total over hits (8 > 7.5)", (g.outcome, g.actual_value), ("win", 8.0))
g = grade_total_row(row(dimension="total", category="over", line=8.5), feed(5, 3))
check("total over misses (8 < 8.5)", (g.outcome, g.actual_value), ("loss", 8.0))
check("total with no line not graded", grade_total_row(row(dimension="total", category="over", line=None), feed()), None)

# --- box-score markets --------------------------------------------------
BOX = {"teams": {
    "home": {"players": {"ID123": {"stats": {"batting": {"hits": 2, "homeRuns": 1, "totalBases": 5}}}}},
    "away": {"players": {"ID999": {"stats": {"batting": {"hits": 0}}}}},
}}
g = grade_row(row(subject_id="123", dimension="hit-in-game", category="hit"), BOX, [])
check("hit-in-game hit -> win", (g.outcome, g.actual_value), ("win", 2.0))
g = grade_row(row(subject_id="123", dimension="hit-in-game", category="no-hit"), BOX, [])
check("hit-in-game no-hit -> loss", g.outcome, "loss")
g = grade_row(row(subject_id="999", dimension="hit-in-game", category="no-hit"), BOX, [])
check("away player found too", (g.outcome, g.actual_value), ("win", 0.0))
check("player absent from box score not graded", grade_row(row(subject_id="555"), BOX, []), None)

g = grade_row(row(subject_id="123", dimension="total-bases", category="over", line=3.5), BOX, [])
check("stat market over line -> win", (g.outcome, g.actual_value), ("win", 5.0))
g = grade_row(row(subject_id="123", dimension="total-bases", category="under", line=3.5), BOX, [])
check("stat market under, same value -> loss", g.outcome, "loss")
check("unknown dimension not graded", grade_row(row(subject_id="123", dimension="vs-LHP", category="over"), BOX, []), None)

# --- first-inning: the home/away pitching convention --------------------
# The HOME pitcher works the top of the 1st, so the runs they allowed are
# the AWAY team's runs. Getting this backwards grades every first-inning
# row against the wrong half.
INN = [{"num": 1, "home": {"runs": 0}, "away": {"runs": 2}}]
g = grade_row(row(subject_id="123", dimension="first-inning", category="run"), BOX, INN)
check("home pitcher charged the AWAY half's runs", (g.outcome, g.actual_value), ("win", 2.0))
AWAY_BOX = {"teams": {"home": {"players": {}}, "away": {"players": {"ID123": {"stats": {"batting": {}}}}}}}
g = grade_row(row(subject_id="123", dimension="first-inning", category="run"), AWAY_BOX, INN)
check("away pitcher charged the HOME half's runs", (g.outcome, g.actual_value), ("loss", 0.0))
check("no first inning present not graded", grade_row(row(subject_id="123", dimension="first-inning", category="run"), BOX, []), None)

# --- price pairing ------------------------------------------------------
def pt(book, side, odds, at):
    return db.PropOddsHistoryPoint(provider_id="p1", bookmaker=book, side=side, american_odds=odds, observed_at=at)

# Cross-book contamination: bookA has the closest over, bookB the closest
# under. Pairing across them would devig a price nobody ever offered.
pts = [
    pt("bookA", "over", -110, "2026-08-28T17:59:00Z"),
    pt("bookA", "under", -110, "2026-08-28T12:00:00Z"),
    pt("bookB", "over", -105, "2026-08-28T17:00:00Z"),
    pt("bookB", "under", -115, "2026-08-28T17:01:00Z"),
]
pair = find_closest_price_pair(pts, "2026-08-28T18:00:00Z")
check("pair comes from ONE book, not the closest of each", (pair[0].bookmaker, pair[1].bookmaker), ("bookB", "bookB"))

one_sided = [pt("bookA", "over", -110, "2026-08-28T17:59:00Z")]
check("one-sided book yields no pair", find_closest_price_pair(one_sided, "2026-08-28T18:00:00Z"), None)
check("unparseable surfaced_at yields no pair", find_closest_price_pair(pts, "not-a-date"), None)
check("empty points yield no pair", find_closest_price_pair([], "2026-08-28T18:00:00Z"), None)

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print("all MLB prop-grading checks passed")
