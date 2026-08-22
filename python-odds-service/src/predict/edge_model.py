"""Direct port of lib/odds/props/edgeModel.ts — not a reimplementation.

Beta-Binomial: conjugate prior for a Bernoulli rate, so the posterior after
observing real games is closed-form — cheap enough to run for every
candidate on every snapshot. The prior's center is the real league base
rate for that market (db.league_base_rates, computed from every graded
outcome this app has ever seen). The matchup shift and per-market prior
strength below are v1: principled math, hand-set hyperparameters — not yet
fit against real calibration data, same disclosed-not-fitted status as the
TS original.
"""
import math
from dataclasses import dataclass


@dataclass
class BetaPosterior:
    alpha: float
    beta: float
    mean: float
    variance: float
    std_dev: float


def beta_posterior(alpha0: float, beta0: float, hits: float, total: float) -> BetaPosterior:
    alpha = alpha0 + hits
    beta = beta0 + max(0.0, total - hits)
    total_ab = alpha + beta
    mean = alpha / total_ab
    variance = (alpha * beta) / (total_ab * total_ab * (total_ab + 1))
    return BetaPosterior(alpha=alpha, beta=beta, mean=mean, variance=variance, std_dev=math.sqrt(variance))


# Effective prior sample size, per market — how many "pseudo-games" of
# league-average behavior the prior is worth before real data takes over.
# Rare events get a stronger prior: a batter going 2-for-5 on home runs
# this month is not actually a 40% home run hitter, and a weak prior would
# let a tiny sample say so.
PRIOR_STRENGTH: dict[str, float] = {
    "home-runs": 50,
    "triples": 70,
    "stolen-bases": 45,
    "doubles": 30,
    "first-home-run": 70,
}
DEFAULT_PRIOR_STRENGTH = 15


def prior_strength(dimension: str) -> float:
    return PRIOR_STRENGTH.get(dimension, DEFAULT_PRIOR_STRENGTH)


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
class ModelProbabilityInput:
    dimension: str
    league_rate: float
    # The candidate's own real history — did each game clear the line,
    # oldest to newest doesn't matter here, just the count.
    over_count: float
    total_count: float
    # Already-resolved matchup favorability — None when no matchup signal
    # was available.
    matchup_favorable: bool | None
    # The trailing L10 window's own over/total, as a subset already counted
    # once in over_count/total_count above — not extra games, extra weight
    # on games already there.
    recent_over_count: float = 0
    recent_total_count: float = 0


@dataclass
class ModelProbabilityResult:
    prob: float
    std_dev: float
    sample_size: float
    prior_mean: float
    prior_strength: float


# How much extra a recent (L10) game counts toward the posterior versus an
# older one — 0.5 means each recent game is worth 1.5x a normal game's
# weight. v1 hand-set, same disclosed-not-yet-fit status as the rest of
# this module.
RECENT_GAME_WEIGHT_BONUS = 0.5


def compute_model_probability(input: ModelProbabilityInput) -> ModelProbabilityResult:
    n0 = prior_strength(input.dimension)
    prior_mean = shifted_prior_mean(input.league_rate, input.matchup_favorable)
    alpha0 = prior_mean * n0
    beta0 = (1 - prior_mean) * n0

    weighted_over_count = input.over_count + input.recent_over_count * RECENT_GAME_WEIGHT_BONUS
    weighted_total_count = input.total_count + input.recent_total_count * RECENT_GAME_WEIGHT_BONUS

    posterior = beta_posterior(alpha0, beta0, weighted_over_count, weighted_total_count)
    return ModelProbabilityResult(
        prob=posterior.mean,
        std_dev=posterior.std_dev,
        sample_size=input.total_count,
        prior_mean=prior_mean,
        prior_strength=n0,
    )
