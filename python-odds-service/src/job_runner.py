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

import db
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
        if spec.cap_kind != "none":
            status_fn = db.daily_status if spec.cap_kind == "daily" else db.monthly_status
            kwargs = {"unit": spec.spend_unit} if spec.cap_kind == "monthly" else {}
            spent = await status_fn(spec.provider_id, spec.cap_limit, **kwargs)
            if spent >= spec.cap_limit:
                return FetchOutcome(
                    provider_id=spec.provider_id,
                    warnings=[f"{spec.provider_id} {spec.cap_kind} cap reached ({spent}/{spec.cap_limit})"],
                )
        outcome = await spec.fetch(client, games, yield_fn)
        spend = outcome.objects if spec.spend_unit == "objects" else outcome.requests
        if spend and spec.cap_kind != "none":
            record_fn = db.record_daily_spend if spec.cap_kind == "daily" else db.record_monthly_spend
            record_kwargs = {"objects": spend} if spec.spend_unit == "objects" else {"requests": spend}
            await record_fn(spec.provider_id, **record_kwargs)
        return outcome

    if concurrent:
        results = await asyncio.gather(*(run_one(spec) for spec in specs))
    else:
        results = [await run_one(spec) for spec in specs]

    outcomes = [o for o in results if o is not None]
    all_rows = [r for o in outcomes for r in o.rows]
    await db.write_prop_odds(all_rows)
    return {
        "games": len(games),
        "rows_matched": sum(o.rows_matched for o in outcomes),
        "rows_written": len(all_rows),
        "unresolved": sum(len(o.unresolved) for o in outcomes),
        "requests": sum(o.requests for o in outcomes),
        "objects": sum(o.objects for o in outcomes),
        "warnings": [w for o in outcomes for w in o.warnings],
    }
