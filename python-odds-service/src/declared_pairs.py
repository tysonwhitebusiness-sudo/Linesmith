"""Does every DECLARED (sport, provider) pair actually produce anything?

Phase 1g bullet 4 — "fail when a declared (provider, sport) pair stops
resolving. A vendor renaming a league becomes a failing check rather than a
sport going dark."

THE GAP THIS CLOSES. `check_game_odds_book_lines_freshness` is deliberately
per-SPORT, not per-(sport, source), and its docstring gives the reason: which
sources should be live for a sport changes as the provider lists change, so
hardcoding that expectation in the health check would be a second copy to drift
out of sync. That reasoning was correct when it was written and is now obsolete
— `provider_matrix.MATRIX` (Phase 1c) IS the single declaration both the jobs
and this check read. There is no second copy to drift.

Concretely, what per-sport freshness cannot see: CFB's SportsGameOdds requests
returned HTTP 200 with an empty list for months because the team id was built
from the full ESPN name (`RUTGERS_SCARLET_KNIGHTS_NCAAF`) and SGO says
`RUTGERS_NCAAF`. CFB had OddsHarvester rows the whole time, so the sport looked
healthy while one of its providers produced exactly nothing.

SELF-CALIBRATING, so it needs neither a schedule integration nor season logic.
A sport is only asserted on if it produced something from SOME provider in the
window — that is the evidence it is in season and in play. Within such a sport,
every provider MATRIX declares for it is expected to have produced too. An
out-of-season sport produces nothing from anyone, so it is skipped rather than
failed, which is the same distinction gate10's 10.3 draws.

Checks BOTH tables, because a provider legitimately produces only one kind:
`game_odds_book_lines` (game lines, per-sport via `source`) and `prop_odds`
(props, which has a `provider_id` but NO sport column, so props can only be
asserted provider-wide). A pair passes on either.
"""
from __future__ import annotations

# MATRIX names -> the strings the writers actually record. These differ for real
# reasons, not carelessness, so they are mapped rather than "fixed":
#   oddsapiio writes game lines as 'the-odds-api' (the vendor's own name; the
#     config key is named after the domain, odds-api.io).
#   sharpapi_lines is the same vendor and key as sharpapi, split in MATRIX only
#     to declare the game-lines endpoint separately from the props one.
#   propline_2 is the second pooled Propline ACCOUNT; either satisfies a
#     declared `propline`.
_SOURCE_ALIASES: dict[str, tuple[str, ...]] = {
    "oddsapiio": ("oddsapiio", "the-odds-api"),
    "sharpapi": ("sharpapi",),
    "sharpapi_lines": ("sharpapi", "sharpapi_lines"),
    "propline": ("propline", "propline_2"),
    "parlayapi": ("parlayapi",),
    "sportsgameodds": ("sportsgameodds", "sgo"),
}


def aliases_for(provider: str) -> tuple[str, ...]:
    return _SOURCE_ALIASES.get(provider, (provider,))


def evaluate(
    matrix: dict[str, tuple[str, ...]],
    line_pairs: set[tuple[str, str]],
    prop_providers: set[str],
    active_sports: set[str],
) -> dict:
    """Pure decision half — no DB, so it is directly testable.

    `line_pairs` is {(sport, source)} seen recently in game_odds_book_lines,
    `prop_providers` is {provider_id} seen recently in prop_odds, and
    `active_sports` is the sports with ANY recent production.
    """
    silent: list[str] = []
    ok_pairs = 0
    skipped_sports: list[str] = []

    for sport, providers in sorted(matrix.items()):
        # game_odds_book_lines uses a coarser key than MATRIX (one 'soccer',
        # one 'tennis'), the same grain mismatch gate10's 10.3 handles.
        coarse = ("soccer" if sport.startswith("soccer")
                  else "tennis" if sport.startswith("tennis") else sport)
        if coarse not in active_sports:
            skipped_sports.append(sport)
            continue
        for provider in providers:
            names = aliases_for(provider)
            produced = (any((coarse, n) in line_pairs for n in names)
                        or any(n in prop_providers for n in names))
            if produced:
                ok_pairs += 1
            else:
                silent.append(f"{sport}/{provider}")

    healthy = not silent
    if healthy:
        status = (f"healthy — all {ok_pairs} declared pairs produced "
                  f"({len(skipped_sports)} sport(s) idle, not asserted)")
    else:
        status = (f"{len(silent)} declared pair(s) produced NOTHING while the sport "
                  f"was live: {', '.join(silent)}")
    return {
        "name": "declaredPairsProduce",
        "healthy": healthy,
        "status": status,
        "silent": silent,
        "ok_pairs": ok_pairs,
        "skipped_sports": skipped_sports,
    }
