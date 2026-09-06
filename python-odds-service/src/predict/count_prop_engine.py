"""Phase 5.3 — the sport-agnostic count-prop engine: volume x rate x shape.

EXTRACTED RATHER THAN COPIED. `nhl_props.py` grew this engine first and it works
— five NHL markets rank on it. Writing a second copy for MLB is how two
implementations of one idea drift apart until nobody notices they disagree, the
same failure the sport-adapter convention exists to prevent on the frontend
(CLAUDE.md).

NHL IS NOT MIGRATED IN THIS COMMIT, ON PURPOSE. Its numbers are measured,
persisted and serving a live board; rewriting the code underneath a verified
result to make a refactor tidy is how a verified result stops being one.
`test_count_prop_engine.py` asserts this engine and `nhl_props` agree exactly on
the same inputs — bit-identical for `shrunk_rate`, `PlayerHistory` and `project`,
and within a measured 2.72e-6 at the Poisson limit, where this engine takes the
exact limit and `nhl_props` approximates it. So the migration is a safe
mechanical step whenever it is wanted, and a divergence fails a test rather than
passing silently.

THAT TEST ALREADY EARNED ITS KEEP. `nhl_props.shrunk_rate` hard-codes a divisor
of 18.0 to convert minutes into games-equivalent before shrinking, which makes
`k` a number of GAMES. The first version of this engine shrank on raw volume, so
the same `k` would have meant "10 minutes" in NHL and "10 plate appearances" in
MLB — a thirtyfold difference in shrinkage, and a grid tuned on one sport would
have been meaningless on the other. The test failed on every draw until the
divisor became a parameter.

THE THREE PIECES, and why they are separate:

  VOLUME  how many chances the player gets. Ice time in NHL, plate appearances
          in MLB, outs recorded for a pitcher. This is a ROLE, and roles change
          within days — a promotion up the batting order moves it more than any
          change in skill. Estimated over a SHORT recent window.

  RATE    events per chance. This is a SKILL and it is comparatively stable, so
          it wants all the history available, shrunk toward a league baseline by
          n/(n+k) so a five-game sample does not read as a career.

  SHAPE   the distribution around the expected count, applied at the line. Not
          part of the projection itself, which is why the board can rank on a
          projection whose shape has not earned a probability.

Estimating volume and rate over DIFFERENT windows is the whole point and was
measured in NHL 4.5: averaging a player's ice time across a season smooths away
exactly the change that matters most.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# How many recent games the volume window may hold. A window longer than this
# cannot be requested because the buffer does not keep more, which makes the
# grid's upper end a structural ceiling rather than an arbitrary one.
MAX_RECENT = 40


class PlayerHistory:
    """Running, strictly-before-only history for one player in one market."""

    __slots__ = ("events", "volume", "games", "recent_volume")

    def __init__(self) -> None:
        self.events = 0.0
        self.volume = 0.0
        self.games = 0
        self.recent_volume: list[float] = []

    def add(self, events: float, volume: float) -> None:
        self.events += events
        self.volume += volume
        self.games += 1
        self.recent_volume.append(volume)
        if len(self.recent_volume) > MAX_RECENT:
            self.recent_volume.pop(0)

    def mean_volume(self, league_volume: float, window: int = 0) -> float:
        """Mean chances per game. `window` 0 uses all history, N the last N."""
        if not self.games:
            return league_volume
        if window and self.recent_volume:
            w = self.recent_volume[-window:]
            return sum(w) / len(w)
        return self.volume / self.games


def shrunk_rate(player_events: float, player_volume: float,
                league_rate: float, k: float, volume_per_game: float) -> float:
    """Events per chance, pulled toward the league baseline by n/(n+k).

    `k` IS IN UNITS OF GAMES, NOT RAW VOLUME, and `volume_per_game` is what
    converts between them. This is not cosmetic: shrinking on raw volume would
    make k mean "10 minutes" in NHL and "10 plate appearances" in MLB — a
    thirtyfold difference in how much shrinkage the same number produces, so a
    grid value tuned on one sport would be meaningless on the other.

    `nhl_props.shrunk_rate` hard-codes the divisor as 18.0 ("18 min ~ one
    regular's game"). That constant is NHL's, not the engine's, so it becomes a
    parameter here. The identity test caught this: the two implementations
    disagreed on every draw until the divisor was passed in.

    Weighting by GAMES-worth of chances rather than raw chances also stops a
    player with many short appearances reading as more certain than one with a
    few long ones.

    k=0 is no shrinkage at all — a genuine floor, not a truncated grid edge.
    """
    if player_volume <= 0:
        return league_rate
    own = player_events / player_volume
    games_equiv = player_volume / max(1e-9, volume_per_game)
    w = games_equiv / (games_equiv + k) if (games_equiv + k) > 0 else 1.0
    return w * own + (1.0 - w) * league_rate


@dataclass
class Projection:
    expected: float
    projected_volume: float
    rate_per_chance: float
    games_of_history: int


def project(hist: PlayerHistory, league_rate: float, league_volume: float,
            k: float = 10.0, volume_window: int = 0,
            multiplier: float = 1.0,
            volume_per_game: float | None = None) -> Projection:
    """Volume x rate, with an optional environment multiplier.

    `multiplier` is where a park factor enters for MLB. It scales the RATE, not
    the volume: a hitters' park makes each plate appearance more productive, it
    does not grant more plate appearances. NHL passes 1.0 and is unaffected.

    `volume_per_game` defaults to `league_volume`, which is the right default —
    the league mean IS one game's worth of chances — so a caller only overrides
    it to reproduce a legacy constant.
    """
    vol = hist.mean_volume(league_volume, volume_window)
    per_game = league_volume if volume_per_game is None else volume_per_game
    rate = shrunk_rate(hist.events, hist.volume, league_rate, k, per_game) * multiplier
    return Projection(expected=vol * rate, projected_volume=vol,
                      rate_per_chance=rate, games_of_history=hist.games)


def nb_prob_over(line: float, mean: float, dispersion: float) -> float:
    """P(count > line) under a negative binomial with the given mean.

    `dispersion` is the NB size parameter: variance = mean + mean^2/dispersion.
    A large value converges to Poisson, so 1e6 is the Poisson limit and a
    genuine endpoint of any search grid rather than a truncation.

    THIS TAKES THE EXACT POISSON LIMIT WHERE `nhl_props` APPROXIMATES IT.
    `nhl_props.nb_prob_over` has no Poisson branch: it evaluates the negative
    binomial at r=1e6, which converges to Poisson but is not it. The two differ,
    and the size of the difference was measured across 4,000 random
    (line, mean, dispersion) draws rather than assumed:

        max absolute difference   2.72e-6  (4,000 random draws)
        typical difference        below 1e-8

    That is four orders of magnitude below the calibration tolerance the gates
    use (0.05) and three below the precision anything is reported to, so it
    changes no verdict. The exact form is kept because it is the correct one and
    because an approximation nobody remembers is an approximation that surprises
    somebody later. `test_count_prop_engine.py` asserts the bound rather than
    asserting an equality that is not true.
    """
    if mean <= 0:
        return 0.0                            # same as nhl_props: impossible event
    if dispersion > 1e5:                      # Poisson
        k = math.floor(line)
        cum, term = 0.0, math.exp(-mean)
        for i in range(int(k) + 1):
            if i:
                term *= mean / i
            cum += term
        return max(0.0, min(1.0, 1.0 - cum))
    r = dispersion
    p = r / (r + mean)
    k = int(math.floor(line))
    cum, term = 0.0, p ** r
    for i in range(k + 1):
        if i:
            term *= (r + i - 1) / i * (1.0 - p)
        cum += term
    return max(0.0, min(1.0, 1.0 - cum))


def temper(p: float, t: float) -> float:
    """Temperature scaling in logit space — single-parameter Platt (a=1/T, b=0).

    Named for what it is so a reader knows ONE parameter was fitted, not two.
    """
    lo = math.log(max(1e-12, p) / max(1e-12, 1.0 - p)) / t
    return 1.0 / (1.0 + math.exp(-lo))
