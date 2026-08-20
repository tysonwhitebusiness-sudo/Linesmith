"""Staleness/health monitor for the 5 registered jobs — the gap Render's
`notifyOnFail` doesn't cover. `notifyOnFail` only fires on a process crash;
it says nothing about a job that's technically still running but stuck
(hung in a yield loop, wedged on a provider that never times out, or just
silently stopped being scheduled) while the process itself stays healthy.

Each job already writes a breadcrumb via db.write_job_run_log() on every
run, success or failure (see jobs.py's _run_timed). This reads those back
and checks two things per job:
  1. Did it actually run recently — within 2x its own registered interval?
     (2x, not 1x: the queue is priority-ordered, not a strict timer, so a
     single job can legitimately wait past its own interval once while
     something more overdue runs first — see job_queue.py's _most_overdue.
     Only a genuinely missed *second* cycle is a real staleness signal.)
  2. Did its last run report ok=True?

Exit code is 0 if everything's healthy, 1 if anything is stale or failed —
meant to be run manually for a spot-check, or on a schedule (Render cron
job, external uptime pinger) wired to actually page someone. Wiring up the
actual paging/alerting channel is a separate decision; this is the
detection logic that would sit behind it.
"""
import asyncio
import json
import sys
from datetime import datetime, timezone

import db
from jobs import JOB_REGISTRY

STALE_MULTIPLIER = 2.0


async def check_job(name: str, interval_seconds: float) -> dict:
    key = f"python-harness:job-run:{name}"
    payload = await db.read_snapshot(key)
    if payload is None:
        return {"name": name, "status": "NEVER RUN", "healthy": False}

    summary = json.loads(payload)
    started_at = summary.get("started_at")
    ok = summary.get("ok")

    if started_at is None:
        return {"name": name, "status": "MALFORMED LOG (no started_at)", "healthy": False}

    started_dt = datetime.fromisoformat(started_at)
    age_seconds = (datetime.now(timezone.utc) - started_dt).total_seconds()
    stale = age_seconds > interval_seconds * STALE_MULTIPLIER

    healthy = bool(ok) and not stale
    status_bits = []
    if not ok:
        status_bits.append(f"last run failed: {summary.get('error', 'unknown error')}")
    if stale:
        status_bits.append(
            f"stale — last run {age_seconds / 60:.0f}min ago, expected within {interval_seconds * STALE_MULTIPLIER / 60:.0f}min"
        )
    if not status_bits:
        status_bits.append(
            f"healthy — last run {age_seconds / 60:.0f}min ago, {summary.get('rows_written', 0)} rows written"
        )

    return {"name": name, "status": "; ".join(status_bits), "healthy": healthy, "raw": summary}


async def main() -> int:
    results = await asyncio.gather(*(check_job(name, interval) for name, _, interval in JOB_REGISTRY))

    print(f"[health_check] {datetime.now(timezone.utc).isoformat()}", flush=True)
    all_healthy = True
    for r in results:
        marker = "OK  " if r["healthy"] else "FAIL"
        print(f"  [{marker}] {r['name']}: {r['status']}", flush=True)
        all_healthy = all_healthy and r["healthy"]

    print(f"\n[health_check] overall: {'HEALTHY' if all_healthy else 'UNHEALTHY'}", flush=True)
    return 0 if all_healthy else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
