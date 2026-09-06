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
# cannot differ from it, because the buffer does not keep more.
#
# RAISED FROM 40 TO 200 BY THE PHASE 5 AUDIT. 40 was inherited from NHL, where
# it is half a season and generous. In MLB it is a quarter of one, and the audit
# found EVERY fitted market pinned at volume_window=40 — the fit asking for more
# volume history than the buffer could hold, and being silently capped. A ceiling
# the model is always pressed against is not a ceiling that was chosen, it is one
# that was inherited.
#
# The cost is bounded and small: 200 floats per player per market. The identity
# with `nhl_props` is unaffected because that comparison only ever requests
# windows of 40 or fewer, and the last 40 of 200 are the same 40.
MAX_RECENT = 200


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


def binom_prob_over(line: float, trials: float, p: float) -> float:
    """P(count > line) under Binomial(trials, p).

    THE SHAPE GRID ONLY WENT ONE WAY WITHOUT THIS, and half of MLB needs the
    other. Negative binomial spans variance >= mean and converges to Poisson at
    the bottom, so a stat whose variance is BELOW its mean has no reachable
    shape. Measured over 425,778 MLB player-games with 3+ plate appearances:

        hits          mean 0.9292   var 0.7932   var/mean 0.854   UNDER-dispersed
        total bases   mean 1.5479   var 3.2798   var/mean 2.119   over-dispersed
        home runs     mean 0.1337   var 0.1343   var/mean 1.004   ~Poisson

    Hits are under-dispersed for a structural reason, not a statistical accident:
    a batter cannot get more hits than plate appearances, so the count is
    BOUNDED and Binomial(PA, rate) has variance mean*(1-p) < mean. NHL never
    needed this because shots on goal have no such ceiling.

    `trials` is the projected volume and is fractional, so it is rounded to the
    nearest whole chance — a player projected for 3.6 plate appearances is
    modelled as getting 4. The alternative (a continuous beta-binomial) buys
    precision the calibration tolerance cannot see.
    """
    n = max(1, int(round(trials)))
    p = min(1.0 - 1e-12, max(1e-12, p))
    k = int(math.floor(line))
    if k >= n:
        return 0.0                      # cannot exceed the number of chances
    cum, term = 0.0, (1.0 - p) ** n
    for i in range(k + 1):
        if i:
            term *= (n - i + 1) / i * (p / (1.0 - p))
        cum += term
    return max(0.0, min(1.0, 1.0 - cum))


# The shape grid, as (kind, parameter). Every entry is reachable and the two
# ends are genuine limits rather than truncations: 'binomial' is the maximally
# under-dispersed bounded shape, and ('nb', 1e6) is the Poisson limit.
SHAPES: list[tuple[str, float | None]] = (
    [("binomial", None)]
    + [("nb", d) for d in (1.0, 2.0, 4.0, 8.0, 20.0)]
    + [("nb", 1e6)]            # Poisson
)


def shape_prob_over(kind: str, param: float | None, line: float,
                    mean: float, trials: float) -> float:
    """One entry point for every shape, so a caller cannot pick the wrong form."""
    if kind == "binomial":
        # p is events per chance; mean = trials * p, so recover p from them.
        return binom_prob_over(line, trials, mean / max(1e-9, trials))
    return nb_prob_over(line, mean, param if param is not None else 1e6)


def shape_label(kind: str, param: float | None) -> str:
    if kind == "binomial":
        return "binomial"
    return "Poisson" if (param or 0) > 1e5 else f"nb({param:g})"


