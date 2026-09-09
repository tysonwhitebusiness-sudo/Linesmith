"""Phase 5.0h — peak RSS of the MLB projection build, against Render's 512 MB.

    python measure_projection_memory.py

Called by `audit_storage.py --memory`. Runs the REAL serving build and writes
nothing; exits non-zero if peak RSS crosses the danger band.

WHY A SEPARATE CEILING IS TRACKED AT ALL. The plan tracked the database's
8,192 MB and said nothing about the worker's 512 MB, and on 2026-09-09 it was
the unwatched one that broke: `mlbProjectionsJob` peaked at 385 MB, was
OOM-killed, wrote no breadcrumb (a kill cannot), restarted the worker, and left
the MLB board thirteen hours stale while every other job looked healthy. 5.1 cut
the peak to ~131 MB by transferring only the slate's players.

THE DANGER BAND IS 60%, NOT 100%. The 512 MB is shared with every other job in
JOB_REGISTRY and with the process's own baseline, so a single job approaching
the limit has already lost — this needs to fail while there is still room to
act, not once the worker is dying.
"""
import asyncio
import os
import sys
import threading
import time
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import psutil  # noqa: E402

WORKER_LIMIT_MB = 512
DANGER_FRACTION = 0.60

_proc = psutil.Process(os.getpid())
_peak = [0.0]
_stop = [False]


def _sample():
    while not _stop[0]:
        _peak[0] = max(_peak[0], _proc.memory_info().rss / 1e6)
        time.sleep(0.05)


async def main() -> int:
    import httpx
    import db as _db
    import predict.mlb_prop_serving as ps
    from predict.mlb_board_lines import BOARD_LINES

    t = threading.Thread(target=_sample, daemon=True)
    t.start()
    as_of = date.today()
    async with httpx.AsyncClient() as client:
        subjects, meta = await ps.live_slate_subjects(client, as_of)

    pool = await _db.get_pool()
    started = time.monotonic()
    async with pool.acquire(timeout=900.0) as conn:
        built = await ps.build(conn, as_of, lines=BOARD_LINES, subjects=subjects)
    elapsed = time.monotonic() - started
    _stop[0] = True

    peak = _peak[0]
    pct = peak / WORKER_LIMIT_MB * 100
    limit = WORKER_LIMIT_MB * DANGER_FRACTION
    print(f"  slate            {meta}")
    print(f"  projections      {len(built['served']):,}")
    print(f"  history rows     {built['history_rows']:,}")
    print(f"  elapsed          {elapsed:.1f}s")
    print(f"  PEAK RSS         {peak:,.0f} MB of {WORKER_LIMIT_MB} MB  ({pct:.0f}%)")
    print(f"  danger band      {limit:,.0f} MB ({DANGER_FRACTION:.0%} — the plan "
          f"is shared with 37 other jobs)")
    ok = peak < limit
    print(f"  VERDICT: {'PASS' if ok else 'FAIL'} — "
          f"{'comfortably inside the plan'
             if ok else 'one job is using most of the worker; an OOM kill writes no breadcrumb'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
