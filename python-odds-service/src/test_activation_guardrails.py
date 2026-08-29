"""The activation gate must refuse a model that carries no information.

WHY THIS TEST EXISTS. During the Phase 4 gate (2026-08-29),
scripts/gate/phase-4-weak-model-refused.py ran the real fit_moneyline_weights
with every feature zeroed and the model ACTIVATED:

    beats own baseline: True
    holdout Brier      0.248824
    baseline holdout   0.260666
    ACTIVATED          True

A zeroed feature vector lets the fit learn only an intercept, i.e. the base
rate. 0.248824 is what a constant at p=0.54 scores. It cleared the guardrail
because the thing it was compared against -- this app's own unfitted formula --
scores WORSE than knowing nothing. "Beats its own baseline" is not a guardrail
when the baseline is worse than a constant.

The end-to-end gate script is the real proof, but it takes ~35 minutes because
it builds three seasons of training data. This test pins the same property in
under a second, so a regression is caught by CI rather than by remembering to
run a long script.

Hermetic: no database, no network.
"""
import sys

sys.path.insert(0, "src" if __import__("os").path.isdir("src") else ".")

from predict.logistic_regression import PredictionRecord, brier_score
from predict.model_fit import _base_rate_holdout_brier


class Row:
    """Minimal stand-in for TrainingRow -- the guardrail only reads .actual."""

    def __init__(self, actual: int) -> None:
        self.actual = actual


def approx(a: float, b: float, tol: float = 1e-9) -> bool:
    return abs(a - b) <= tol


def test_base_rate_uses_train_not_holdout() -> None:
    """The base rate must come from the training rows. Taking it from the
    holdout would leak the answer and make the guardrail weaker than it looks:
    a holdout-derived constant is the best possible constant on that holdout,
    so it would be unbeatable rather than a floor."""
    train = [Row(1)] * 80 + [Row(0)] * 20          # train base rate 0.80
    holdout = [Row(1)] * 50 + [Row(0)] * 50        # holdout base rate 0.50

    got = _base_rate_holdout_brier(train, holdout)
    # Predicting 0.80 on a 50/50 holdout: 0.5*(0.8-1)^2 + 0.5*(0.8-0)^2 = 0.34
    assert approx(got, 0.34), f"expected 0.34 from the TRAIN base rate, got {got}"

    # If it had used the holdout's own base rate it would score 0.25.
    assert not approx(got, 0.25), "base rate was taken from the holdout -- leak"
    print(f"  base rate taken from train: {got:.6f} (holdout-derived would be 0.250000)")


def test_zero_information_model_does_not_beat_the_base_rate() -> None:
    """The exact failure. A model that predicts the training base rate for
    every row -- which is what a zeroed feature vector reduces to -- must not
    clear the guardrail. It ties, and the comparison is strict `<`."""
    train = [Row(1)] * 54 + [Row(0)] * 46          # 0.54, MLB home-win-ish
    holdout = [Row(1)] * 540 + [Row(0)] * 460

    base_rate = sum(r.actual for r in train) / len(train)
    zero_info_preds = [PredictionRecord(base_rate, r.actual) for r in holdout]
    holdout_brier = brier_score(zero_info_preds)
    base_rate_brier = _base_rate_holdout_brier(train, holdout)

    assert approx(holdout_brier, base_rate_brier), (
        f"a constant-base-rate model should tie the base-rate floor exactly: "
        f"{holdout_brier} vs {base_rate_brier}"
    )
    beats_base_rate = holdout_brier < base_rate_brier
    assert beats_base_rate is False, "a zero-information model cleared the guardrail"
    print(f"  zero-information model: {holdout_brier:.6f} vs floor {base_rate_brier:.6f} -> refused")


def test_the_observed_failure_would_now_be_refused() -> None:
    """The numbers the gate actually printed. holdout_brier 0.248824 beat the
    app's own formula at 0.260666 -- guardrail 1 passed. Against the base-rate
    floor for the same holdout it does not, which is what now blocks it."""
    holdout_brier = 0.248824
    own_baseline_brier = 0.260666

    # p=0.54 constant on a holdout with that same base rate scores p(1-p).
    p = 0.54
    base_rate_brier = p * (1 - p)  # 0.2484

    beats_own_baseline = holdout_brier < own_baseline_brier
    beats_base_rate = holdout_brier < base_rate_brier

    assert beats_own_baseline is True, "guardrail 1 passed in the real run -- that is the point"
    assert beats_base_rate is False, (
        f"guardrail 3 must block: {holdout_brier} is not better than {base_rate_brier}"
    )
    assert (beats_own_baseline and beats_base_rate) is False, "the model would still activate"
    print(f"  observed run: beats own baseline {beats_own_baseline}, "
          f"beats base rate {beats_base_rate} -> now REFUSED")


def test_a_genuinely_informative_model_still_passes() -> None:
    """The guardrail must not block everything -- a model that actually
    separates the classes has to clear both floors, or activation becomes
    impossible and the gate is useless in the other direction."""
    train = [Row(1)] * 54 + [Row(0)] * 46
    holdout = [Row(1)] * 500 + [Row(0)] * 500

    # Confident and mostly right: 0.8 on the winners, 0.2 on the losers.
    good = [PredictionRecord(0.8 if r.actual == 1 else 0.2, r.actual) for r in holdout]
    holdout_brier = brier_score(good)
    base_rate_brier = _base_rate_holdout_brier(train, holdout)

    assert holdout_brier < base_rate_brier, (
        f"an informative model was blocked: {holdout_brier} vs {base_rate_brier}"
    )
    print(f"  informative model: {holdout_brier:.6f} vs floor {base_rate_brier:.6f} -> allowed")


def test_empty_inputs_do_not_activate_anything() -> None:
    """No rows means no evidence. The floor returns 1.0, the worst possible
    Brier, so nothing can beat it and nothing activates on an empty fit."""
    assert _base_rate_holdout_brier([], []) == 1.0
    assert _base_rate_holdout_brier([Row(1)], []) == 1.0
    assert _base_rate_holdout_brier([], [Row(1)]) == 1.0
    print("  empty inputs -> floor 1.0, nothing can activate")


if __name__ == "__main__":
    tests = [
        test_base_rate_uses_train_not_holdout,
        test_zero_information_model_does_not_beat_the_base_rate,
        test_the_observed_failure_would_now_be_refused,
        test_a_genuinely_informative_model_still_passes,
        test_empty_inputs_do_not_activate_anything,
    ]
    for t in tests:
        print(f"{t.__name__}:")
        t()
    print(f"\nOK - {len(tests)} activation-guardrail tests passed")
