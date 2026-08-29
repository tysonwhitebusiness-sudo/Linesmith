"""Phase 5.1 — Propline's MLB feed, folded onto real markets and real lines.

Audit finding P2 C1: "Propline's entire MLB batter-prop feed is discarded
because its market keys don't match."

WHAT THE LIVE CAPTURE ACTUALLY SHOWED (2026-08-29, propline_2 key, 45 MLB
events, 27 market keys — per 5.1's own instruction to build the map from a live
response rather than from memory):

  1. The plan's four-row alias table is REAL but INCOMPLETE. Propline offers
     eight key-encoded alt-lines, not four.

  2. The far bigger cause is not alt-lines at all: MARKET_KEY_ALIASES had NO
     `batter_*` entries. It carried bare names ("hits"), a `batting_*` prefix,
     and `pitcher_strikeouts`. Propline sends `batter_hits`, `batter_rbis`,
     `batter_home_runs`... so all twelve base batter markets AND three of the
     four pitcher markets resolved to None and every row was dropped. The only
     Propline MLB market that ever survived into prop_odds was
     `pitcher-strikeouts` — the one key that happened to already be mapped.

  3. Propline encodes a threshold in THREE places depending on the book:
     the market key ("batter_2plus_hits"), the outcome name ("2+ Total Bases"),
     or a real point field ("Over", point 0.5). Only the third was handled.

Every market key and outcome shape below is copied from that live capture, not
invented — which is the whole point of 5.1's warning.

Pure functions, no network, no database, so this runs in CI (Q20).

Run with:  python -u src/test_propline_alt_lines.py
"""
import sys

sys.path.insert(0, "src")

from entity_resolution import resolve_alt_line, resolve_market_key  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


# Every player-market key the live capture returned for MLB.
LIVE_MARKET_KEYS = [
    "batter_1plus_hits", "batter_1plus_rbis", "batter_2plus_hits",
    "batter_2plus_home_runs", "batter_2plus_rbis", "batter_3plus_hits",
    "batter_3plus_rbis", "batter_4plus_hits", "batter_doubles", "batter_hits",
    "batter_hits_runs_rbis", "batter_home_runs", "batter_rbis", "batter_runs",
    "batter_singles", "batter_stolen_bases", "batter_strikeouts",
    "batter_total_bases", "batter_triples", "batter_walks",
    "pitcher_earned_runs", "pitcher_hits_allowed", "pitcher_outs",
    "pitcher_strikeouts",
]


def test_every_live_key_resolves():
    print("\nevery market key the live feed sent now resolves")
    unresolved = [
        k for k in LIVE_MARKET_KEYS
        if resolve_alt_line(k, "Yes") is None and resolve_market_key(k) is None
    ]
    check("24 keys captured live", len(LIVE_MARKET_KEYS), 24)
    check("none left unresolved", unresolved, [])


def test_the_plans_four_rows():
    """5.1's own table, checked one at a time as its warning demands.
    "2+" is over 1.5, NOT over 2 — a 2+ bet wins on exactly 2."""
    print("\n5.1's table, verified case by case")
    check("batter_2plus_hits -> hits @ 1.5", resolve_alt_line("batter_2plus_hits", "Yes"), ("hits", 1.5))
    check("batter_3plus_hits -> hits @ 2.5", resolve_alt_line("batter_3plus_hits", "Yes"), ("hits", 2.5))
    check("batter_2plus_rbis -> rbis @ 1.5", resolve_alt_line("batter_2plus_rbis", "Yes"), ("rbis", 1.5))
    check("batter_3plus_rbis -> rbis @ 2.5", resolve_alt_line("batter_3plus_rbis", "Yes"), ("rbis", 2.5))


