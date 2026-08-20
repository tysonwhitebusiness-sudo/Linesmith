"""The five in-scope jobs (`refreshCalibration` excluded — see
docs/phase2-python-service-architecture-2026-08-19.md, it's pure Postgres
aggregation with no provider calls, not part of this port).

Each job function times itself, makes the real provider calls, records real
budget spend, and returns a summary dict — the summary IS the point of this
pass, not the correctness of what gets fetched. Intra-job concurrency is
preserved exactly where the TS code already has it (NFL/CFB's
Promise.all([ParlayAPI, SportsGameOdds]) -> asyncio.gather here) — that's
bounded, already-proven-safe concurrency, not the job-to-job pattern
Constraint 2 forbids.
"""
import asyncio
import time
from datetime import datetime, timezone

import httpx

import config
import db
import providers
from game_context import load_mlb_games, load_sport_games


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


async def _job_tier1_inner() -> dict:
    # No yield_fn param — SharpAPI/Odds-API.io have never shown the
    # multi-window pacing shape in measured runs (SharpAPI's 90s board cache
    # and Odds-API.io's per-game calls both stay under their own limits at
    # Tier 1's own game counts). If that changes, this is where a yield_fn
    # param would be threaded through, same pattern as the other three jobs.
    games = [g for g in await load_mlb_games() if not g.is_final]
    outcomes = []
    async with httpx.AsyncClient() as client:
        if config.SHARPAPI_ENABLED:
            sharp = await providers.fetch_sharpapi(client, config.SHARPAPI_KEY, games)
            outcomes.append(sharp)
            if sharp.requests:
                await db.record_daily_spend("sharpapi", requests=sharp.requests)
        if config.ODDSAPIIO_ENABLED:
            oio = await providers.fetch_oddsapiio(client, config.ODDSAPIIO_KEY, games)
            outcomes.append(oio)
            if oio.requests:
                await db.record_daily_spend("oddsapiio", requests=oio.requests)
    return {
        "games": len(games),
        "rows_matched": sum(o.rows_matched for o in outcomes),
        "requests": sum(o.requests for o in outcomes),
        "warnings": [w for o in outcomes for w in o.warnings],
    }


async def job_tier1(yield_fn=None) -> dict:
    return await _run_timed("refreshTier1", _job_tier1_inner())


async def _job_sportsgameodds_inner(yield_fn) -> dict:
    games = [g for g in await load_mlb_games() if not g.is_final]
    if not config.SPORTSGAMEODDS_ENABLED:
        return {"games": len(games), "rows_matched": 0, "requests": 0, "warnings": ["sportsgameodds disabled"]}
    async with httpx.AsyncClient() as client:
        out = await providers.fetch_sportsgameodds(
            client, config.SPORTSGAMEODDS_KEY, games, config.SPORTSGAMEODDS_RATE_PER_MIN, yield_fn=yield_fn
        )
    if out.objects:
        await db.record_monthly_spend("sportsgameodds", objects=out.objects)
    return {"games": len(games), "rows_matched": out.rows_matched, "objects": out.objects, "warnings": out.warnings}


async def job_sportsgameodds(yield_fn=None) -> dict:
    return await _run_timed("refreshSportsGameOddsJob", _job_sportsgameodds_inner(yield_fn))


async def _job_multisport_inner(sport: str, parlay_enabled: bool, parlay_key: str | None, yield_fn) -> dict:
    games = await load_sport_games(sport)
    async with httpx.AsyncClient() as client:
        tasks = []
        if parlay_enabled:
            tasks.append(providers.fetch_parlayapi(client, parlay_key, games, sport))
        if config.SPORTSGAMEODDS_ENABLED:
            tasks.append(
                providers.fetch_sportsgameodds(
                    client, config.SPORTSGAMEODDS_KEY, games, config.SPORTSGAMEODDS_RATE_PER_MIN, yield_fn=yield_fn
                )
            )
        outcomes = await asyncio.gather(*tasks) if tasks else []

    for o in outcomes:
        if o.provider_id == "parlayapi" and o.requests:
            await db.record_monthly_spend("parlayapi", requests=o.requests)
        if o.provider_id == "sportsgameodds" and o.objects:
            await db.record_monthly_spend("sportsgameodds", objects=o.objects)

    return {
        "games": len(games),
        "rows_matched": sum(o.rows_matched for o in outcomes),
        "requests": sum(o.requests for o in outcomes),
        "objects": sum(o.objects for o in outcomes),
        "warnings": [w for o in outcomes for w in o.warnings],
    }


async def job_nfl(yield_fn=None) -> dict:
    # ParlayAPI's general key covers NFL (per config.ts's parlayApiConfig, not the MLB-dedicated key).
    return await _run_timed(
        "refreshNflJob", _job_multisport_inner("nfl", config.PARLAYAPI_ENABLED, config.PARLAYAPI_KEY, yield_fn)
    )


async def job_cfb(yield_fn=None) -> dict:
    # CFB measured 1.5-2.75s in both runs so far — far under one pacing
    # window (its game count doesn't push SportsGameOdds past 10/min the way
    # NFL's 32 games do). Still wired through yield_fn: if CFB's slate grows
    # (more games scheduled on a given day) it hits the exact same shape NFL
    # does, and this is what makes that generic rather than an NFL special
    # case, per the instruction not to special-case this to NFL alone.
    return await _run_timed(
        "refreshCfbJob", _job_multisport_inner("cfb", config.PARLAYAPI_ENABLED, config.PARLAYAPI_KEY, yield_fn)
    )


async def _job_soccer_epl_inner() -> dict:
    # Propline has no per-minute cap in config.ts (dailyLimit only) — no
    # pacing-wait shape to yield at, same as Tier 1.
    games = await load_sport_games("soccer_epl")
    if not config.PROPLINE_2_ENABLED:
        return {"games": len(games), "rows_matched": 0, "requests": 0, "warnings": ["propline_2 disabled"]}
    async with httpx.AsyncClient() as client:
        out = await providers.fetch_propline(client, config.PROPLINE_2_KEY, games, "soccer_epl")
    if out.requests:
        await db.record_daily_spend("propline_2", requests=out.requests)
    return {"games": len(games), "rows_matched": out.rows_matched, "requests": out.requests, "warnings": out.warnings}


async def job_soccer_epl(yield_fn=None) -> dict:
    return await _run_timed("refreshSoccerEplJob", _job_soccer_epl_inner())


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
