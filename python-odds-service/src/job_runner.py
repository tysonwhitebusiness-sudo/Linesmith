"""Generic provider-running infrastructure — the backend half of this
codebase's "plug and play" convention. CLAUDE.md documents the frontend
version: one shared component, one adapter per sport, never a
`sport === 'x'` branch inside the shared render logic. This is the same
idea applied to the odds-refresh jobs: one shared runner, one
`list[ProviderSpec]` declared per sport/job in jobs.py, never a hand-rolled
copy of the cap-check/fetch/record-spend/write sequence per job.

That sequence used to be duplicated four times (`_job_tier1_inner`,
`_job_sportsgameodds_inner`, `_job_multisport_inner`, `_job_soccer_epl_inner`)
and each copy had to independently remember every step — which is exactly
how Propline and ParlayAPI both ended up running with zero rate-limit
checking for a real stretch of time (see
docs/phase2-hardening-gameplan-2026-08-20.md items 3-4): the bug wasn't bad
logic, it was one of four near-identical call sites simply not having the
check written into it yet. Centralizing the sequence here means every
provider gets cap-checking, spend-recording, and row-writing for free just
by being declared as a ProviderSpec — there's no longer a per-job place to
forget it, and no separate place for error-handling/rate-limiting/writing
conventions to drift between sports.

Adding a new sport in the future:
  1. A games loader in game_context.py, if one doesn't already cover it.
  2. A fetch_* function in providers.py for any new provider (or reuse an
     existing one — SportsGameOdds already spans MLB/NFL/CFB/Soccer).
  3. A list[ProviderSpec] for that sport's providers, declared in jobs.py.
  4. One line in JOB_REGISTRY.
Nothing in this file, db.py's rate/budget functions, or health_check.py's
monitoring needs to change for any of that — they already operate generically
over whatever's registered.
"""
import asyncio
import time

import db
import providers
from providers import FetchOutcome, ProviderSpec


