import pytest

from oddsharvester.core.market_extraction.line_tokens import line_name_to_token
from oddsharvester.utils.sport_market_constants import Sport

FOOTBALL = Sport.FOOTBALL.value
AMERICAN_FOOTBALL = Sport.AMERICAN_FOOTBALL.value
BASKETBALL = Sport.BASKETBALL.value
ICE_HOCKEY = Sport.ICE_HOCKEY.value


@pytest.mark.parametrize(
    ("sport", "main", "name", "expected"),
    [
        (FOOTBALL, "Over/Under", "Over/Under +2.5", "over_under_2_5"),
        (FOOTBALL, "Over/Under", "Over/Under +1", "over_under_1"),
        (FOOTBALL, "Over/Under", "Over/Under +1.25", "over_under_1_25"),
        (FOOTBALL, "Asian Handicap", "Asian Handicap -0.5", "asian_handicap_-0_5"),
        (FOOTBALL, "Asian Handicap", "Asian Handicap +1", "asian_handicap_+1"),
        # American football (2026-08-26): same rendered label/format, wider real range
        # (AmericanFootballOverUnderMarket covers 1.5-60.5) — a genuinely different sport,
        # not just a relabeled football fixture.
        (AMERICAN_FOOTBALL, "Over/Under", "Over/Under +44.5", "over_under_44_5"),
        (AMERICAN_FOOTBALL, "Over/Under", "Over/Under +60.5", "over_under_60_5"),
        (AMERICAN_FOOTBALL, "Asian Handicap", "Asian Handicap -21.5", "asian_handicap_-21_5"),
        # Basketball (2026-08-26): a genuinely different token SHAPE, not just a wider range —
        # over/under has a "_games" prefix (register_basketball_markets), handicap has BOTH a
        # "_games" prefix and a "_games" suffix (BasketballAsianHandicapMarket's real values).
        (BASKETBALL, "Over/Under", "Over/Under +100.5", "over_under_games_100_5"),
        (BASKETBALL, "Over/Under", "Over/Under +215.5", "over_under_games_215_5"),
        (BASKETBALL, "Asian Handicap", "Asian Handicap -25.5", "asian_handicap_games_-25_5_games"),
        # Ice hockey (2026-08-26): new handicap enum, deliberately narrow (real NHL puck
        # line range), plain prefix-only token shape like football's.
        (ICE_HOCKEY, "Over/Under", "Over/Under +5.5", "over_under_5_5"),
        (ICE_HOCKEY, "Asian Handicap", "Asian Handicap -1.5", "asian_handicap_-1_5"),
        (ICE_HOCKEY, "Asian Handicap", "Asian Handicap +1.5", "asian_handicap_+1_5"),
    ],
)
def test_line_name_to_token_valid(sport, main, name, expected):
    assert line_name_to_token(sport, main, name) == expected


def test_line_name_to_token_unknown_line_returns_none():
    assert line_name_to_token(FOOTBALL, "Over/Under", "Over/Under +99.5") is None


def test_line_name_to_token_garbage_returns_none():
    assert line_name_to_token(FOOTBALL, "Over/Under", "not a line") is None


def test_line_name_to_token_unknown_main_market_returns_none():
    assert line_name_to_token(FOOTBALL, "1X2", "1X2") is None


def test_line_name_to_token_unknown_sport_returns_none():
    assert line_name_to_token("cricket", "Over/Under", "Over/Under +2.5") is None


def test_line_name_to_token_ice_hockey_handicap_range_is_deliberately_narrow():
    """IceHockeyAsianHandicapMarket only covers +-4.5 by design (the real NHL puck-line
    range) — a genuinely out-of-range discovered value must be dropped, not fabricated,
    same discipline as the out-of-range test for American Football."""
    assert line_name_to_token(ICE_HOCKEY, "Asian Handicap", "Asian Handicap -5.5") is None
    assert line_name_to_token(ICE_HOCKEY, "Asian Handicap", "Asian Handicap -4.5") == "asian_handicap_-4_5"


def test_line_name_to_token_checks_the_requesting_sports_own_enum():
    """Regression guard for the (sport, main_market)-keyed lookup: a line real for
    American Football (44.5, well above football's real range) must resolve under
    sport=AMERICAN_FOOTBALL but fail under sport=FOOTBALL, proving each sport is
    checked against its own enum rather than one shared table regardless of caller."""
    assert line_name_to_token(FOOTBALL, "Over/Under", "Over/Under +44.5") is None
    assert line_name_to_token(AMERICAN_FOOTBALL, "Over/Under", "Over/Under +44.5") == "over_under_44_5"
