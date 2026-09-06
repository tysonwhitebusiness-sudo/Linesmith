"""Direct port of lib/sports/mlb/homeRunModel.ts — not a reimplementation.

Home Run model — standalone fitted regression, `market = 'home-run'` in
`model_weights`. Extends a Beta-Binomial `home-runs` posterior (now
`beta_binomial_hr_prob` below) with three signals absent from it: park
factor, an explicit pitcher-vs-batter matchup blend, and
lineup-order/expected-PA.

**Phase 1.1 (2026-09-06)** — the posterior used to come from
`edge_model.py`, which was deleted as part of the condemned scoring layer.
Only home runs still needed it, so rather than keeping a 118-line
general-purpose module alive for one caller, the ~20 lines this model
actually uses were specialised to home runs and moved here. What was
dropped in the move: the per-market `PRIOR_STRENGTH` table (only the
`home-runs` entry, 50, survives as a constant), the `recent_over_count`
L10 re-weighting (the historical HR builder never passed it), and the
`ModelProbabilityInput`/`Result` dataclasses that existed to carry those.
The arithmetic that remains is unchanged, and `test_home_run_model.py`
pins it.

This posterior is still the same hand-set, never-fitted prior the deleted
module disclosed. Phase 3.2 of `docs/master-plan-2026-09-06.md` owns the
question of whether the home-run model is testable at all — its archive
ends 2025-11-02, so the season split currently leaves no held-out rows.
Nothing here should be treated as validated until that is answered.

Combined the same way the game model's Moneyline/Totals are: raw signals as
named features, `fit_logistic_regression` (home_run_model_fit.py) learns the
weights from real history, `activated = holdoutBrier < baselineHoldoutBrier`
decides whether a version goes live. This file only builds the raw feature
functions — pure, no DB/network access — so they're identical whether
called from the historical training builder or the live path.
"""
import math
from dataclasses import dataclass

from predict.logistic_regression import predict_prob

# Same feature order as HOME_RUN_FEATURE_NAMES in home_run_model_fit.py —
# shared so training and live prediction can never drift apart.
HOME_RUN_FEATURE_NAMES: tuple[str, ...] = ("betaBinomialHrProb", "parkHrFactorCentered", "pitcherMatchupSignal", "expectedPaCentered")


# Effective prior sample size for home runs — how many "pseudo-games" of
# league-average behavior the prior is worth before real data takes over.
# 50, deliberately strong: a batter going 2-for-5 on home runs this month is
# not actually a 40% home run hitter, and a weak prior would let a tiny
# sample say so. Carried unchanged from the deleted edge_model.PRIOR_STRENGTH.
HR_PRIOR_STRENGTH = 50.0

# How hard the matchup nudges the prior mean before real data is applied.
# Scaled by mean*(1-mean) so the shift is naturally smaller near 0 or 1 and
# larger near 0.5. Bounded to keep a single matchup signal from dominating
# the league rate.
MATCHUP_SHIFT_WEIGHT = 0.35


def shifted_prior_mean(league_rate: float, favorable: bool | None) -> float:
    if favorable is None:
        return league_rate
    direction = 1 if favorable else -1
    shift = MATCHUP_SHIFT_WEIGHT * direction * league_rate * (1 - league_rate)
    return min(0.97, max(0.03, league_rate + shift))


@dataclass
class BetaBinomialHrPosterior:
    prob: float
    std_dev: float
    sample_size: float
    prior_mean: float
    prior_strength: float


def beta_binomial_hr_prob(
    league_rate: float,
    over_count: float,
    total_count: float,
    matchup_favorable: bool | None = None,
) -> BetaBinomialHrPosterior:
    """The trailing-rate posterior that feeds this model's first feature.

    Conjugate Beta prior on a Bernoulli rate, so the posterior after
    observing real games is closed-form. The prior's center is the real
    league home-run rate; `over_count`/`total_count` are the batter's own
    games with a home run, out of games played.
    """
    prior_mean = shifted_prior_mean(league_rate, matchup_favorable)
    alpha = prior_mean * HR_PRIOR_STRENGTH + over_count
    beta = (1 - prior_mean) * HR_PRIOR_STRENGTH + max(0.0, total_count - over_count)
    total_ab = alpha + beta
    mean = alpha / total_ab
    variance = (alpha * beta) / (total_ab * total_ab * (total_ab + 1))
    return BetaBinomialHrPosterior(
        prob=mean,
        std_dev=math.sqrt(variance),
        sample_size=total_count,
        prior_mean=prior_mean,
        prior_strength=HR_PRIOR_STRENGTH,
    )


