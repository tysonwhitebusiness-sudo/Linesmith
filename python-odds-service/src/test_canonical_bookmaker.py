"""Phase 5.3 — one canonical spelling per real bookmaker.

Audit finding P3 H9: `game_odds_book_lines` held 33 distinct spellings for 22
real books, measured live 2026-08-29. `fanduel`/`FanDuel`/`Fanduel` was 750
rows split three ways. That corrupts best-price selection (the core Tier B
feature), and it is part of why 4.1's de-vig resolution rate sits at 18% —
`_two_sided_devigged_for_row` matches on bookmaker equality, so a `Fanduel`
over can never pair with a `fanduel` under.

The 33 raw spellings below are not invented for the test: they are the exact
`SELECT DISTINCT bookmaker` output from the live table before the fix, so this
asserts against what the providers really sent, not against what the alias map
happens to contain.

Pure functions only, no network and no database, so this runs in CI (Q20).

Run with:  python -u src/test_canonical_bookmaker.py
"""
import sys

sys.path.insert(0, "src")

from entity_resolution import canonical_bookmaker, normalize_bookmaker  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


# Exact `SELECT DISTINCT bookmaker FROM game_odds_book_lines` output, 2026-08-29.
LIVE_SPELLINGS = [
    "bet365.us", "BetMGM", "betmgm", "BetMGM.us", "BetOnline.ag", "betonlineag",
    "betrivers", "BetRivers", "BetUS", "betus", "bovada", "Bovada", "DraftKings",
    "draftkings", "fanatics", "fanduel", "FanDuel", "Fanduel", "kalshi", "lowvig",
    "LowVig.ag", "matchbook", "MyBookie.ag", "mybookieag", "novig", "onexbet",
    "pinnacle", "polymarket", "prophetx", "rebet", "smarkets", "tab_au", "unibet",
]


def test_live_spellings_collapse_to_22():
    print("\nthe 33 live spellings collapse to 22 real books")
    canon = {canonical_bookmaker(r) for r in LIVE_SPELLINGS}
    check("33 raw spellings in", len(LIVE_SPELLINGS), 33)
    check("22 canonical books out", len(canon), 22)
    check("nothing canonicalises to None", None in canon, False)


def test_the_specific_merges():
    print("\nthe merges that were actually splitting rows")
    for raws, expected in [
        (["fanduel", "FanDuel", "Fanduel"], "fanduel"),
        (["BetMGM", "betmgm", "BetMGM.us"], "betmgm"),
        (["BetOnline.ag", "betonlineag"], "betonline"),
        (["LowVig.ag", "lowvig"], "lowvig"),
        (["MyBookie.ag", "mybookieag"], "mybookie"),
        (["BetUS", "betus"], "betus"),
        (["bet365.us"], "bet365"),
    ]:
        for raw in raws:
            check(f"{raw!r} -> {expected!r}", canonical_bookmaker(raw), expected)


def test_betus_is_not_stripped_to_bet():
    """The one case a naive suffix strip gets wrong, and it is a real book."""
    print("\nBetUS survives the regional-suffix rule")
    check("BetUS is not 'bet'", canonical_bookmaker("BetUS"), "betus")
    check("betus is not 'bet'", canonical_bookmaker("betus"), "betus")
    # Suffix stripping must only fire when the remainder is itself a known book.
    check("'bet' alone is not a known book", normalize_bookmaker("bet"), None)


def test_unknown_books_are_kept_not_dropped():
    """The one deliberate behavioural difference from normalize_bookmaker.

    The prop path NEEDS None for an unknown book — that is what routes the row
    into `odds_unresolved` so a new book gets noticed. The game-line path has no
    such reporting, and dropping a real price from a 22-book survey because its
    spelling is new would be worse than storing it under its cleaned name.
    """
    print("\nunknown books: kept by canonical_, rejected by normalize_")
    check("normalize_ rejects an unknown book", normalize_bookmaker("BrandNewBook.us"), None)
    check("canonical_ keeps it, cleaned", canonical_bookmaker("BrandNewBook.us"), "brandnewbookus")
    check("both reject empty", (normalize_bookmaker(""), canonical_bookmaker("")), (None, None))
    check("canonical_ handles None", canonical_bookmaker(None), None)


def test_idempotent():
    """Canonicalising twice must equal canonicalising once — the write path
    applies this on every upsert, including to rows already canonical."""
    print("\nidempotence (the writer re-applies this on every upsert)")
    for raw in LIVE_SPELLINGS:
        once = canonical_bookmaker(raw)
        check(f"{raw!r} stable", canonical_bookmaker(once), once)


def main() -> bool:
    test_live_spellings_collapse_to_22()
    test_the_specific_merges()
    test_betus_is_not_stripped_to_bet()
    test_unknown_books_are_kept_not_dropped()
    test_idempotent()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
