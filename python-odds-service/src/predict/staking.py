"""Sport-agnostic fractional-Kelly bet sizing + bootstrapped significance
testing. Pure functions operating on (probability, decimal odds, outcome)
tuples — nothing sport-specific, nothing in this file knows what a
moneyline or a game_id is.

This app doesn't place automated wagers; the point of surfacing a Kelly-
suggested stake alongside a graded pick is decision support (how much edge,
how confident) matching the reference methodology audited this session.
"""
import random
from dataclasses import dataclass


def kelly_fraction(prob: float, decimal_odds: float, fraction: float = 0.25) -> float:
    """Full Kelly f* = (p*b - (1-p)) / b where b = decimal_odds - 1, scaled
    by `fraction` (fractional Kelly — the reference system's own default is
    0.25, i.e. quarter-Kelly). Clamped to 0 for any non-positive edge
    (never a negative stake)."""
    if decimal_odds <= 1:
        raise ValueError(f"kelly_fraction: decimal_odds must be > 1, got {decimal_odds}")
    b = decimal_odds - 1
    full_kelly = (prob * b - (1 - prob)) / b
    return max(full_kelly, 0.0) * fraction


def cap_exposure(stake_fraction: float, max_fraction: float = 0.05) -> float:
    return min(max(stake_fraction, 0.0), max_fraction)


def min_edge_gate(prob: float, decimal_odds: float, min_edge: float = 0.02) -> bool:
    """True iff the model's probability exceeds the market-implied
    probability (1/decimal_odds) by at least min_edge — the minimum-edge
    gate the reference system applies before a bet is even considered,
    ported as a standalone predicate rather than baked into kelly_fraction
    itself so a caller can log/inspect the gate decision separately from
    the stake size."""
    if decimal_odds <= 1:
        raise ValueError(f"min_edge_gate: decimal_odds must be > 1, got {decimal_odds}")
    implied_prob = 1 / decimal_odds
    return (prob - implied_prob) >= min_edge


@dataclass
class BootstrapResult:
    roi: float
    ci_lower: float
    ci_upper: float
    significant: bool  # True iff ci_lower > 0
    sample_size: int


def bootstrap_roi_ci(
    picks: list[tuple[float, float, bool]],  # (stake_fraction, decimal_odds, won)
    iterations: int = 2000,
    confidence: float = 0.95,
    rng: random.Random | None = None,
) -> BootstrapResult:
    """Resamples `picks` with replacement `iterations` times; each
    resample's ROI = sum(stake*(decimal_odds-1) if won else -stake) /
    sum(stake). Returns the real ROI on the un-resampled data plus the
    [alpha/2, 1-alpha/2] percentile CI of the resampled ROI distribution.
    significant=True iff ci_lower > 0 — the same "is this edge real or
    just sample noise" test the reference system runs before trusting a
    result. Picks with sample_size < 20 should be treated as too thin by
    the caller (documented here, not enforced — this function still
    returns a real, honest CI for any non-empty input; a caller choosing
    to ignore a thin-sample result is a display decision, not a math one)."""
    if len(picks) == 0:
        raise ValueError("bootstrap_roi_ci: at least one pick is required")
    if rng is None:
        rng = random.Random()

    def roi_of(sample: list[tuple[float, float, bool]]) -> float:
        total_stake = sum(s for s, _, _ in sample)
        if total_stake == 0:
            return 0.0
        total_return = sum((s * (d - 1) if won else -s) for s, d, won in sample)
        return total_return / total_stake

    real_roi = roi_of(picks)

    resampled_rois = sorted(roi_of(rng.choices(picks, k=len(picks))) for _ in range(iterations))
    alpha = 1 - confidence
    lower_idx = int((alpha / 2) * iterations)
    upper_idx = min(int((1 - alpha / 2) * iterations), iterations - 1)

    ci_lower = resampled_rois[lower_idx]
    ci_upper = resampled_rois[upper_idx]

    return BootstrapResult(
        roi=real_roi,
        ci_lower=ci_lower,
        ci_upper=ci_upper,
        significant=ci_lower > 0,
        sample_size=len(picks),
    )
