"""Direct port of lib/core/normalDist.ts — not a reimplementation.
Small normal-distribution helpers — CDF (for turning a continuous
expected score into bucketed win/under/over probabilities) and a
Gaussian sampler (for the tournament-winner Monte Carlo sim).
Sport-agnostic, same role as logistic_regression.py: pure math.
"""
import math
import random


def _erf(x: float) -> float:
    """Abramowitz & Stegun 7.1.26 — standard, accurate to ~1.5e-7, no
    external dependency (matches the TS source's own hand-rolled
    implementation rather than using math.erf, so both sides use
    identical arithmetic)."""
    sign = -1 if x < 0 else 1
    ax = abs(x)
    a1 = 0.254829592
    a2 = -0.284496736
    a3 = 1.421413741
    a4 = -1.453152027
    a5 = 1.061405429
    p = 0.3275911
    t = 1 / (1 + p * ax)
    y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-ax * ax)
    return sign * y


def normal_cdf(x: float, mean: float = 0.0, sd: float = 1.0) -> float:
    """P(X <= x) for X ~ Normal(mean, sd)."""
    if sd <= 0:
        return 0.0 if x < mean else 1.0
    return 0.5 * (1 + _erf((x - mean) / (sd * math.sqrt(2))))


def sample_normal(mean: float, sd: float, rng=random.random) -> float:
    """Box-Muller transform — one standard-normal-derived sample per
    call. `rng` is injectable so a simulation can be made deterministic
    for tests."""
    u1 = max(rng(), 1e-12)
    u2 = rng()
    z = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
    return mean + sd * z
