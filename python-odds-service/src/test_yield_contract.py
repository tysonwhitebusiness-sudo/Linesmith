"""Every `yield_fn(...)` call site passes exactly one argument.

WHY THIS EXISTS. `SequentialQueue._run_one` hands a job
`functools.partial(self.maybe_yield, name)`, and `maybe_yield(caller, wait_hint)`
takes two. So a job that calls `yield_fn()` with no argument raises

    TypeError: SequentialQueue.maybe_yield() missing 1 required
    positional argument: 'wait_hint'

the first time it reaches a yield point, and dies there. FOUR of the five call
sites in this service had exactly that, found 2026-08-30 in the live Render log:

    [queue] starting ingestNflPbpJob
    [queue] ingestNflPbpJob raised unexpectedly: TypeError: ...

`ingestNflPbpJob` had never completed a single scheduled run. Neither had
`ingestNhlShotsJob`, `ingestNbaShotsJob`, or `ingestStatcastPitchesJob` — their
tables looked populated only because the operator had run the `backfill`
entrypoints by hand, which pass no `yield_fn` at all and so never hit the bug.

Nothing else catches this. The crash is inside a coroutine the queue schedules,
`yield_fn` is an untyped default-None parameter, and a job with no yield point
reached in a short run looks perfectly healthy. It is a call-shape error, so it
is checked statically, on the AST rather than on a regex — `await yield_fn()`
and `await yield_fn(\\n)` are the same defect and only one of them greps.

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/test_yield_contract.py
"""

import ast
import inspect
import pathlib

SRC = pathlib.Path(__file__).parent


def _expected_arity() -> int:
    """Read the real arity off `maybe_yield` rather than hardcoding 1.

    The whole failure mode is two things disagreeing about a signature, so a
    test that hardcodes its own copy of that signature would keep passing the
    day someone adds a third parameter — which is the same class of bug one
    level up.
    """
    import job_queue

    params = list(inspect.signature(job_queue.SequentialQueue.maybe_yield).parameters)
    # `self` and `caller` are both bound before the job ever sees it: `self` by
    # the bound method, `caller` by the functools.partial.
    return len(params) - 2


def main() -> None:
    expected = _expected_arity()
    offences: list[str] = []
    checked = 0

    for path in sorted(SRC.glob("*.py")):
        if path.name.startswith("test_"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            if not (isinstance(fn, ast.Name) and fn.id == "yield_fn"):
                continue
            checked += 1
            passed = len(node.args) + len(node.keywords)
            if passed != expected:
                offences.append(
                    f"{path.name}:{node.lineno} calls yield_fn with {passed} argument(s), expected {expected}"
                )

    if checked == 0:
        # A test that finds nothing to check is not a passing test. If the
        # ingesters stop taking a yield_fn entirely this should be deleted
        # deliberately, not left quietly green.
        print("FAIL: no yield_fn call sites found at all — this test is checking nothing")
        raise SystemExit(1)

    if offences:
        for o in offences:
            print(f"FAIL: {o}")
        print(
            "\nThe queue passes functools.partial(maybe_yield, name), so a job that\n"
            "calls yield_fn() with no argument raises TypeError and dies at its\n"
            "first yield point. See this file's docstring."
        )
        raise SystemExit(1)

    print(f"PASS: {checked} yield_fn call sites, all passing {expected} argument(s)")


if __name__ == "__main__":
    main()
