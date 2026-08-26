"""Maps rendered Over/Under and Asian Handicap line names back to their CLI market tokens.

Inverts the formatting `SportMarketRegistry.register_football_markets`/
`register_american_football_markets`/`register_basketball_markets` apply when building
`specific_market` for each token (see `sport_market_registry.py`).

Keyed by (sport, main_market) rather than main_market alone: the rendered tab label
("Over/Under", "Asian Handicap") is shared across sports, but the valid token *values* are
not — Football's Over/Under lines top out around 6.5, American Football's around 60.5, and a
discovered American Football line checked against Football's own enum would spuriously fail
membership (or, worse, coincidentally collide with an unrelated Football line of the same
numeric value). Each sport gets its own enum as the authoritative membership check.

Token shape is also per-sport, not just per-value: Football/American Football tokens are a
plain prefix (`over_under_2_5`), but Basketball's are prefix-AND-suffix
(`asian_handicap_games_-25_5_games` — see BasketballAsianHandicapMarket) while its Over/Under
side is prefix-only with a different prefix (`over_under_games_100_5`, no suffix) — confirmed
against register_basketball_markets's own token-building code, not guessed from the
Football/American-Football pattern.
"""

from enum import Enum

from oddsharvester.utils.sport_market_constants import (
    AmericanFootballAsianHandicapMarket,
    AmericanFootballOverUnderMarket,
    BasketballAsianHandicapMarket,
    BasketballOverUnderMarket,
    FootballAsianHandicapMarket,
    FootballOverUnderMarket,
    IceHockeyAsianHandicapMarket,
    IceHockeyOverUnderMarket,
    Sport,
)

# (sport, main_market) -> (line_name prefix to strip, token prefix, token suffix, enum whose
# .value set is authoritative). token suffix is "" for every sport whose token is prefix-only.
_MARKET_CONFIG: dict[tuple[str, str], tuple[str, str, str, type[Enum]]] = {
    (Sport.FOOTBALL.value, "Over/Under"): ("Over/Under +", "over_under_", "", FootballOverUnderMarket),
    (Sport.FOOTBALL.value, "Asian Handicap"): ("Asian Handicap ", "asian_handicap_", "", FootballAsianHandicapMarket),
    (Sport.AMERICAN_FOOTBALL.value, "Over/Under"): ("Over/Under +", "over_under_", "", AmericanFootballOverUnderMarket),
    (Sport.AMERICAN_FOOTBALL.value, "Asian Handicap"): (
        "Asian Handicap ",
        "asian_handicap_",
        "",
        AmericanFootballAsianHandicapMarket,
    ),
    (Sport.BASKETBALL.value, "Over/Under"): ("Over/Under +", "over_under_games_", "", BasketballOverUnderMarket),
    (Sport.BASKETBALL.value, "Asian Handicap"): (
        "Asian Handicap ",
        "asian_handicap_games_",
        "_games",
        BasketballAsianHandicapMarket,
    ),
    (Sport.ICE_HOCKEY.value, "Over/Under"): ("Over/Under +", "over_under_", "", IceHockeyOverUnderMarket),
    (Sport.ICE_HOCKEY.value, "Asian Handicap"): (
        "Asian Handicap ",
        "asian_handicap_",
        "",
        IceHockeyAsianHandicapMarket,
    ),
}


def line_name_to_token(sport: str, main_market: str, line_name: str) -> str | None:
    """Map a rendered line name (e.g. "Over/Under +2.5") to its CLI token (e.g. "over_under_2_5").

    Returns None if `(sport, main_market)` is not a recognized umbrella market, `line_name`
    doesn't match the expected format, or the resulting token isn't a valid enum value for
    that sport.
    """
    config = _MARKET_CONFIG.get((sport, main_market))
    if config is None:
        return None

    prefix, token_prefix, token_suffix, enum_cls = config
    if not line_name.startswith(prefix):
        return None

    remainder = line_name[len(prefix) :]
    if not remainder:
        return None

    token = token_prefix + remainder.replace(".", "_") + token_suffix
    valid_values = {member.value for member in enum_cls}
    return token if token in valid_values else None
