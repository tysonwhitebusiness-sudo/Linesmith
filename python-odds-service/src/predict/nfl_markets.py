"""The NFL prop market map: one definition, shared by the fitter and the pipe.

Phase 4.6. `fit_nfl_props.py` chooses the parameters and `nfl_prop_serving.py`
serves them, and the two MUST agree on which stat and which opportunity each
market is built from. Phase 5.4 of the MLB build paid for that lesson directly:
the fit and the serving path built player history from different sources and
shipped a board whose projections differed from the validated ones by a mean
0.38 shots, for a model that had never been measured as served.

Milestone schemes are deliberately absent from every `names` tuple. Phase 4.0a
classified all twenty and excluded them: 415 rows across the lot, largest 59,
none two-sided, and folding them into an ordinary market would import the
`L` vs `L-0.5` off-by-one for no gain.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class NflMarket:
    slug: str
    # The `player_game_history` keys this market settles on. More than one is
    # summed — a touchdown is receiving + rushing, and only 17,485 of 226,629
    # player-games carry both keys.
    stat_keys: tuple[str, ...]
    # The opportunity the rate is per. Summed the same way.
    volume_keys: tuple[str, ...]
    # Every spelling the archive has used for this market.
    names: tuple[str, ...]
    # The line this market is scored at when it has no per-player line to use.
    # NFL SERVES PER-PLAYER LINES (Phase 4.0c: line concentration is 7.1-14.9%
    # against MLB's 84-93%), so this is only a fallback for summary statistics,
    # never the line a board displays.
    median_line: float | None = None


MARKETS: tuple[NflMarket, ...] = (
    NflMarket(
        "receptions",
        ("receiving.receptions",), ("receiving.receivingTargets",),
        ("Total Receptions (incl. overtime)", "receptions"), 3.5,
    ),
    NflMarket(
        "receiving-yards",
        ("receiving.receivingYards",), ("receiving.receivingTargets",),
        ("Total Receiving Yards (incl. overtime)",), 49.5,
    ),
    # Carries is its own volume, and the resulting league rate of exactly 1.000
    # is not a bug. There is no sub-opportunity to divide a carry by. Making the
    # opportunity "played a game" was tried in 4.3 and measured WORSE (held-out
    # MAE 3.0915 against 2.8383), because the engine's volume_window applies to
    # VOLUME: pinning volume at 1.0 makes the window inert and forces a career
    # average. With carries as its own volume the window does real work and the
    # model becomes "project this back's recent carry load".
    NflMarket(
        "carries",
        ("rushing.rushingAttempts",), ("rushing.rushingAttempts",),
        ("Total Carries (incl. overtime)",), 10.5,
    ),
    NflMarket(
        "rushing-yards",
        ("rushing.rushingYards",), ("rushing.rushingAttempts",),
        ("Total Rushing Yards (incl. overtime)",), 44.5,
    ),
    # Anytime touchdown spans BOTH stat groups, which is why it needed its own
    # fitter. Opportunity is touches (targets + carries), which beat per-game on
    # SELECT in 4.4b (0.49674 against 0.50153).
    NflMarket(
        "anytime-td",
        ("receiving.receivingTouchdowns", "rushing.rushingTouchdowns"),
        ("receiving.receivingTargets", "rushing.rushingAttempts"),
        ("Anytime Touchdown Scorer",), 0.5,
    ),
)

BY_SLUG = {m.slug: m for m in MARKETS}
