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
        # Real bug #3, caught by a genuine production run on Render: a job's
        # timeout was measured as pure wall-clock time since it started,
        # which includes any nested job(s) it yielded to. refreshCfbJob's
        # own yield chain (backing off SportsGameOdds, yielding to Tier 1
        # three times) legitimately took 480s of REAL nested work — none of
        # it CfbJob's own — and that alone was enough to blow through
        # refreshSportsGameOddsJob's 600s budget one level up, cancelling a
        # job that was never actually doing 600s of its own work.
        #
        # First attempt at a fix (crediting excused time only AFTER a nested
        # call finished) was itself wrong — caught by verify_timeout_fix.py
        # before it ever reached a real test: the outer job's own polling
        # loop kept counting elapsed time in real time while the nested call
        # was still in progress, so it hit its own limit before the credit
        # was ever applied. Fixed by marking a job "paused" the MOMENT it
        # yields (not after), so live elapsed-time checks correctly exclude
        # time it's currently blocked on a nested job, not just time from
        # nested jobs that already finished.
        self._excused_seconds: dict[str, float] = {}  # finalized, from yields that have already returned
        self._paused_since: dict[str, float] = {}  # job name -> monotonic timestamp it entered its current yield, if any

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

    def _own_elapsed(self, name: str, start: float) -> float:
        """Elapsed time counted against `name`'s own timeout budget — total
        wall-clock time since it started, minus (a) time already excused
        from yields that have finished, and (b) time it's *currently*
        blocked on an in-progress yield, checked live rather than only after
        that yield returns."""
        now = time.monotonic()
        excused = self._excused_seconds.get(name, 0.0)
        paused_since = self._paused_since.get(name)
        if paused_since is not None:
            excused += now - paused_since
        return (now - start) - excused

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
        # Mark `caller` paused BEFORE the nested call starts, not after it
        # finishes — this is what makes live timeout checks against `caller`
        # correctly exclude time it's still waiting on, not just time from
        # already-completed yields. A multi-level chain (NflJob yields ->
        # CfbJob yields -> Tier1) is handled correctly by construction: each
        # level's own pause window spans exactly as long as its own direct
        # nested call takes, whatever that call does internally.
        self._paused_since[caller] = time.monotonic()
        try:
            await self._run_one(name, fn)
        finally:
            paused_start = self._paused_since.pop(caller, None)
            if paused_start is not None:
                self._excused_seconds[caller] = self._excused_seconds.get(caller, 0.0) + (
                    time.monotonic() - paused_start
                )
        return True

    async def _run_one(self, name: str, fn) -> None:
        self._running.add(name)
        self._ever_run.add(name)
        self._excused_seconds[name] = 0.0
        print(f"[queue] starting {name}", flush=True)
        start = time.monotonic()
        yield_fn = functools.partial(self.maybe_yield, name)
        task = asyncio.ensure_future(fn(yield_fn=yield_fn))
        try:
            while True:
                done, _pending = await asyncio.wait({task}, timeout=1.0)
                if task in done:
                    break
                own_elapsed = self._own_elapsed(name, start)
                if own_elapsed >= JOB_TIMEOUT_SECONDS:
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
                    total_excused = (time.monotonic() - start) - own_elapsed
                    print(
                        f"[queue] {name} exceeded {JOB_TIMEOUT_SECONDS}s of its OWN time "
                        f"(excused {total_excused:.0f}s spent on nested yields) — cancelled",
                        flush=True,
                    )
                    return

            try:
                summary = task.result()
            except Exception as e:
                # A job's own code already catches its own exceptions
                # (jobs.py's _run_timed) — this is a last-resort net so a
                # genuinely unexpected bug still can't take the whole queue
                # down with it.
                print(f"[queue] {name} raised unexpectedly: {type(e).__name__}: {e}", flush=True)
                return

            print(
                f"[queue] finished {name}: {summary.get('elapsed_seconds')}s, "
                f"games={summary.get('games')}, rows_matched={summary.get('rows_matched')}, "
                f"rows_written={summary.get('rows_written')}, unresolved={summary.get('unresolved')}, "
                f"ok={summary.get('ok')}, warnings={len(summary.get('warnings', []))}",
                flush=True,
            )
            if summary.get("warnings"):
                for w in summary["warnings"][:5]:
                    print(f"    warn: {w}", flush=True)
        finally:
            self.last_run_end[name] = time.monotonic()
            self._running.discard(name)
            self._excused_seconds.pop(name, None)