def test_the_four_rows_the_plan_missed():
    print("\nthe alt-lines the plan's table did not list")
    check("batter_1plus_hits -> hits @ 0.5", resolve_alt_line("batter_1plus_hits", "Yes"), ("hits", 0.5))
    check("batter_4plus_hits -> hits @ 3.5", resolve_alt_line("batter_4plus_hits", "Yes"), ("hits", 3.5))
    check("batter_1plus_rbis -> rbis @ 0.5", resolve_alt_line("batter_1plus_rbis", "Yes"), ("rbis", 0.5))
    check("batter_2plus_home_runs -> home-runs @ 1.5",
          resolve_alt_line("batter_2plus_home_runs", "Yes"), ("home-runs", 1.5))


def test_name_encoded_thresholds():
    """DraftKings puts the threshold in the OUTCOME NAME inside a base market
    key, with point=null. Live shapes, copied from the capture."""
    print("\nthresholds encoded in the outcome name, not the key")
    check("'2+ Strikeouts' in batter_strikeouts",
          resolve_alt_line("batter_strikeouts", "2+ Strikeouts"), ("batter-strikeouts", 1.5))
    check("'1+ Strikeouts' in batter_strikeouts",
          resolve_alt_line("batter_strikeouts", "1+ Strikeouts"), ("batter-strikeouts", 0.5))
    check("'2+ Total Bases' in batter_total_bases",
          resolve_alt_line("batter_total_bases", "2+ Total Bases"), ("total-bases", 1.5))
    check("'1+ Home Runs' in batter_home_runs",
          resolve_alt_line("batter_home_runs", "1+ Home Runs"), ("home-runs", 0.5))
    check("'1+ Runs' in batter_runs", resolve_alt_line("batter_runs", "1+ Runs"), ("runs", 0.5))
    check("'1+ Singles' in batter_singles", resolve_alt_line("batter_singles", "1+ Singles"), ("singles", 0.5))


def test_base_markets_are_not_mistaken_for_alt_lines():
    """A proper two-sided line already carries its own point; folding it would
    invent a duplicate proposition, which 5.1 calls worse than discarding."""
    print("\nreal two-sided lines are left alone")
    check("'Over' in batter_hits is not an alt-line", resolve_alt_line("batter_hits", "Over"), None)
    check("'Under' in batter_hits is not an alt-line", resolve_alt_line("batter_hits", "Under"), None)
    check("but the base market itself resolves", resolve_market_key("batter_hits"), "hits")
    check("'Yes' with no threshold is not an alt-line",
          resolve_alt_line("batter_hits", "Yes"), None)


def test_player_named_outcomes_are_not_guessed():
    """Bovada sends the PLAYER NAME as the outcome name with no point at all
    (key batter_home_runs, name "Ali Sanchez (NYY)", price +1100). That is
    almost certainly an anytime market — but "almost certainly" is exactly what
    5.1 warns against, because a wrong line creates a duplicate proposition at
    the wrong number. Both rules are LITERAL; nothing is inferred from a price.
    """
    print("\nambiguous player-named outcomes are NOT guessed at")
    check("player name is not read as a threshold",
          resolve_alt_line("batter_home_runs", "Ali Sanchez (NYY)"), None)
    check("nor is a name that merely contains a digit",
          resolve_alt_line("batter_hits", "Ronald Acuna Jr 2"), None)


def test_off_by_one_is_the_dangerous_case():
    """5.1: "Getting this wrong creates duplicate propositions at the wrong
    line — worse than discarding the feed." Asserted explicitly, both ways."""
    print("\nthe off-by-one that would be worse than discarding the feed")
    _, line = resolve_alt_line("batter_2plus_hits", "Yes")
    check("2+ hits is over 1.5", line, 1.5)
    check("2+ hits is NOT over 2.0", line == 2.0, False)
    _, line3 = resolve_alt_line("batter_3plus_rbis", "Yes")
    check("3+ rbis is over 2.5", line3, 2.5)
    check("3+ rbis is NOT over 3.0", line3 == 3.0, False)


def main() -> bool:
    test_every_live_key_resolves()
    test_the_plans_four_rows()
    test_the_four_rows_the_plan_missed()
    test_name_encoded_thresholds()
    test_base_markets_are_not_mistaken_for_alt_lines()
    test_player_named_outcomes_are_not_guessed()
    test_off_by_one_is_the_dangerous_case()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
