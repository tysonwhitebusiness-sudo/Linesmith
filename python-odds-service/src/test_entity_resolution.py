"""Permanent test suite for entity_resolution.py. Run with:
    python test_entity_resolution.py

name_normalization/market_key/bookmaker cases were separately cross-checked
against the real TS logic (lib/odds/props/entityResolution.ts) copied
verbatim into a throwaway JS script and diffed structurally — every case
here produced byte-identical output in both languages before this suite was
written, including the diacritic-stripping edge case flagged as a real
porting risk in docs/phase2-python-odds-migration-audit-2026-08-19.md.
resolve_player's roster-matching logic (dict lookups over already-verified
normalize_name output) is covered directly here instead, since it's simple
enough not to need a second-language cross-check.
"""
from entity_resolution import (
    RosterEntry,
    build_roster_index,
    normalize_bookmaker,
    normalize_name,
    resolve_market_key,
    resolve_player,
)

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def test_normalize_name():
    print("\nnormalize_name")
    check("diacritics stripped", normalize_name("José Ramírez"), "jose ramirez")
    check("suffix stripped (Jr.)", normalize_name("Ronald Acuña Jr."), "ronald acuna")
    check("suffix stripped (III)", normalize_name("Devin Williams III"), "devin williams")
    check("punctuation stripped", normalize_name("C.J. Cron"), "cj cron")
    check("apostrophe stripped", normalize_name("O'Brien Test"), "obrien test")
    check("extra whitespace collapsed", normalize_name("  Extra   Spaces  Name  "), "extra spaces name")
    check("plain ASCII name unchanged", normalize_name("Mike Trout"), "mike trout")


def test_resolve_player():
    print("\nresolve_player")
    roster = [
        RosterEntry(subject_id="1", subject_name="José Ramírez", team_abbr="CLE"),
        RosterEntry(subject_id="2", subject_name="Mike Smith", team_abbr="NYY"),
        RosterEntry(subject_id="3", subject_name="John Smith", team_abbr="NYY"),  # same last name, same team -> ambiguous
        RosterEntry(subject_id="4", subject_name="Bob Jones", team_abbr="BOS"),  # different team, same last name as none here
        RosterEntry(subject_id="5", subject_name="Aaron Judge", team_abbr="NYY"),  # only Judge on NYY -> unambiguous fallback
    ]
    index = build_roster_index(roster)

    check(
        "exact match resolves despite provider's plain-ASCII spelling",
        resolve_player("Jose Ramirez", "CLE", index).subject_id,
        "1",
    )
    check(
        "unambiguous last-name+team fallback resolves (abbreviated first name)",
        resolve_player("A. Judge", "NYY", index).subject_id,
        "5",  # "a judge" isn't an exact match, but "judge::NYY" has exactly one roster entry
    )
    check(
        "ambiguous last-name+team fallback returns None, never guesses",
        resolve_player("M. Smith", "NYY", index),
        None,  # "m smith" isn't an exact match, and "smith::NYY" has 2 candidates -> ambiguous, no guess
    )
    check(
        "team scoping prevents cross-team false match",
        resolve_player("Jones", "NYY", index),  # Bob Jones is BOS, not NYY
        None,
    )
    check(
        "unknown player returns None",
        resolve_player("Totally Unknown Player", "CLE", index),
        None,
    )
    check(
        "empty/unnormalizable name returns None",
        resolve_player("123", "CLE", index),
        None,
    )


def test_resolve_market_key():
    print("\nresolve_market_key")
    check("exact key (SharpAPI style)", resolve_market_key("hits"), "hits")
    check("exact key with spaces (Odds-API.io style)", resolve_market_key("Total Bases"), "total-bases")
    check("case-insensitive + underscore fallback", resolve_market_key("BATTING_HITS+RUNS+RBI"), "hits-runs-rbis")
    check("space-normalized fallback", resolve_market_key("Runs Batted In"), "rbis")
    check("NFL market resolves", resolve_market_key("Pass Yards"), "passing-yards")
    check("NFL market, underscore variant", resolve_market_key("passing_yards"), "passing-yards")
    check("whitespace-trimmed", resolve_market_key("  hits  "), "hits")
    check("unmapped market returns None, never guesses", resolve_market_key("unmapped_nonsense_key"), None)
    check(
        "removed-whitespace fallback tier (third tier specifically)",
        resolve_market_key("TOTALBASES"),
        None,  # confirms this does NOT falsely match "total bases" — no third-tier collision for this one
    )


def test_normalize_bookmaker():
    print("\nnormalize_bookmaker")
    check("exact lowercase", normalize_bookmaker("draftkings"), "draftkings")
    check("mixed case + internal space stripped", normalize_bookmaker("Bet MGM"), "betmgm")
    check("parenthetical alias", normalize_bookmaker("Pick6 (DraftKings)"), "pick6")
    check("spaced multi-word alias", normalize_bookmaker("Hard Rock Bet"), "hardrockbet")
    check("leading/trailing whitespace", normalize_bookmaker("  Caesars  "), "caesars")
    check("unmapped bookmaker returns None, never guesses", normalize_bookmaker("unknown_book_xyz"), None)


def main():
    test_normalize_name()
    test_resolve_player()
    test_resolve_market_key()
    test_normalize_bookmaker()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = main()
    raise SystemExit(0 if ok else 1)
