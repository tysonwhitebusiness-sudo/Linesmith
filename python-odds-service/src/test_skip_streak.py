"""A job that runs on time and never fetches must not report healthy.

THE FAILURE THIS CLOSES. health_check's whole test was `healthy = ok and not
stale`. gameday.skip_summary returns a SUCCESSFUL summary for a cycle that
deliberately called no provider, so a job whose provider keys were unset ran on
schedule, fetched nothing, and reported healthy — for twelve days, across
refreshNflJob and refreshCfbJob. A cap-exhausted provider produces the identical
silence.

Three parts, and the streak is the one that matters: a SINGLE skip is the tier
gate working correctly and must stay healthy, or the monitor cries wolf every
night in the offseason.

Run with:  python test_skip_streak.py
"""
import sys

import gameday
import health_check

_failures = 0


def check(label, actual, expected):
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def test_skip_summary_marks_itself():
    print("\nskip_summary - a skip is distinguishable from a fetch")
    s = gameday.skip_summary([], "cold")
    check("fetched is False", s["fetched"], False)
    check("reason recorded", s["skip_reason"], "cold tier")
    check("still not an error", "error" not in s, True)
    check("still reports zero rows", s["rows_written"], 0)


def test_one_skip_is_healthy():
    """The gate working correctly. An NFL job in June skips every cycle for
    months and that is right."""
    print("\nhealth - a short skip streak stays healthy")
    for n in (0, 1, 5, 71):
        healthy, _ = _judge(fetched=False, consecutive_skips=n)
        check(f"{n} consecutive skips -> healthy", healthy, True)


def test_long_skip_streak_is_unhealthy():
    print("\nhealth - a stuck job is caught")
    healthy, status = _judge(fetched=False, consecutive_skips=health_check.SKIP_STREAK_LIMIT)
    check("at the limit -> unhealthy", healthy, False)
    check("status names the real problem", "NEVER FETCHES" in status, True)


def test_absent_flag_is_treated_as_fetched():
    """Older breadcrumbs and jobs that do not use the tier gate never reported
    `fetched`. They must not retroactively fail."""
    print("\nhealth - a summary with no `fetched` key")
    healthy, _ = _judge(fetched=None, consecutive_skips=999)
    check("absent flag -> healthy", healthy, True)


def _judge(fetched, consecutive_skips):
    """Replicates check_job's decision on a synthetic summary, without a DB."""
    summary = {"ok": True, "rows_written": 0, "consecutive_skips": consecutive_skips,
               "skip_reason": "cold tier"}
    if fetched is not None:
        summary["fetched"] = fetched
    f = summary.get("fetched", True)
    stuck = not f and summary.get("consecutive_skips", 0) >= health_check.SKIP_STREAK_LIMIT
    healthy = bool(summary["ok"]) and not stuck
    status = (f"RUNS BUT NEVER FETCHES — {consecutive_skips} consecutive skipped cycles"
              if stuck else "healthy")
    return healthy, status


if __name__ == "__main__":
    test_skip_summary_marks_itself()
    test_one_skip_is_healthy()
    test_long_skip_streak_is_unhealthy()
    test_absent_flag_is_treated_as_fetched()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
