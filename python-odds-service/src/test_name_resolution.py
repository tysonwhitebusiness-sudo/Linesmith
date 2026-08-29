"""Every global name these functions reference must actually exist.

WHY THIS TEST EXISTS. This exact bug has shipped twice in one day, both times
in predict/model_fit.py, and both times it type-checked and imported cleanly:

  1. Task 4.11 switched the module from Poisson to negative binomial, changed
     the import, and missed a second call site. `poisson_over_probability` was
     no longer a module global, so any real training-set build raised
     NameError. `import model_fit` still worked -- the name is only looked up
     when the line executes, which is minutes into a long job.
  2. The Phase 4 gate reverted one of those call sites back to Poisson to match
     the serving path, and reintroduced the identical fault by not restoring
     the import.

A module-level import check cannot catch this, and neither can running the
tests, because the functions involved need a database and hours of network.
Python resolves globals at call time, so the cheap check is: read the function's
own bytecode for the names it references, and assert each one resolves.

Hermetic: nothing is called, only inspected.
"""
import sys

sys.path.insert(0, "src" if __import__("os").path.isdir("src") else ".")

import builtins

from predict import game_model, model_fit

# (module, function name) pairs that are expensive or impossible to execute in a
# test, and so never have their global lookups exercised by CI.
GUARDED = [
    (model_fit, "_build_training_set_uncached"),
    (model_fit, "fit_moneyline_weights"),
    (model_fit, "fit_total_weights"),
    (model_fit, "market_gate"),
    (model_fit, "_base_rate_holdout_brier"),
    (game_model, "compute_moneyline_model"),
    (game_model, "compute_total_model"),
]


def unresolved_globals(fn) -> list[str]:
    """Names the function loads AS GLOBALS that resolve nowhere.

    Reading `co_names` is not good enough: it holds attribute names too, so
    `odds.ml_home_consensus_prob` and `sim_result.home_win_prob` look exactly
    like unresolved globals and drown the real signal. The first draft of this
    test did that and reported four false positives.

    `LOAD_GLOBAL` is the precise opcode -- it is emitted only for a genuine
    global lookup, which is the thing that raises NameError. Nested functions
    get their own code objects, so those are walked too.
    """
    import dis
    import types

    g = fn.__globals__
    missing: list[str] = []

    def walk(code):
        for ins in dis.get_instructions(code):
            if ins.opname == "LOAD_GLOBAL":
                name = ins.argval
                if name not in g and not hasattr(builtins, name) and name not in missing:
                    missing.append(name)
        for const in code.co_consts:
            if isinstance(const, types.CodeType):
                walk(const)

    walk(fn.__code__)
    return missing


def test_guarded_functions_reference_only_names_that_exist() -> None:
    """An unresolved name here is a NameError waiting for the first real run."""
    problems = {}
    for module, fn_name in GUARDED:
        fn = getattr(module, fn_name, None)
        assert fn is not None, f"{module.__name__}.{fn_name} no longer exists -- update GUARDED"
        fn = getattr(fn, "__wrapped__", fn)
        missing = unresolved_globals(fn)
        if missing:
            problems[f"{module.__name__}.{fn_name}"] = missing

    assert not problems, (
        "unresolved global name(s) -- these raise NameError the first time the line runs, "
        "which for these functions is minutes into a job that needs a database:\n  "
        + "\n  ".join(f"{k}: {v}" for k, v in problems.items())
    )
    print(f"  {len(GUARDED)} guarded functions, every probability/model name resolves")


def test_the_two_distributions_are_both_importable_from_model_fit() -> None:
    """The specific pair that broke twice. model_fit uses BOTH deliberately:
    negative binomial for rawOverProb, Poisson for simOverProb (matching
    odds_lines_cycle.py:491). Neither import may be dropped when one call site
    changes."""
    g = model_fit.__dict__
    for name in ("neg_binom_over_probability", "poisson_over_probability"):
        assert name in g, (
            f"model_fit no longer imports {name}. Both are used, on purpose -- "
            "see the comment above sim_over_prob. Dropping one is the 4.11 bug."
        )
    src = model_fit.__file__
    import io

    text = io.open(src, encoding="utf-8").read()
    assert "neg_binom_over_probability(expected_total_raw" in text, "rawOverProb should be negative binomial"
    assert "poisson_over_probability(sim_result.expected_total" in text, "simOverProb should match serving (Poisson)"
    print("  rawOverProb=negative binomial, simOverProb=Poisson, both imported")


def test_the_detector_actually_detects() -> None:
    """A guard that has never fired proves nothing. Build a function whose
    global is genuinely absent and confirm it is reported."""
    ns: dict = {}
    exec("def broken():\n    return poisson_over_probability(1.0, 2.0)\n", ns)
    missing = unresolved_globals(ns["broken"])
    assert "poisson_over_probability" in missing, "the detector missed a real unresolved name"
    print("  detector catches a deliberately unresolved name")


if __name__ == "__main__":
    tests = [
        test_guarded_functions_reference_only_names_that_exist,
        test_the_two_distributions_are_both_importable_from_model_fit,
        test_the_detector_actually_detects,
    ]
    for t in tests:
        print(f"{t.__name__}:")
        t()
    print(f"\nOK - {len(tests)} name-resolution tests passed")
