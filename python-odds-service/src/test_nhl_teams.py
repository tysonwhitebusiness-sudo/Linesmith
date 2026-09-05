"""predict/nhl_teams.py — Phase 4.1's franchise-identity map.

THE INVARIANT IS DIFFERENT FROM SOCCER'S, and that is the thing to get right.
`test_soccer_teams` asserts INJECTIVITY — no two aliases may share a target —
because there, two names meaning one club was always an error. Here six names
map to 'Utah' ON PURPOSE:

    Phoenix -> Arizona -> Utah Hockey Club -> Utah Mammoth

That is one franchise across a rename, a relocation and another rename, and
merging them is the decision Phase 4.1 recorded rather than a mistake. So the
test cannot be "targets are unique". It has to be "every collision is one of the
declared franchise-continuity groups, and nothing else collides".

The failure this guards against is unchanged in spirit: a mapping error that
silently merges two real franchises produces a plausible rating for a team that
does not exist, raises nothing, and cannot be caught downstream.

Run with:  python test_nhl_teams.py
"""
import sys

from predict import nhl_teams as nt

_failures = 0

# The ONLY places multiple names may legitimately collapse to one franchise.
DECLARED_MERGES = {
    "Utah": {"Phoenix", "Arizona", "Arizonas", "Arizona Coyotes",
             "Utah Hockey Club", "Utah Mammoth"},
    "Winnipeg": {"Atlanta", "Winnipeg Jets", "WinnipegJets"},
}


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def test_conventions() -> None:
    print("\ntwo sources, two conventions")
    check("espn full name -> city", nt.canonical("Boston Bruins"), "Boston")
    check("Los Angeles Kings -> Los Angeles",
          nt.canonical("Los Angeles Kings"), "Los Angeles")
    check("New York Rangers -> NY Rangers",
          nt.canonical("New York Rangers"), "NY Rangers")
    check("a city name is already canonical", nt.canonical("Boston"), "Boston")


def test_whitespace_and_typos() -> None:
    print("\nwhitespace variants and a typo, inside ONE source")
    for bad, good in (("LosAngeles", "Los Angeles"), ("NewJersey", "New Jersey"),
                      ("NYRangers", "NY Rangers"), ("NYIslanders", "NY Islanders"),
                      ("SanJose", "San Jose"), ("St.Louis", "St. Louis"),
                      ("TampaBay", "Tampa Bay")):
        check(f"{bad} -> {good}", nt.canonical(bad), good)
    check("three Seattle spellings collapse",
          {nt.canonical(x) for x in ("Seattle", "Seattle Kraken", "SeattleKraken")},
          {"Seattle"})
    check("'Arizonas' is a typo, not a franchise", nt.canonical("Arizonas"), "Utah")


def test_franchise_continuity() -> None:
    print("\nFRANCHISE CONTINUITY — deliberate merges, recorded in 4.1")
    for name in DECLARED_MERGES["Utah"]:
        check(f"{name} -> Utah", nt.canonical(name), "Utah")
    check("Atlanta -> Winnipeg (2011 relocation)", nt.canonical("Atlanta"), "Winnipeg")


def test_every_alias_is_explainable() -> None:
    print("\nNOTHING COLLIDES BY ACCIDENT — the soccer injectivity test, adapted")
    # Soccer could assert "no two aliases share a target". NHL cannot: six names
    # map to 'Utah' deliberately. And every franchise legitimately has TWO
    # aliases anyway — an espn full name ('Los Angeles Kings') and an sbr
    # whitespace variant ('LosAngeles') — so counting collisions proves nothing.
    #
    # The invariant that does hold: an alias is either a SPELLING VARIANT of its
    # own canonical (squashed, it starts with the squashed canonical) or a
    # DECLARED franchise merge. Anything else is an accidental collision — a
    # typo mapping 'Boston Bruins' to 'Buffalo' would be caught here, where a
    # collision count would not notice.
    def squash(x: str) -> str:
        # 'New York' -> 'NY' is a real abbreviation the sources both use, so it
        # is normalised rather than exempted — exempting the pair would also
        # exempt a typo hiding behind it.
        return (x.lower().replace("new york", "ny")
                 .replace(" ", "").replace(".", ""))

    unexplained = {}
    for src, dst in nt._ALIASES.items():
        if squash(src).startswith(squash(dst)):
            continue                                   # spelling / nickname variant
        if src in DECLARED_MERGES.get(dst, set()):
            continue                                   # recorded franchise merge
        unexplained[src] = dst
    check("every alias is a spelling variant or a declared merge", unexplained, {})

    # And the declared merges must actually be the ones we think they are.
    check("Utah absorbs exactly the six Phoenix/Arizona/Utah spellings",
          {k for k, v in nt._ALIASES.items() if v == "Utah"},
          DECLARED_MERGES["Utah"])


def test_distinct_franchises_stay_distinct() -> None:
    print("\nprefix pairs are different franchises")
    check("NY Rangers != NY Islanders",
          nt.canonical("New York Rangers") != nt.canonical("New York Islanders"), True)
    for a, b in (("Boston Bruins", "Buffalo Sabres"),
                 ("Colorado Avalanche", "Columbus Blue Jackets"),
                 ("Minnesota Wild", "Montreal Canadiens"),
                 ("San Jose Sharks", "St. Louis Blues")):
        check(f"{a} != {b}", nt.canonical(a) != nt.canonical(b), True)


def test_exclusions() -> None:
    print("\nnational sides and All-Star rosters are not clubs")
    for n in ("Canada", "Finland", "Sweden", "USA"):
        check(f"{n} excluded (4 Nations Face-Off)", nt.is_excluded(n), True)
    for n in ("Team Hughes", "Team MacKinnon", "Team Matthews", "Team McDavid"):
        check(f"{n} excluded (All-Star Game)", nt.is_excluded(n), True)
    check("either side triggers it", nt.is_excluded("Boston", "Canada"), True)
    check("a real fixture is not excluded", nt.is_excluded("Boston", "Toronto"), False)


def test_edges() -> None:
    print("\nedge cases")
    check("unknown name passes through", nt.canonical("Hartford"), "Hartford")
    check("whitespace trimmed", nt.canonical("  Boston Bruins  "), "Boston")
    check("empty name does not crash", nt.canonical(""), "")
    check("idempotent", nt.canonical(nt.canonical("Utah Mammoth")), "Utah")


def main() -> int:
    test_conventions()
    test_whitespace_and_typos()
    test_franchise_continuity()
    test_every_alias_is_explainable()
    test_distinct_franchises_stay_distinct()
    test_exclusions()
    test_edges()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all nhl_teams checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
