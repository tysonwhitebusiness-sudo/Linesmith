"""Direct port of lib/core/probabilityBlend.ts — not a reimplementation.
Blends the model's own probability with the market's de-vigged implied
probability. The market is, empirically, a hard number to beat — blending
toward it is the single highest-leverage change available to this app's
calibration (see /diagnostics's Brier score). MARKET_BLEND_WEIGHT is a
placeholder until the fitting phase replaces it with a value learned from
real graded outcomes instead of guessed.

Elo is blended in AFTER the market (sequential composition, not a 3-way
weighted average) at a smaller weight — it's a newer, less-proven signal
than the market, so it nudges the market-informed number rather than
competing with it on equal footing. Both weights are placeholders; a real
fitting pass replaces the guessing with weights learned from real graded
outcomes.
"""
import math

MARKET_BLEND_WEIGHT = 0.5
ELO_BLEND_WEIGHT = 0.2


def blend_probability(model_prob: float, other_prob: float | None, weight: float = MARKET_BLEND_WEIGHT) -> float:
    if other_prob is None or not math.isfinite(other_prob):
        return model_prob
    return (1 - weight) * model_prob + weight * other_prob
