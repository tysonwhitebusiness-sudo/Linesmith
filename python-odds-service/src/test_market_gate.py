"""Phase 4.2 — the activation gate must be the MARKET, not our own last guess.

Audit finding P3 H3: "Today the gate compares a fitted model against your own
*unfitted formula* — a model can 'win' while losing to the market."

That is the whole bug. `activated = holdout_brier < baseline_holdout_brier`
asks "is this fit better than our previous guess?", which a model can pass
while still being worse than the price you could have bet into. Beating your
own previous guess is not a reason to show anyone a number.

Q24 makes the consequence binding: a model that loses to the market is
deactivated. So the gate has two failure modes and this covers both —
activating a model that loses to the market, and refusing one on a sample too
thin to judge.

Pure functions, no network, no database, so this runs in CI (Q20).

Run with:  python -u src/test_market_gate.py
"""
import sys

sys.path.insert(0, "src")

from predict.model_fit import MARKET_GATE_MIN_N, MarketGateResult  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


def _brier(pairs):
    return sum((p - a) ** 2 for p, a in pairs) / len(pairs)


def _verdict(sample):
    """The same decision market_gate() makes, over a supplied sample — so the
    rule is tested without needing a live database."""
    n = len(sample)
    if n < MARKET_GATE_MIN_N:
        return MarketGateResult(n=n, model_brier=None, market_brier=None, verdict="insufficient_sample")
    model = _brier([(m, a) for m, _, a in sample])
    market = _brier([(k, a) for _, k, a in sample])
    return MarketGateResult(
        n=n, model_brier=model, market_brier=market,
        verdict="beats_market" if model < market else "loses_to_market",
    )


def _sample(n, model_prob, market_prob, win_rate):
    """n rows where the true frequency is `win_rate`, the model says
    `model_prob` and the market says `market_prob`."""
    wins = round(n * win_rate)
    return [(model_prob, market_prob, 1.0)] * wins + [(model_prob, market_prob, 0.0)] * (n - wins)


def test_a_model_that_loses_to_the_market_is_refused():
    """THE case P3 H3 is about. True rate 60%; the market says 0.60 and is
    nearly perfect, the model says 0.40 and is badly wrong — but 0.40 could
    still beat an even worse unfitted baseline, which is how such a model used
    to reach production."""
    print("\n4.2: a model that loses to the market does not activate")
    g = _verdict(_sample(400, model_prob=0.40, market_prob=0.60, win_rate=0.60))
    check("verdict", g.verdict, "loses_to_market")
    check("and it BLOCKS activation", g.blocks_activation, True)
    check("model really is worse", g.model_brier > g.market_brier, True)
    print(f"       model Brier {g.model_brier:.5f} vs market {g.market_brier:.5f}")


def test_a_model_that_beats_the_market_is_allowed():
    """Both directions, or 'refuses everything' would pass the test above."""
    print("\n4.2: a model that beats the market is not blocked")
    g = _verdict(_sample(400, model_prob=0.60, market_prob=0.45, win_rate=0.60))
    check("verdict", g.verdict, "beats_market")
    check("does not block", g.blocks_activation, False)
    check("model really is better", g.model_brier < g.market_brier, True)
    print(f"       model Brier {g.model_brier:.5f} vs market {g.market_brier:.5f}")


def test_a_thin_sample_is_named_not_guessed():
    """The live sample today is n=12. A verdict there would be noise dressed as
    evidence — and under Q24 a false 'loses_to_market' DEACTIVATES a live model.
    So too-few must be its own outcome, distinct from both real verdicts."""
    print("\n4.2: too few graded picks is its own outcome, not a coin flip")
    g = _verdict(_sample(12, model_prob=0.40, market_prob=0.60, win_rate=0.60))
    check("verdict", g.verdict, "insufficient_sample")
    check("does NOT block (cannot condemn on noise)", g.blocks_activation, False)
    check("and reports no Brier at all rather than a meaningless one", g.model_brier, None)
    check("the reason is stated in words", "INSUFFICIENT SAMPLE" in g.describe(), True)


def test_the_boundary():
    print("\n4.2: the minimum-sample boundary is exact")
    below = _verdict(_sample(MARKET_GATE_MIN_N - 1, 0.40, 0.60, 0.60))
    at = _verdict(_sample(MARKET_GATE_MIN_N, 0.40, 0.60, 0.60))
    check(f"n={MARKET_GATE_MIN_N - 1} is insufficient", below.verdict, "insufficient_sample")
    check(f"n={MARKET_GATE_MIN_N} is judged", at.verdict, "loses_to_market")


def test_the_old_gate_would_have_passed_the_losing_model():
    """The counterfactual, measured rather than asserted. The old gate compared
    the fit only against the app's own unfitted formula. Give it a formula worse
    than the model and it activates — even though the model loses to the market,
    which is exactly the hole P3 H3 identified."""
    print("\n4.2: the OLD gate really would have activated that losing model")
    sample = _sample(400, model_prob=0.40, market_prob=0.60, win_rate=0.60)
    model_brier = _brier([(m, a) for m, _, a in sample])
    market_brier = _brier([(k, a) for _, k, a in sample])
    # An unfitted formula that is worse still — entirely plausible, and all the
    # old gate ever required.
    unfitted_baseline_brier = _brier([(0.25, a) for _, _, a in sample])
    check("old gate: model beats its own baseline -> ACTIVATE",
          model_brier < unfitted_baseline_brier, True)
    check("but the model loses to the market", model_brier > market_brier, True)
    check("new gate refuses it", _verdict(sample).blocks_activation, True)
    print(f"       model {model_brier:.5f} | market {market_brier:.5f} | old baseline {unfitted_baseline_brier:.5f}")


def main() -> bool:
    test_a_model_that_loses_to_the_market_is_refused()
    test_a_model_that_beats_the_market_is_allowed()
    test_a_thin_sample_is_named_not_guessed()
    test_the_boundary()
    test_the_old_gate_would_have_passed_the_losing_model()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