def platt(p: float, a: float, b: float) -> float:
    """Two-parameter Platt scaling: sigmoid(a * logit(p) + b).

    TEMPERATURE IS THE a-ONLY SPECIAL CASE, AND IT CANNOT FIX A BIAS. `temper`
    is sigmoid(logit(p)/T), i.e. a=1/T and b=0. That rotates the calibration
    curve about p=0.5, so it corrects OVERCONFIDENCE — which is what NHL needed,
    where the model was too sharp. It cannot SHIFT the curve, so a model that is
    wrong in one direction everywhere stays wrong.

    MLB's failure mode is the other one. Measured on hits, held out, after
    temperature: every calibration bucket at every line was off in the SAME
    direction, the model under-predicting throughout —

        line 0.5   pred 0.3-0.4 -> actual 0.443   (+0.093)
                   pred 0.4-0.5 -> actual 0.513   (+0.063)
                   pred 0.5-0.6 -> actual 0.577   (+0.027)
        line 1.5   pred 0.1-0.2 -> actual 0.299   (+0.149)
                   pred 0.2-0.3 -> actual 0.310   (+0.060)

    A uniform positive gap is a shift, and only `b` can absorb it. The fit tries
    both forms and keeps whichever wins on SELECT, so a sport that needs only
    temperature is not charged a second parameter for nothing.
    """
    lo = math.log(max(1e-12, p) / max(1e-12, 1.0 - p))
    return 1.0 / (1.0 + math.exp(-(a * lo + b)))


def fit_platt(rows, iters: int = 60) -> tuple[float, float]:
    """Fit (a, b) by coordinate descent on log-loss. `rows` is [(p, hit)].

    Deliberately a small grid-refinement rather than a gradient solver: the
    surface is smooth and two-dimensional, and this has no convergence failure
    mode to diagnose at three in the morning.
    """
    def loss(a: float, b: float) -> float:
        t = 0.0
        for p, hit in rows:
            q = platt(p, a, b)
            t -= math.log(max(1e-12, q if hit else 1.0 - q))
        return t / max(1, len(rows))

    a, b = 1.0, 0.0
    span_a, span_b = 1.0, 1.0
    best = loss(a, b)
    for _ in range(iters):
        improved = False
        for da in (-span_a, span_a):
            c = loss(a + da, b)
            if c < best:
                best, a, improved = c, a + da, True
        for db in (-span_b, span_b):
            c = loss(a, b + db)
            if c < best:
                best, b, improved = c, b + db, True
        if not improved:
            span_a *= 0.5
            span_b *= 0.5
            if span_a < 1e-4:
                break
    return a, b


def calibration(rows, n_floor: int = 200) -> dict:
    """Calibration of corrected probabilities. `rows` is [(prob, hit)].

    TWO BUGS IN THE METRIC THIS REPLACES, both found on MLB hits and both of
    which also affected the NHL verdicts:

    1. IT COMPARED ACTUAL TO THE BUCKET MIDPOINT, not to what the model actually
       predicted. A bucket holding predictions averaging 0.177 was scored against
       0.15 simply because that is where the bin's centre falls, charging the
       model 0.027 for the binning. Calibration is |predicted - actual|, and the
       predicted value is known exactly.

    2. THE BUCKET FLOOR WAS n >= 40, which is noise for a proportion. At n=45 a
       true rate of 0.30 has a 95% interval of roughly +/-0.14, so a single
       sparse bucket could dominate the verdict. On MLB hits exactly that
       happened: full Platt improved ECE from 0.0226 to 0.0140 and improved
       EVERY substantial bucket, while the reported "worst gap" got WORSE
       (0.149 -> 0.250) on the strength of one 45-row bin.

    Both numbers are returned, because they answer different questions. ECE is
    the n-weighted average error and is what "is this calibrated?" normally
    means. `worst` is the largest error in any bucket with real support, and
    catches a model that is fine on average while badly wrong somewhere
    specific.
    """
    buckets: dict[int, list] = {}
    for p, hit in rows:
        buckets.setdefault(min(9, int(p * 10)), []).append((p, hit))
    total = sum(len(v) for v in buckets.values())
    ece, worst, worst_n, table = 0.0, 0.0, 0, []
    for b in sorted(buckets):
        v = buckets[b]
        pred = sum(p for p, _ in v) / len(v)
        act = sum(1 for _, h in v if h) / len(v)
        gap = abs(pred - act)
        ece += len(v) / total * gap
        table.append({"bucket": b / 10, "n": len(v), "pred": pred,
                      "actual": act, "gap": gap})
        if len(v) >= n_floor and gap > worst:
            worst, worst_n = gap, len(v)
    return {"ece": ece, "worst": worst, "worst_n": worst_n,
            "table": table, "n": total}
