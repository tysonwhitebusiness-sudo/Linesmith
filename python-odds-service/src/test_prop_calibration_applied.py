"""A fitted calibration that nothing applies is not a calibration.

WHY THIS TEST EXISTS. Task 4.3 fitted seven Platt calibrations into
`model_calibration` and its VERIFY -- "the table is no longer empty" -- passed.
The Phase 4 gate then found that nothing applied any of them: the single
serve-time consumer (`odds_lines_cycle.py:557`) asks for `('mlb','moneyline')`
and every fitted row was a PROP market, so P3 H1 ("probabilities are
uncalibrated") was still true of every number the prop job produced.

That is the fourth time this session a fix has been shipped behind a VERIFY
that could not see whether the output was consumed. The job itself is network
and database end to end, which is what made it easy to miss, so the transform
is extracted into `jobs.apply_prop_calibrations` and pinned here.

Hermetic: no database, no network.
"""
import dataclasses
import sys

sys.path.insert(0, "src" if __import__("os").path.isdir("src") else ".")

from jobs import apply_prop_calibrations
from predict.calibration import PlattParams, apply_platt


@dataclasses.dataclass
class FakeCandidate:
    """Shaped like the fields apply_prop_calibrations actually reads."""

    dimension: str
    model_prob: float | None
    subject_id: str = "x"


@dataclasses.dataclass
class FakeCalibrationRow:
    method: str
    params: dict


# hit-in-game's real fitted parameters, from model_calibration on 2026-08-29.
HIT_IN_GAME = FakeCalibrationRow(method="platt", params={"a": 0.4774712822340156, "b": 0.02469449947530386})


def approx(a: float, b: float, tol: float = 1e-12) -> bool:
    return abs(a - b) <= tol


def test_a_calibrated_market_is_actually_changed() -> None:
    cands = [FakeCandidate("hit-in-game", 0.70)]
    out, changed = apply_prop_calibrations(cands, {"hit-in-game": HIT_IN_GAME})

    assert changed == 1, "the candidate was not counted as calibrated"
    expected = apply_platt(0.70, PlattParams(a=HIT_IN_GAME.params["a"], b=HIT_IN_GAME.params["b"]))
    assert approx(out[0].model_prob, expected), f"{out[0].model_prob} != {expected}"
    assert out[0].model_prob != 0.70, "the probability came through unchanged"
    # a<1 shrinks toward 0.5 -- the direction that matters for the edge threshold
    assert out[0].model_prob < 0.70, "calibration should compress this confidence"
    print(f"  0.700 -> {out[0].model_prob:.4f} (a={HIT_IN_GAME.params['a']:.4f})")


def test_an_uncalibrated_market_passes_through_untouched() -> None:
    """`runs` and `total-bases` lost to their baselines and are active=false,
    so get_active_calibration returns None for them and they must not be
    silently altered."""
    cands = [FakeCandidate("runs", 0.62), FakeCandidate("total-bases", 0.44)]
    out, changed = apply_prop_calibrations(cands, {"hit-in-game": HIT_IN_GAME})

    assert changed == 0, "an unfitted market was calibrated"
    assert out[0].model_prob == 0.62 and out[1].model_prob == 0.44
    print("  unfitted markets unchanged")


def test_a_none_probability_is_left_alone() -> None:
    cands = [FakeCandidate("hit-in-game", None)]
    out, changed = apply_prop_calibrations(cands, {"hit-in-game": HIT_IN_GAME})

    assert changed == 0
    assert out[0].model_prob is None, "None must not become a number"
    print("  model_prob=None left as None")


def test_the_input_list_is_not_mutated() -> None:
    """Both the pick_history writer and the model-cache writer consume the same
    list. The function must return a new list rather than edit in place, or the
    call site cannot tell whether calibration happened."""
    original = FakeCandidate("hit-in-game", 0.70)
    cands = [original]
    out, _ = apply_prop_calibrations(cands, {"hit-in-game": HIT_IN_GAME})

    assert original.model_prob == 0.70, "the input candidate was mutated in place"
    assert out[0] is not original, "expected a replaced dataclass, not the same object"
    print("  input list untouched; a new candidate is returned")


def test_mixed_batch_calibrates_only_what_it_should() -> None:
    cands = [
        FakeCandidate("hit-in-game", 0.70),
        FakeCandidate("runs", 0.55),
        FakeCandidate("hit-in-game", 0.30),
        FakeCandidate("walks", 0.61),
    ]
    out, changed = apply_prop_calibrations(cands, {"hit-in-game": HIT_IN_GAME})

    assert changed == 2, f"expected 2 calibrated, got {changed}"
    assert out[1].model_prob == 0.55 and out[3].model_prob == 0.61
    assert out[0].model_prob != 0.70 and out[2].model_prob != 0.30
    # a<1 pulls both sides toward 0.5, so a low probability rises.
    assert out[2].model_prob > 0.30, "0.30 should be pulled up toward 0.5"
    print(f"  0.300 -> {out[2].model_prob:.4f}; 2 of 4 calibrated")


def test_no_calibrations_is_a_no_op() -> None:
    cands = [FakeCandidate("hit-in-game", 0.70)]
    out, changed = apply_prop_calibrations(cands, {})
    assert changed == 0 and out[0].model_prob == 0.70
    print("  empty calibration map -> no change")


def test_the_job_actually_calls_it() -> None:
    """The whole point of 4.3's failure was a correct function nobody called.
    Testing the transform in isolation would reproduce that mistake exactly, so
    this reads the job's own source and asserts the wiring.

    Order matters: both writers consume one candidate list precisely so they
    cannot disagree about what the model computed. Calibration has to land
    before the first of them, or pick_history keeps the raw probability while
    the model cache gets the calibrated one.
    """
    import inspect

    import jobs

    src = inspect.getsource(jobs._compute_mlb_prop_predictions_inner)

    assert "apply_prop_calibrations(" in src, (
        "_compute_mlb_prop_predictions_inner does not call apply_prop_calibrations -- "
        "the calibration is fitted, correct, and applied to nothing, which is the "
        "exact state task 4.3 shipped in"
    )
    assert "get_active_calibration(" in src, "the job never loads a calibration to apply"

    call = src.index("apply_prop_calibrations(")
    log = src.index("log_snapshot_candidates(")
    cache = src.index("write_prop_model_cache(")
    assert call < log, "calibration must be applied before log_snapshot_candidates"
    assert call < cache, "calibration must be applied before write_prop_model_cache"
    print("  wired into the job, ahead of both writers")


if __name__ == "__main__":
    tests = [
        test_a_calibrated_market_is_actually_changed,
        test_an_uncalibrated_market_passes_through_untouched,
        test_a_none_probability_is_left_alone,
        test_the_input_list_is_not_mutated,
        test_mixed_batch_calibrates_only_what_it_should,
        test_no_calibrations_is_a_no_op,
        test_the_job_actually_calls_it,
    ]
    for t in tests:
        print(f"{t.__name__}:")
        t()
    print(f"\nOK - {len(tests)} prop-calibration tests passed")
