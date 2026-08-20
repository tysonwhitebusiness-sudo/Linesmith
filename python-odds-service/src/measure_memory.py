"""One-off (re-runnable) measurement of the real memory blocker: does this
service fit Render's 512MB plan? Samples this process's own RSS via psutil
on a background thread while running the real jobs sequentially — same
one-at-a-time execution Constraint 2 requires in production, not a synthetic
benchmark.

Deliberately does NOT touch job_sportsgameodds or SportsGameOdds's share of
job_nfl/job_cfb — that account is mid "let it clear" per
docs/phase2-hardening-gameplan-2026-08-20.md item 1, and doesn't need
touching anyway: the actual Constraint-1 risk (a provider's whole-board
response materialized before filtering) lives in fetch_sharpapi and
fetch_parlayapi specifically (see providers.py / the architecture doc's
"True streaming (ijson)" open item) — SportsGameOdds's own fetch is already
per-game, not whole-board. SPORTSGAMEODDS_ENABLED is monkeypatched off for
the NFL/CFB runs so asyncio.gather doesn't fire that half of the pair.

Run: ../.venv/Scripts/python.exe measure_memory.py
"""
import asyncio
import os
import threading
import time

import psutil

import config
import jobs

_proc = psutil.Process(os.getpid())


class PeakSampler:
    def __init__(self, interval: float = 0.05):
        self.interval = interval
        self.peak_rss = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.is_set():
            rss = _proc.memory_info().rss
            if rss > self.peak_rss:
                self.peak_rss = rss
            time.sleep(self.interval)

    def __enter__(self):
        self.peak_rss = _proc.memory_info().rss
        self._thread.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self._thread.join()


def mb(n: int) -> float:
    return round(n / (1024 * 1024), 1)


async def measured(label: str, coro):
    baseline = _proc.memory_info().rss
    with PeakSampler() as sampler:
        t0 = time.monotonic()
        summary = await coro
        elapsed = time.monotonic() - t0
    print(
        f"[{label}] elapsed={elapsed:.1f}s baseline={mb(baseline)}MB "
        f"peak={mb(sampler.peak_rss)}MB delta={mb(sampler.peak_rss - baseline)}MB "
        f"rows_written={summary.get('rows_written')} ok={summary.get('ok')}",
        flush=True,
    )
    return sampler.peak_rss


async def main():
    print(f"[measure] process baseline RSS at start: {mb(_proc.memory_info().rss)}MB", flush=True)

    overall_peak = _proc.memory_info().rss

    # Tier 1 — exercises fetch_sharpapi's whole-board materialization.
    overall_peak = max(overall_peak, await measured("tier1", jobs.job_tier1()))

    # NFL / CFB — exercises fetch_parlayapi's whole-board materialization.
    # SportsGameOdds deliberately disabled for this run only (restored after).
    original_sgo = config.SPORTSGAMEODDS_ENABLED
    config.SPORTSGAMEODDS_ENABLED = False
    try:
        overall_peak = max(overall_peak, await measured("nfl (parlayapi only)", jobs.job_nfl()))
        overall_peak = max(overall_peak, await measured("cfb (parlayapi only)", jobs.job_cfb()))
    finally:
        config.SPORTSGAMEODDS_ENABLED = original_sgo

    # Soccer/EPL — Propline, low volume, included for completeness.
    overall_peak = max(overall_peak, await measured("soccer_epl", jobs.job_soccer_epl()))

    print(f"\n[measure] OVERALL PEAK RSS across all measured jobs: {mb(overall_peak)}MB", flush=True)
    print(f"[measure] Render plan budget: 512MB — headroom: {512 - mb(overall_peak):.1f}MB", flush=True)
    print(
        "[measure] NOT measured (deliberately, see module docstring): job_sportsgameodds "
        "and the SportsGameOdds half of job_nfl/job_cfb — that fetch is per-game, not "
        "whole-board, so it's not the Constraint-1 risk this script targets.",
        flush=True,
    )


if __name__ == "__main__":
    asyncio.run(main())
