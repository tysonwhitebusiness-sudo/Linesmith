"""declared_pairs.evaluate — the Phase 1g bullet-4 gate.

The decision half is a pure function precisely so these cases can be written
without a database, including the ones that are awkward to reproduce live: a
vendor going silent, a sport going out of season, and the alias cases where the
name MATRIX declares is not the name the writer records.

Run with:  python test_declared_pairs.py
"""
import sys

import declared_pairs

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


MATRIX = {
    "mlb": ("sharpapi", "propline"),
    "cfb": ("sharpapi", "sportsgameodds"),
    "nba": ("sharpapi", "sportsgameodds"),
    "soccer_epl": ("sharpapi", "propline"),
}


def test_all_producing() -> None:
    print("\nevery declared pair produced")
    r = declared_pairs.evaluate(
        MATRIX,
        line_pairs={("mlb", "sharpapi"), ("cfb", "sharpapi"), ("cfb", "sportsgameodds"),
                    ("soccer", "sharpapi")},
        prop_providers={"propline"},
        active_sports={"mlb", "cfb", "soccer"},
    )
    check("healthy", r["healthy"], True)
    check("nba skipped as idle", r["skipped_sports"], ["nba"])
    check("no silent pairs", r["silent"], [])


def test_one_provider_goes_silent() -> None:
    print("\nTHE CFB CASE — a live sport whose other provider still produces")
    # This is the RUTGERS_NCAAF shape: SGO returns HTTP 200 with an empty list,
    # CFB keeps getting rows from sharpapi, so per-SPORT freshness stays green
    # and the sport looks entirely healthy while a provider produces nothing.
    r = declared_pairs.evaluate(
        MATRIX,
        line_pairs={("mlb", "sharpapi"), ("cfb", "sharpapi"), ("soccer", "sharpapi")},
        prop_providers={"propline"},
        active_sports={"mlb", "cfb", "soccer"},
    )
    check("unhealthy", r["healthy"], False)
    check("names the exact pair", r["silent"], ["cfb/sportsgameodds"])


def test_out_of_season_is_skipped_not_failed() -> None:
    print("\nan out-of-season sport is skipped, never failed")
    # NBA in September: nothing produces for it because there is nothing to
    # produce. Failing here would be asserting a bug, the same mistake gate10's
    # 10.3 made before it learned to SKIP.
    r = declared_pairs.evaluate(
        MATRIX,
        line_pairs={("mlb", "sharpapi")},
        prop_providers={"propline"},
        active_sports={"mlb"},
    )
    check("healthy despite nba and cfb producing nothing", r["healthy"], True)
    check("both idle sports skipped", sorted(r["skipped_sports"]), ["cfb", "nba", "soccer_epl"])


def test_aliases() -> None:
    print("\nname aliases — MATRIX's name is not always the writer's name")
    # oddsapiio records itself as 'the-odds-api'. Without the alias this reads
    # as a silent provider on every single run — a permanently red check, which
    # is the failure mode that teaches you to ignore the output.
    r = declared_pairs.evaluate(
        {"mlb": ("oddsapiio",)},
        line_pairs={("mlb", "the-odds-api")},
        prop_providers=set(),
        active_sports={"mlb"},
    )
    check("oddsapiio satisfied by 'the-odds-api'", r["healthy"], True)

    # propline_2 is the second pooled ACCOUNT, not a second provider.
    r = declared_pairs.evaluate(
        {"mlb": ("propline",)},
        line_pairs=set(),
        prop_providers={"propline_2"},
        active_sports={"mlb"},
    )
    check("propline satisfied by propline_2", r["healthy"], True)

    check("an unmapped provider aliases to itself",
          declared_pairs.aliases_for("brand_new"), ("brand_new",))


def test_props_only_provider_counts() -> None:
    print("\na props-only provider is satisfied by prop_odds alone")
    # prop_odds has no sport column, so props can only ever be asserted
    # provider-wide. A provider that writes props and no game lines must still
    # pass, or every props provider reads as silent forever.
    r = declared_pairs.evaluate(
        {"mlb": ("parlayapi",)},
        line_pairs={("mlb", "sharpapi")},
        prop_providers={"parlayapi"},
        active_sports={"mlb"},
    )
    check("parlayapi passes on props alone", r["healthy"], True)


def test_soccer_and_tennis_grain() -> None:
    print("\ncoarse sport keys — MATRIX says soccer_epl, the table says soccer")
    r = declared_pairs.evaluate(
        {"soccer_epl": ("sharpapi",), "tennis_atp": ("sharpapi",)},
        line_pairs={("soccer", "sharpapi"), ("tennis", "sharpapi")},
        prop_providers=set(),
        active_sports={"soccer", "tennis"},
    )
    check("both resolve against the coarse key", r["healthy"], True)


def main() -> int:
    test_all_producing()
    test_one_provider_goes_silent()
    test_out_of_season_is_skipped_not_failed()
    test_aliases()
    test_props_only_provider_counts()
    test_soccer_and_tennis_grain()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all declared_pairs checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
