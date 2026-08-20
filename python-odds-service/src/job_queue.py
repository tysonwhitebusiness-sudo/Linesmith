"""Constraint 2 — single sequential queue, no job-to-job concurrency.

One asyncio loop. Exactly one job's actual work in flight at a time — never
a setInterval-per-job pattern like lib/scheduler.ts's. Ordering is
overdue-ratio priority, not FIFO: each job tracks (now - last_run_end) /
interval, and whichever due job has the highest ratio runs next.

Yield-based cooperation (the resolved OPEN RISK, see
docs/phase2-python-service-architecture-2026-08-19.md): a long job like NFL
spends most of its ~183s measured duration in forced pacing waits for
SportsGameOdds's real per-minute cap, not doing continuous work. Rather than
give Tier 1 permission to interrupt NFL mid-flight (new pause/resume state,
a paused job's memory held alongside Tier 1's, real ambiguity about what
"safely paused" means for in-progress work), NFL calls back into
`maybe_yield()` at each of those existing wait points. If something else is
genuinely due, it runs to completion first; NFL resumes its own next batch
right after. Exactly one job's logic is ever actually executing — "one job"
now just has natural checkpoints where control can pass elsewhere and come
back, proven safe in isolation first by poc_yield.py before this real
version was written.
"""
import asyncio
import functools
import time

JOB_TIMEOUT_SECONDS = 10 * 60


class SequentialQueue:
    def __init__(self, registry: list[tuple[str, callable, float]]):
        self.registry = registry
        self.last_run_end: dict[str, float] = {name: 0.0 for name, _, _ in registry}
        # Guards against a job being started while it (or, degenerately, a
        # yield chain rooted in it) is already running — mirrors
        # poc_yield.py's PocQueue._running, carried over unchanged since the
        # POC run confirmed it's exactly what prevents double-execution.
        self._running: set[str] = set()
        # Real bug caught by an actual run, not by poc_yield.py (which never
        # modeled the burst step): a job pulled forward via a yield during
        # an EARLIER job's turn (e.g. NflJob yielding to CfbJob before CfbJob
        # would otherwise have had its own burst slot) was then started a
        # SECOND time when the burst loop reached its own registry position
        # for that same job, since the loop had no memory of what already
        # ran via a yield. Tracked here so the burst loop can skip it.
        self._ever_run: set[str] = set()

    def _most_overdue(self, exclude: set[str] = frozenset()) -> tuple[str, callable, float, float] | None:
        """Returns (name, fn, interval, ratio) for whichever eligible job has
        been waiting proportionally longest, or None if the registry (minus
        `exclude`) is empty. Caller still has to check ratio >= 1 — this
        just orders candidates, it doesn't decide "due"."""
        now = time.monotonic()
        scored = []
        for name, fn, interval in self.registry:
            if name in exclude or name in self._running:
                continue
            elapsed = now - self.last_run_end[name]
            ratio = elapsed / interval if interval > 0 else float("inf")
            scored.append((ratio, name, fn, interval))
        if not scored:
            return None
        scored.sort(key=lambda x: x[0], reverse=True)
        ratio, name, fn, interval = scored[0]
        return name, fn, interval, ratio

    async def run_forever(self) -> None:
        # Fire every job once immediately, in registry order — mirrors
        # scheduler.ts's "void refreshX()" burst at startup, but sequential
        # here instead of concurrent (that burst is exactly what Constraint 2
        # forbids replicating).
        for name, fn, _ in self.registry:
            if name in self._ever_run:
                # Already ran once via a yield triggered by an earlier job
                # in this same burst — don't run it again.
                print(f"[queue] skipping {name} in startup burst — already ran via a yield", flush=True)
                continue
            await self._run_one(name, fn)

        while True:
            candidate = self._most_overdue()
            if candidate is None or candidate[3] < 1.0:
                # Nothing's actually due yet — sleep until the soonest job
                # is genuinely due, or a short poll tick, whichever is
                # sooner. Never busy-loop (the original bug this queue had:
                # running whichever job was CLOSEST to due immediately,
                # regardless of its real interval).
                if candidate is None:
                    wait_seconds = 5.0
                else:
                    _, _, interval, ratio = candidate
                    wait_seconds = min((1.0 - ratio) * interval, 30.0)
                await asyncio.sleep(max(wait_seconds, 1.0))
                continue
            name, fn, _, _ = candidate
            await self._run_one(name, fn)

    async def maybe_yield(self, caller: str, wait_hint: float) -> bool:
        """Called from WITHIN a running job's own coroutine, at a point
        where it would otherwise just sleep to respect a provider's rate
        limit. Checks every OTHER registered, not-already-running job's
        overdue ratio; if something is genuinely due (ratio >= 1), runs it
        to completion and returns True — the caller should re-check its own
        wait condition immediately, not sleep the full amount. Returns False
        if nothing else is due, meaning the caller should perform its own
        (short) wait instead.

        `wait_hint` isn't currently used to bound the search — kept in the
        signature because a real implementation may want it later (e.g. to
        decide whether yielding is even worth the overhead for a very short
        remaining wait). Rough pass: always check.
        """
        candidate = self._most_overdue(exclude={caller})
        if candidate is None or candidate[3] < 1.0:
            return False
        name, fn, _, ratio = candidate
        print(f"[queue]   {caller} yields -> running {name} (ratio was {ratio:.2f})", flush=True)
        await self._run_one(name, fn)
        return True

    async def _run_one(self, name: str, fn) -> None:
        self._running.add(name)
        self._ever_run.add(name)
        print(f"[queue] starting {name}", flush=True)
        try:
            yield_fn = functools.partial(self.maybe_yield, name)
            summary = await asyncio.wait_for(fn(yield_fn=yield_fn), timeout=JOB_TIMEOUT_SECONDS)
            print(
                f"[queue] finished {name}: {summary.get('elapsed_seconds')}s, "
                f"games={summary.get('games')}, rows_matched={summary.get('rows_matched')}, "
                f"ok={summary.get('ok')}, warnings={len(summary.get('warnings', []))}",
                flush=True,
            )
            if summary.get("warnings"):
                for w in summary["warnings"][:5]:
                    print(f"    warn: {w}", flush=True)
        except asyncio.TimeoutError:
            print(f"[queue] {name} exceeded {JOB_TIMEOUT_SECONDS}s timeout — cancelled", flush=True)
        finally:
            self.last_run_end[name] = time.monotonic()
            self._running.discard(name)