async def run_provider_specs(
    client,
    games: list,
    specs: list[ProviderSpec],
    yield_fn=None,
    concurrent: bool = False,
) -> dict:
    """Runs every enabled spec's cap-check -> fetch -> spend-record sequence,
    then writes whatever rows came back and returns the standard job summary
    shape every job function's `_run_timed` wrapper expects.

    `concurrent` controls whether specs run one-at-a-time (Tier 1 and
    Soccer/EPL's real, already-tested shape — sequential, matching
    tier1Refresh.ts's own per-provider loop) or via asyncio.gather (NFL/CFB's
    real shape — matches multiSportRefresh.ts's Promise.all([ParlayAPI,
    SportsGameOdds]), bounded intra-job concurrency already proven safe,
    not the job-to-job pattern Constraint 2 forbids). Each job passes
    whichever matches its own already-verified behavior — this file doesn't
    default to concurrent, since that would be a real behavior change for
    jobs that were only ever tested sequentially.
    """

    async def run_one(spec: ProviderSpec) -> FetchOutcome | None:
        if not spec.enabled:
            return None

        # THE PER-PROVIDER FLOOR, checked before the cap reservation so a
        # throttled cycle does not burn an entry ticket it will not use.
        #
        # Persisted through snapshot_cache rather than an in-process timer on
        # purpose: an in-process timer resets on every restart, so a crash-loop
        # would let a daily-capped provider fire on each boot and outspend the
        # throttle meant to protect it. Same mechanism gameday.py already uses
        # for its warm-tier throttle.
        if spec.min_interval_seconds:
            last = await db.read_snapshot_with_age(f"provider-throttle:{spec.provider_id}")
            if last is not None and last[1] < spec.min_interval_seconds:
                # A WARNING, NOT A SILENT SUCCESS. A cycle that deliberately did
                # not fetch must stay distinguishable from one that fetched --
                # gameday.skip_summary() returning a successful shape is exactly
                # what let refreshNflJob report healthy for twelve days while
                # producing nothing.
                return FetchOutcome(
                    provider_id=spec.provider_id,
                    warnings=[
                        f"{spec.provider_id} throttled -- last run {last[1]:.0f}s ago, "
                        f"min interval {spec.min_interval_seconds:.0f}s"
                    ],
                )

        cap = spec.effective_cap
        if spec.cap_kind != "none" and cap is not None:
            # Task 5.12 (P4 M8): CHECK AND RESERVE ARE ONE STATEMENT.
            # This used to read `spent` and compare it, then spend later — so
            # two processes could both read "under cap" and both go on to
            # spend. try_reserve_* increments conditionally and tells us
            # whether we got it, so only one of them can claim the last unit.
            #
            # One unit is reserved as an ENTRY TICKET, not the full cost: a
            # provider's real request count is not knowable until after the
            # fetch (Propline alone makes 1 + 2N requests for N games). The
            # remainder is recorded below. This closes the race the finding
            # describes — two callers passing the same gate — rather than
            # claiming a precision the call shape cannot support.
            if spec.cap_kind == "daily":
                got = await db.try_reserve_daily(spec.provider_id, 1, cap)
            else:
                got = await db.try_reserve_monthly(spec.provider_id, 1, cap, unit=spec.spend_unit)
            if not got:
                which = "soft cap" if spec.soft_cap and cap == spec.soft_cap else "cap"
                return FetchOutcome(
                    provider_id=spec.provider_id,
                    warnings=[f"{spec.provider_id} {spec.cap_kind} {which} reached ({cap}) — easing off"],
                )
        outcome = await spec.fetch(client, games, yield_fn)
        if spec.min_interval_seconds:
            # Stamped AFTER the fetch, so a fetch that raised does not start the
            # clock on a run that never happened.
            await db.write_snapshot(f"provider-throttle:{spec.provider_id}", str(time.time()))
        spend = outcome.objects if spec.spend_unit == "objects" else outcome.requests
        if spend and spec.cap_kind != "none":
            # Minus the unit already reserved above, so the ticket is not
            # double-counted. A provider that made no request at all still
            # leaves its reservation spent, which is the conservative
            # direction: it over-counts by at most one per cycle rather than
            # letting a failed fetch look free.
            remainder = max(0, spend - 1)
            if remainder:
                record_fn = db.record_daily_spend if spec.cap_kind == "daily" else db.record_monthly_spend
                record_kwargs = {"objects": remainder} if spec.spend_unit == "objects" else {"requests": remainder}
                await record_fn(spec.provider_id, **record_kwargs)
        return outcome

    # Task 5.10 (P2 H4). `asyncio.gather` without return_exceptions=True
    # propagates the FIRST exception and DISCARDS every sibling's result — so
    # one provider raising threw away rows the other providers had already
    # fetched AND ALREADY PAID FOR. The sequential branch had the same defect
    # for a different reason: an exception escaping mid-list abandoned the
    # outcomes collected before it. Both now collect exceptions as values and
    # persist whatever did come back.
    if concurrent:
        results = await asyncio.gather(*(run_one(spec) for spec in specs), return_exceptions=True)
    else:
        results = []
        for spec in specs:
            try:
                results.append(await run_one(spec))
            except Exception as exc:  # noqa: BLE001 — recorded below, not swallowed
                results.append(exc)

    # A provider that raised becomes a warning, not a lost job. The rows its
    # siblings fetched are written below exactly as if it had returned empty.
    provider_failures: list[str] = []
    outcomes: list[FetchOutcome] = []
    for spec, result in zip(specs, results):
        if isinstance(result, BaseException):
            provider_failures.append(f"{spec.provider_id} raised {type(result).__name__}: {result}")
        elif result is not None:
            outcomes.append(result)
    all_rows = [r for o in outcomes for r in o.rows]
    all_game_line_rows = [r for o in outcomes for r in o.game_line_rows]
    await db.write_prop_odds(all_rows)
    # Same shared, source-keyed table the-odds-api and OddsHarvester already
    # write into (see supabase/migrations/20260825150000_game_odds_book_
    # lines.sql) — a provider gets its game-lines written for free just by
    # populating FetchOutcome.game_line_rows, no new job-level plumbing.
    await db.write_game_odds_book_lines(all_game_line_rows)

    # Task 5.1 / P2 H2 — persist what each provider could NOT resolve. Until
    # now this list was collected and only counted, so odds_unresolved was
    # written solely by the TypeScript pipeline that 2.5 deleted; the table
    # looked healthy while going stale. Written per provider (delete + insert)
    # because it is a snapshot of what is unresolved now, not a log.
    for outcome in outcomes:
        await db.replace_unresolved_for_provider(outcome.provider_id, outcome.unresolved)

    # Task 5.8 (P3 M13). Games no provider supplied a matching event for.
    # Drained and written once per job as a single aggregate row rather than a
    # database write per comparison — every call site loops over a provider's
    # whole event list, so an individual _team_match miss is normal and only a
    # game that matched NOTHING is a real signal.
    team_match_misses = providers.drain_team_match_misses()
    if team_match_misses:
        await db.log_system_event(
            "warn",
            "job_runner.team_match",
            f"{len(team_match_misses)} game(s) matched no provider event",
            "\n".join(team_match_misses[:50]),
        )

    # Task 5.10: a provider that raised is surfaced, never silent. Without
    # this the partial-result fix above would turn a hard failure into an
    # invisible one, which is the exact trade the audit exists to prevent.
    if provider_failures:
        await db.log_system_event(
            "error",
            "job_runner.provider_failure",
            f"{len(provider_failures)} provider(s) raised; siblings' rows still written",
            "\n".join(provider_failures),
        )

    return {
        "games": len(games),
        "rows_matched": sum(o.rows_matched for o in outcomes),
        "rows_written": len(all_rows),
        "game_lines_written": len(all_game_line_rows),
        "unresolved": sum(len(o.unresolved) for o in outcomes),
        "requests": sum(o.requests for o in outcomes),
        "objects": sum(o.objects for o in outcomes),
        "warnings": [w for o in outcomes for w in o.warnings] + provider_failures,
        "provider_failures": len(provider_failures),
        "team_match_misses": len(team_match_misses),
    }
