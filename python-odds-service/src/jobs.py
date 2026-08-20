"""The five in-scope jobs (`refreshCalibration` excluded — see
docs/phase2-python-service-architecture-2026-08-19.md, it's pure Postgres
aggregation with no provider calls, not part of this port).

Each job function times itself, makes the real provider calls, records real
budget spend, writes resolved rows to prop_odds, and returns a summary dict.
Intra-job concurrency is preserved exactly where the TS code already has it
(NFL/CFB's Promise.all([ParlayAPI, SportsGameOdds]) -> asyncio.gather here)
— that's bounded, already-proven-safe concurrency, not the job-to-job
pattern Constraint 2 forbids.

Real writes as of 2026-08-20: every job now calls db.write_prop_odds() on
whatever it resolved, same as the live TS jobs do via registry.ts's
runProviderFetch. This is the step that had been deliberately deferred —
entity resolution and the write path were each built and tested in
isolation first; this is where they're actually connected.

Restructured 2026-08-20 to declare each sport's providers as
list[ProviderSpec] and delegate the actual cap-check/fetch/record/write
sequence to job_runner.run_provider_specs — see that module's docstring for
why (four near-identical hand-rolled copies of that sequence is exactly how
Propline and ParlayAPI each silently ran unrated for a stretch). This also
closed real, newly-discovered cap-check gaps that existed independently of
the restructuring: Odds-API.io never had its persisted daily budget
pre-checked (only its in-process hourly rate limiter), and neither
SportsGameOdds's monthly soft cap nor ParlayAPI's monthly hard cap were ever
pre-checked in this port at all — each now has the same real gate its TS
equivalent does (tier1Refresh.ts, sportsGameOddsRefresh.ts,
multiSportRefresh.ts).
"""
import time
from datetime import datetime, timezone

import httpx

import config
import db
from game_context import load_mlb_games, load_sport_games
from job_runner import run_provider_specs
from providers import ProviderSpec, fetch_oddsapiio, fetch_parlayapi, fetch_propline, fetch_sharpapi, fetch_sportsgameodds


async def _run_timed(job_name: str, coro) -> dict:
    started = datetime.now(timezone.utc)
    t0 = time.monotonic()
    summary: dict = {"job": job_name, "started_at": started.isoformat()}
    try:
        result = await coro
        summary.update(result)
        summary["ok"] = True
    except Exception as e:  # rough harness — log and move on, never let one job's exception kill the queue
        summary["ok"] = False
        summary["error"] = f"{type(e).__name__}: {e}"
    summary["elapsed_seconds"] = round(time.monotonic() - t0, 2)
    await db.write_job_run_log(job_name, summary)
    return summary


def _tier1_specs() -> list[ProviderSpec]:
    return [
        ProviderSpec(
            provider_id="sharpapi",
            enabled=config.SHARPAPI_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_sharpapi(client, config.SHARPAPI_KEY, games),
            cap_kind="none",  # job-level (not per-game) call frequency already stays well under its per-minute vendor limit
        ),
        ProviderSpec(
            provider_id="oddsapiio",
            enabled=config.ODDSAPIIO_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_oddsapiio(client, config.ODDSAPIIO_KEY, games, config.ODDSAPIIO_RATE_PER_HOUR),
            cap_kind="daily",
            cap_limit=config.ODDSAPIIO_DAILY_LIMIT,
        ),
        ProviderSpec(
            # Propline's general/MLB identity genuinely belongs in Tier 1
            # (per its own TS header comment) but ran there for a long time
            # with no rate-limit or budget check at all — the exact bug
            # fixed on the TS side in tier1Refresh.ts (see
            # docs/phase2-hardening-gameplan-2026-08-20.md item 4).
            provider_id="propline",
            enabled=config.PROPLINE_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_propline(client, config.PROPLINE_KEY, games, "mlb"),
            cap_kind="daily",
            cap_limit=config.PROPLINE_DAILY_LIMIT,
        ),
    ]


async def job_tier1(yield_fn=None) -> dict:
    # No yield_fn threaded to any spec here — SharpAPI/Odds-API.io/Propline
    # have never shown the multi-window pacing shape in measured runs. If
    # that changes for one of these, this is where a yield-aware fetch would
    # get threaded through, same pattern as the SportsGameOdds specs below.
    games = [g for g in await load_mlb_games() if not g.is_final]
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "refreshTier1", run_provider_specs(client, games, _tier1_specs(), concurrent=False)
        )