def park_hr_factor_centered(park_factor: float) -> float:
    """Park factor as a regression feature. Reuses park_factors.py's
    existing factor directly — NOT an HR-specific venue factor, a disclosed
    v1 simplification (see the TS source's own header comment). `1.0`
    (neutral) in, `0` out."""
    return park_factor - 1


def _clamp_rate(rate: float) -> float:
    """Keeps a rate strictly inside (0, 1) so log-odds below never divide
    by zero or take log(0)."""
    return min(0.999, max(0.001, rate))


def _log_odds(rate: float) -> float:
    r = _clamp_rate(rate)
    return math.log(r / (1 - r))


def pitcher_matchup_signal(pitcher_hr_rate_allowed: float, league_hr_rate: float) -> float:
    """Pitcher's own HR-rate-allowed vs. league average, in log-odds units
    — 0 when the pitcher allows HRs at exactly the league rate, positive
    when he allows more, negative when he suppresses them."""
    return _log_odds(pitcher_hr_rate_allowed) - _log_odds(league_hr_rate)


# Batting-slot (1-9) -> expected plate appearances that game. Linear
# approximation, a disclosed estimate, not a precisely fit per-slot average.
PA_BY_SLOT: dict[int, float] = {1: 4.6, 2: 4.5, 3: 4.4, 4: 4.3, 5: 4.2, 6: 4.1, 7: 4.0, 8: 3.9, 9: 3.8}
# Mean of PA_BY_SLOT's nine values — the neutral reference expected_pa_centered
# zeroes against, so a lineup-slot-unknown caller can pass this directly.
NEUTRAL_EXPECTED_PA = sum(PA_BY_SLOT.values()) / len(PA_BY_SLOT)


def expected_pa_for_slot(batting_slot: int) -> float:
    """Slot outside 1-9 falls back to the neutral center rather than
    raising — same graceful-default convention as every other optional
    signal in this codebase."""
    return PA_BY_SLOT.get(batting_slot, NEUTRAL_EXPECTED_PA)


def expected_pa_centered(batting_slot: int) -> float:
    return expected_pa_for_slot(batting_slot) - NEUTRAL_EXPECTED_PA


def expected_pa_centered_from_trailing_average(avg_pa_per_game: float) -> float:
    """Centers a raw PA/game figure directly, same reference point as
    expected_pa_centered — used by the historical training builder, which
    has no per-game batting-slot data to look up and uses the batter's own
    trailing PA/game average as the honest, no-lookahead proxy instead."""
    return avg_pa_per_game - NEUTRAL_EXPECTED_PA


def apply_lineup_confidence(prob: float, start_probability: float) -> float:
    """Lineup-confidence discount — applied to the FINAL probability, not a
    fitted feature. Multiplies down a probability built from a projected
    (not yet official) lineup slot by the estimated chance that batter
    actually starts. `1` (official lineup, or no discount known) leaves the
    probability untouched."""
    return prob * min(1.0, max(0.0, start_probability))


@dataclass
class HomeRunFeatureInputs:
    """[betaBinomialHrProb, parkHrFactorCentered, pitcherMatchupSignal, expectedPaCentered] — same order as HOME_RUN_FEATURE_NAMES."""

    beta_binomial_hr_prob: float
    park_hr_factor_centered: float
    pitcher_matchup_signal: float
    expected_pa_centered: float


# A home run is rare enough that an unclamped sigmoid output from a still-
# thin fit could in principle land somewhere silly — same defensive-bound
# role as the game model's win-probability clamp, just a tighter, rare-
# event-appropriate range.
MIN_HOME_RUN_PROB = 0.005
MAX_HOME_RUN_PROB = 0.5


def apply_fitted_home_run_weights(inputs: HomeRunFeatureInputs, weights: list[float], intercept: float) -> float:
    """Applies a fitted home-run model version's weights to a live feature
    set. The feature vector here is already fully assembled by the caller
    rather than built from a shared diagnostics object, since this model
    has no moneyline-style "raw formula" stage of its own —
    beta_binomial_hr_prob IS the raw signal, computed by this module's
    own beta_binomial_hr_prob() above."""
    features = [
        inputs.beta_binomial_hr_prob,
        inputs.park_hr_factor_centered,
        inputs.pitcher_matchup_signal,
        inputs.expected_pa_centered,
    ]
    prob = predict_prob(features, weights, intercept)
    return min(MAX_HOME_RUN_PROB, max(MIN_HOME_RUN_PROB, prob))
