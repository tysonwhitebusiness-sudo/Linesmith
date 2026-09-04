"""predict/soccer_teams.py — Phase 3.1's club-identity map.

Pure, so the properties that matter are checkable without a database. The one
that matters most is INJECTIVITY: the fix for "one club, two names" must not
introduce "two clubs, one name". A mapping typo that sends both Manchester
clubs to the same canonical string would merge United and City into a single
team, and nothing downstream would raise — the fit would simply produce one
plausible rating for a club that does not exist. That is the exact failure 3.1
exists to prevent, reintroduced by its own fix.

Run with:  python test_soccer_teams.py
"""
import sys

from predict import soccer_teams as st

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def test_known_aliases() -> None:
    print("\nthe aliases that caused the duplication")
    check("Wolverhampton Wanderers -> Wolves",
          st.canonical("soccer_epl", "Wolverhampton Wanderers"), "Wolves")
    check("Manchester United -> Man United",
          st.canonical("soccer_epl", "Manchester United"), "Man United")
    check("Brighton & Hove Albion -> Brighton",
          st.canonical("soccer_epl", "Brighton & Hove Albion"), "Brighton")
    check("Nottingham Forest -> Nott'm Forest",
          st.canonical("soccer_epl", "Nottingham Forest"), "Nott'm Forest")
    # The accented form exists ONLY in espn_core; missing it splits Montreal.
    check("CF Montreal, accented -> unaccented",
          st.canonical("soccer_mls", "CF Montréal"), "CF Montreal")
    check("Red Bull New York -> New York Red Bulls",
          st.canonical("soccer_mls", "Red Bull New York"), "New York Red Bulls")
    check("LAFC -> Los Angeles FC",
          st.canonical("soccer_mls", "LAFC"), "Los Angeles FC")


def test_canonical_names_are_stable() -> None:
    print("\ncanonical names map to themselves — the map is idempotent")
    for sport, name in (("soccer_epl", "Wolves"), ("soccer_epl", "Man United"),
                        ("soccer_mls", "CF Montreal"), ("soccer_mls", "Los Angeles FC")):
        check(f"{name} is already canonical", st.canonical(sport, name), name)
    once = st.canonical("soccer_epl", "Wolverhampton Wanderers")
    check("applying it twice changes nothing", st.canonical("soccer_epl", once), once)


def test_injectivity() -> None:
    print("\nINJECTIVITY — no two clubs may collapse into one")
    for sport in ("soccer_epl", "soccer_mls"):
        aliases = st._ALIASES[sport]
        # Every alias must resolve to a DISTINCT club.
        targets = list(aliases.values())
        dupes = {t for t in targets if targets.count(t) > 1}
        check(f"{sport}: no two aliases share a target", sorted(dupes), [])
        # And no alias may be its own target's alias-source (a cycle).
        cycles = [k for k in aliases if k in targets]
        check(f"{sport}: no alias is also a target", cycles, [])


def test_the_manchester_case() -> None:
    print("\nthe Manchester case — a prefix is not an alias")
    # 'Manchester United' and 'Manchester City' share a prefix. Any fuzzy or
    # prefix-based matcher merges them; the explicit map must not.
    u = st.canonical("soccer_epl", "Manchester United")
    c = st.canonical("soccer_epl", "Manchester City")
    check("United and City stay separate clubs", u != c, True)
    check("United -> Man United", u, "Man United")
    check("City -> Man City", c, "Man City")


def test_exhibitions() -> None:
    print("\nexhibition sides are not clubs")
    check("MLS All-Stars excluded", st.is_excluded("MLS All-Stars"), True)
    check("Liga MX All-Stars excluded", st.is_excluded("Liga MX All-Stars"), True)
    check("either side triggers it",
          st.is_excluded("Inter Miami", "MLS All-Stars"), True)
    check("a real fixture is not excluded",
          st.is_excluded("Inter Miami", "Orlando City"), False)


def test_unknown_and_edge_cases() -> None:
    print("\nunmapped names pass through untouched")
    check("an unknown club is left alone",
          st.canonical("soccer_epl", "Some New Club"), "Some New Club")
    check("whitespace is trimmed, not treated as a new club",
          st.canonical("soccer_epl", "  Wolverhampton Wanderers  "), "Wolves")
    check("an empty name does not crash", st.canonical("soccer_epl", ""), "")
    check("a sport with no map passes through",
          st.canonical("soccer_bundesliga", "Bayern"), "Bayern")


def main() -> int:
    test_known_aliases()
    test_canonical_names_are_stable()
    test_injectivity()
    test_the_manchester_case()
    test_exhibitions()
    test_unknown_and_edge_cases()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all soccer_teams checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
