"""Every job in JOB_REGISTRY goes through `_run_timed`.

WHY THIS EXISTS. `_run_timed` is not decoration. It does two things nothing
else does:

  1. writes the `db.write_job_run_log` breadcrumb that `health_check.py` reads
     to decide whether a job is stuck — per CLAUDE.md, that monitoring layer
     "already works for any job added this way with zero changes", and it works
     by reading exactly this breadcrumb;
  2. CATCHES the job's exception and records it with a traceback, instead of
     letting it escape as a bare `[queue] X raised unexpectedly` line that only
     exists in Render's rolling log buffer.

Four jobs shipped without it — `ingestStatcastPitchesJob` (6.6),
`ingestNhlShotsJob` and `ingestNbaShotsJob` (6.7), `ingestNflPbpJob` (6.8) —
and all four were crashing on a TypeError at their first yield point for as
long as they had existed. **The wrapper whose entire purpose is making failure
visible was missing from precisely the jobs that were failing**, so:
`health_check.py` could not see them, no breadcrumb ever appeared in
`snapshot_cache`, and the only trace was a log line nobody was reading.

Found 2026-08-30, and only because the queue log was read directly.

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/test_job_registry_contract.py
"""

import ast
import pathlib

SRC = pathlib.Path(__file__).parent / "jobs.py"


def main() -> None:
    tree = ast.parse(SRC.read_text(encoding="utf-8"), filename=str(SRC))

    # The registry as source: every entry's job name.
    registry: list[str] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "JOB_REGISTRY" for t in node.targets
        )):
            continue
        for element in node.value.elts:
            name_node = element.elts[0]
            if isinstance(name_node, ast.Constant):
                registry.append(name_node.value)

    if not registry:
        print("FAIL: could not read JOB_REGISTRY — this test is checking nothing")
        raise SystemExit(1)

    # Functions whose body calls `_run_timed`. THREE shapes reach it legitimately
    # and all three are real in this file, so the check follows the name rather
    # than the call graph:
    #   direct    — job_retention()          -> _run_timed("retentionJob", ...)
    #   delegated — job_nfl()                -> _job_multisport("refreshNflJob", ...)
    #   factory   — job_generic_prop_production_nfl = _make_...("nfl", "generic...Job")
    # An earlier version of this test only understood the first and reported
    # eleven false positives against working jobs.
    timed_helpers: set[str] = {"_run_timed"}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.Call) and isinstance(inner.func, ast.Name) and inner.func.id == "_run_timed":
                timed_helpers.add(node.name)
                break

    # Every string literal handed to something that reaches `_run_timed`.
    logged_names: set[str] = set()
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
            continue
        if node.func.id not in timed_helpers:
            continue
        for arg in list(node.args) + [k.value for k in node.keywords]:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                logged_names.add(arg.value)

    offences = [
        f"{job} is in JOB_REGISTRY but its name never reaches _run_timed: no breadcrumb, "
        f"invisible to health_check.py, and its exceptions escape untraced"
        for job in registry
        if job not in logged_names
    ]

    if offences:
        for o in offences:
            print(f"FAIL: {o}")
        raise SystemExit(1)

    print(f"PASS: all {len(registry)} JOB_REGISTRY entries reach _run_timed under their own name")


if __name__ == "__main__":
    main()
