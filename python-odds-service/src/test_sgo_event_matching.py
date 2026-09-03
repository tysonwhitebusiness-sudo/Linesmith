"""SportsGameOdds event->game matching, and the NCAAF bug it fixes.

THE BUG. fetch_sportsgameodds used to build a teamID from the full ESPN team
name and filter the API by it:

    SGO has        RUTGERS_NCAAF                   UMASS_NCAAF
    we asked for   RUTGERS_SCARLET_KNIGHTS_NCAAF   MASSACHUSETTS_MINUTEMEN_NCAAF

SGO uses the school name for NCAAF; ESPN includes the mascot. Every CFB request
ever made returned HTTP 200 with an empty list -- no error, no warning, just
zero rows. Measured live 2026-09-03: 0 events, 0 game lines from 178 requests.
After the fix, one request returned 100 events, 761 props and 2,747 game lines
across 8 books.

MLB and NFL were never affected -- both sides spell those WITH the mascot
(PITTSBURGH_PIRATES_MLB, SEATTLE_SEAHAWKS_NFL). That is exactly why it survived:
the bug bites only the league whose naming convention differs.

Run with:  python test_sgo_event_matching.py
"""
import sys

from game_context import Game
from providers import _sgo_event_matches

_failures = 0


def check(label, actual, expected):
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def ev(home, away):
    return {"teams": {"home": {"names": {"long": home}}, "away": {"names": {"long": away}}}}


def game(home, away, sport="cfb"):
    return Game(sport, "g1", away, home, "A", "H", "2026-09-03")


def test_ncaaf_short_names_match():
    print("\nNCAAF — SGO's school name vs ESPN's school + mascot")
    check("Rutgers / UMass fixture",
          _sgo_event_matches(ev("Rutgers", "UMass"),
                             game("Rutgers Scarlet Knights", "UMass Minutemen")), True)
    check("Wake Forest / Akron",
          _sgo_event_matches(ev("Wake Forest", "Akron"),
                             game("Wake Forest Demon Deacons", "Akron Zips")), True)
    check("Bethune-Cookman hyphen survives",
          _sgo_event_matches(ev("Bethune-Cookman", "Delaware"),
                             game("Bethune-Cookman Wildcats", "Delaware Blue Hens")), True)
    check("Southern Illinois multiword",
          _sgo_event_matches(ev("Southern Illinois", "Samford"),
                             game("Southern Illinois Salukis", "Samford Bulldogs")), True)


def test_mlb_and_nfl_still_match_exactly():
    """These already worked. The subset fallback must not have broken them."""
    print("\nMLB / NFL — the leagues that were never affected")
    check("MLB full names",
          _sgo_event_matches(ev("Pittsburgh Pirates", "San Francisco Giants"),
                             game("Pittsburgh Pirates", "San Francisco Giants", "mlb")), True)
    check("NFL full names",
          _sgo_event_matches(ev("Seattle Seahawks", "New England Patriots"),
                             game("Seattle Seahawks", "New England Patriots", "nfl")), True)


def test_wrong_game_is_refused():
    """The whole reason the fallback requires BOTH sides. Attaching odds to the
    wrong game is worse than attaching none -- the same argument _team_match
    gives for refusing harvester's one-sided containment fallback."""
    print("\nrefusals — a half-match must not attach")
    check("one side right, one side wrong",
          _sgo_event_matches(ev("Rutgers", "Akron"),
                             game("Rutgers Scarlet Knights", "UMass Minutemen")), False)
    check("both sides wrong",
          _sgo_event_matches(ev("Delaware", "Samford"),
                             game("Rutgers Scarlet Knights", "UMass Minutemen")), False)
    check("empty names refuse rather than match everything",
          _sgo_event_matches(ev("", ""), game("Rutgers Scarlet Knights", "UMass Minutemen")), False)
    check("missing teams block",
          _sgo_event_matches({}, game("Rutgers Scarlet Knights", "UMass Minutemen")), False)


def test_subset_direction_is_not_reversed():
    """SGO's name must be a subset of OURS, not the other way round. Reversed,
    'Rutgers Scarlet Knights' from SGO would match a game against plain
    'Rutgers' -- and more dangerously, a generic SGO name would match many
    games."""
    print("\ndirection — ours may be longer, theirs may not")
    check("theirs shorter: matches",
          _sgo_event_matches(ev("Rutgers", "Akron"),
                             game("Rutgers Scarlet Knights", "Akron Zips")), True)
    check("theirs longer: refused",
          _sgo_event_matches(ev("Rutgers Scarlet Knights Extra", "Akron Zips Extra"),
                             game("Rutgers", "Akron")), False)


def test_known_residual_is_documented_not_guessed():
    """An abbreviation sharing no word with the full name still misses. That is
    a real limit, counted by the caller's `matched/total` warning rather than
    papered over with a fuzzy match that could attach the wrong game."""
    print("\nknown residual — abbreviation with no shared word")
    check("UMass vs Massachusetts Minutemen still misses",
          _sgo_event_matches(ev("Rutgers", "UMass"),
                             game("Rutgers Scarlet Knights", "Massachusetts Minutemen")), False)


if __name__ == "__main__":
    test_ncaaf_short_names_match()
    test_mlb_and_nfl_still_match_exactly()
    test_wrong_game_is_refused()
    test_subset_direction_is_not_reversed()
    test_known_residual_is_documented_not_guessed()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