def _sportsgameodds_spec(yield_fn) -> ProviderSpec:
    return ProviderSpec(
        provider_id="sportsgameodds",
        enabled=config.SPORTSGAMEODDS_ENABLED,
        fetch=lambda client, games, yf: fetch_sportsgameodds(
            client, config.SPORTSGAMEODDS_KEY, games, config.SPORTSGAMEODDS_RATE_PER_MIN, yield_fn=yf
        ),
        cap_kind="monthly",
        cap_limit=config.SPORTSGAMEODDS_MONTHLY_SOFT_CAP,  # soft cap, not the hard monthlyLimit — matches sportsGameOddsRefresh.ts's real gate
        spend_unit="objects",
    )


async def job_sportsgameodds(yield_fn=None) -> dict:
    games = [g for g in await load_mlb_games() if not g.is_final]
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "refreshSportsGameOddsJob",
            run_provider_specs(client, games, [_sportsgameodds_spec(yield_fn)], yield_fn=yield_fn, concurrent=False),
        )


def _multisport_specs(sport: str, parlay_key: str | None, yield_fn) -> list[ProviderSpec]:
    return [
        ProviderSpec(
            provider_id="parlayapi",
            enabled=config.PARLAYAPI_ENABLED,
            fetch=lambda client, games, yf: fetch_parlayapi(client, parlay_key, games, sport),
            cap_kind="monthly",
            cap_limit=config.PARLAYAPI_MONTHLY_LIMIT,  # hard limit, not a soft cap — matches multiSportRefresh.ts's `budget.exhausted` gate
        ),
        _sportsgameodds_spec(yield_fn),
    ]


async def _job_multisport(job_name: str, sport: str, yield_fn) -> dict:
    games = await load_sport_games(sport)
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            job_name,
            run_provider_specs(
                client, games, _multisport_specs(sport, config.PARLAYAPI_KEY, yield_fn), yield_fn=yield_fn, concurrent=True
            ),
        )


async def job_nfl(yield_fn=None) -> dict:
    # ParlayAPI's general key covers NFL (per config.ts's parlayApiConfig, not the MLB-dedicated key).
    return await _job_multisport("refreshNflJob", "nfl", yield_fn)


async def job_cfb(yield_fn=None) -> dict:
    # CFB measured 1.5-2.75s in both runs so far — far under one pacing
    # window (its game count doesn't push SportsGameOdds past 10/min the way
    # NFL's 32 games do). Still wired through yield_fn: if CFB's slate grows
    # (more games scheduled on a given day) it hits the exact same shape NFL
    # does, and this is what makes that generic rather than an NFL special
    # case, per the instruction not to special-case this to NFL alone.
    return await _job_multisport("refreshCfbJob", "cfb", yield_fn)


def _soccer_epl_specs() -> list[ProviderSpec]:
    return [
        ProviderSpec(
            # No pre-fetch cap check here, matching TS: multiSportRefresh.ts's
            # refreshSoccerEpl -> refreshOneProvider has no budget gate for
            # propline_2 at all (unlike propline's MLB identity). A real gap
            # in both languages, not something this restructuring silently
            # invented a fix for — flagging, not fixing, matching the existing
            # "found in the process, not yet acted on" convention.
            provider_id="propline_2",
            enabled=config.PROPLINE_2_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_propline(client, config.PROPLINE_2_KEY, games, "soccer_epl"),
            cap_kind="none",
        ),
    ]


async def job_soccer_epl(yield_fn=None) -> dict:
    # Propline has no per-minute cap in config.ts (dailyLimit only) — no
    # pacing-wait shape to yield at, same as Tier 1.
    games = await load_sport_games("soccer_epl")
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "refreshSoccerEplJob", run_provider_specs(client, games, _soccer_epl_specs(), concurrent=False)
        )


# Job registry the queue iterates — (name, coroutine factory, interval_seconds).
# Intervals match lib/scheduler.ts exactly (TIER1_INTERVAL_MS etc.) — refreshCalibration
# intentionally excluded, see module docstring.
JOB_REGISTRY = [
    ("refreshTier1", job_tier1, 2.5 * 60),
    ("refreshSportsGameOddsJob", job_sportsgameodds, 90 * 60),
    ("refreshNflJob", job_nfl, 3 * 60 * 60),
    ("refreshCfbJob", job_cfb, 3 * 60 * 60),
    ("refreshSoccerEplJob", job_soccer_epl, 45 * 60),
]
