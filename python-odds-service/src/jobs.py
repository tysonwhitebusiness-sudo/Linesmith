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
import gameday
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
    """MLB's SportsGameOdds identity — the original account. Kept dedicated to
    MLB only (2026-08-20) so its real quota no longer competes with NFL/CFB's
    usage; see _sportsgameodds_multisport_spec for that separate account."""
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


def _sportsgameodds_multisport_spec(yield_fn) -> ProviderSpec:
    """Second SportsGameOdds account (2026-08-20, see
    docs/api-capability-audit-2026-08-20.md), dedicated to NFL/CFB. A real,
    separate account — tracked under its own provider_id so its spend is
    never conflated with MLB's, same reasoning as ParlayAPI's per-sport keys
    below."""
    return ProviderSpec(
        provider_id="sportsgameodds_multisport",
        enabled=config.SPORTSGAMEODDS_MULTISPORT_ENABLED,
        fetch=lambda client, games, yf: fetch_sportsgameodds(
            client, config.SPORTSGAMEODDS_MULTISPORT_KEY, games, config.SPORTSGAMEODDS_RATE_PER_MIN, yield_fn=yf
        ),
        cap_kind="monthly",
        cap_limit=config.SPORTSGAMEODDS_MONTHLY_SOFT_CAP,  # same real plan tier as the primary account, same soft-cap discipline
        spend_unit="objects",
    )


# Per-sport ParlayAPI identities (2026-08-20, see
# docs/api-capability-audit-2026-08-20.md) — real, separate free accounts,
# one per sport ParlayAPI actually has real player-prop coverage for
# (confirmed live: NFL, CFB, Soccer/EPL — Tennis has none). Replaces the old
# shared PARLAYAPI_KEY's role for these 3 sports; that key stays defined in
# config.py only as a legacy fallback, no longer the live source here.
_PARLAYAPI_SPORT_CONFIG: dict[str, tuple[str, str | None, bool, int]] = {
    "nfl": ("parlayapi_nfl", config.PARLAYAPI_NFL_KEY, config.PARLAYAPI_NFL_ENABLED, config.PARLAYAPI_NFL_MONTHLY_LIMIT),
    "cfb": ("parlayapi_cfb", config.PARLAYAPI_CFB_KEY, config.PARLAYAPI_CFB_ENABLED, config.PARLAYAPI_CFB_MONTHLY_LIMIT),
    "soccer_epl": (
        "parlayapi_soccer",
        config.PARLAYAPI_SOCCER_KEY,
        config.PARLAYAPI_SOCCER_ENABLED,
        config.PARLAYAPI_SOCCER_MONTHLY_LIMIT,
    ),
}


def _parlayapi_sport_spec(sport: str) -> ProviderSpec:
    provider_id, key, enabled, cap_limit = _PARLAYAPI_SPORT_CONFIG[sport]
    return ProviderSpec(
        provider_id=provider_id,
        enabled=enabled,
        fetch=lambda client, games, yield_fn: fetch_parlayapi(client, key, games, sport),
        cap_kind="monthly",
        cap_limit=cap_limit,  # hard limit, not a soft cap — matches multiSportRefresh.ts's `budget.exhausted` gate
    )


async def _job_multisport(job_name: str, sport: str, yield_fn) -> dict:
    # The free ESPN schedule fetch (game_context.py) always runs every cycle
    # regardless of tier — it's what tells us which tier we're even in.
    # Only the paid provider fetch below is gated. See gameday.py's docstring
    # for the real numbers behind why (flat cadence spent the same 1 credit
    # whether the nearest game was 6 minutes or 6 days out).
    # Same is_final filter MLB's job_tier1/job_sportsgameodds already apply —
    # now real for these sports too (2026-08-20), not always-False.
    games = [g for g in await load_sport_games(sport) if not g.is_final]
    tier, should_fetch = await gameday.should_fetch_paid_providers(sport, games)
    if not should_fetch:
        return await _run_timed(job_name, _return_dict(gameday.skip_summary(games, tier)))

    specs = [_parlayapi_sport_spec(sport), _sportsgameodds_multisport_spec(yield_fn)]
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            job_name, run_provider_specs(client, games, specs, yield_fn=yield_fn, concurrent=True)
        )


async def _return_dict(d: dict) -> dict:
    return d


async def job_nfl(yield_fn=None) -> dict:
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
        # New (2026-08-20): ParlayAPI-soccer is a genuinely separate real
        # provider from Propline, not a redundant second call for the same
        # data — confirmed live coverage (787 rows, team-total-heavy), so
        # it adds real, additional matched props rather than just duplicate
        # rows for the same games. SportsGameOdds is NOT added here — its
        # soccer coverage is MLS/UCL, not EPL (see the capability audit).
        _parlayapi_sport_spec("soccer_epl"),
    ]


async def job_soccer_epl(yield_fn=None) -> dict:
    # Propline has no per-minute cap in config.ts (dailyLimit only) — no
    # pacing-wait shape to yield at, same as Tier 1.
    games = [g for g in await load_sport_games("soccer_epl") if not g.is_final]
    tier, should_fetch = await gameday.should_fetch_paid_providers("soccer_epl", games)
    if not should_fetch:
        return await _run_timed("refreshSoccerEplJob", _return_dict(gameday.skip_summary(games, tier)))

    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "refreshSoccerEplJob", run_provider_specs(client, games, _soccer_epl_specs(), concurrent=False)
        )


# Job registry the queue iterates — (name, coroutine factory, interval_seconds).
# Tier1/SportsGameOdds-MLB intervals match lib/scheduler.ts's original
# constants — refreshCalibration intentionally excluded, see module docstring.
#
# NFL/CFB/Soccer intervals rewritten 2026-08-20 for gameday-proximity gating
# (see gameday.py): this is now the OUTER poll cadence, not the real-spend
# cadence — most cycles at this interval cost nothing (gameday.py's tier
# check gates the actual paid fetch). 20min lets "hot" tier (within 6h of any
# kickoff) genuinely refresh hard, matching the explicit ask ("run a lot more
# refreshes on gameday") — the interval alone no longer has to protect the
# budget the way the old flat 3h/45min intervals did, gameday.py's tiering
# does that job now. See measure_gameday_budget.py for the real worst-case
# monthly cost this produces, checked before landing on 20min specifically.
JOB_REGISTRY = [
    ("refreshTier1", job_tier1, 2.5 * 60),
    ("refreshSportsGameOddsJob", job_sportsgameodds, 90 * 60),
    ("refreshNflJob", job_nfl, 20 * 60),
    ("refreshCfbJob", job_cfb, 20 * 60),
    ("refreshSoccerEplJob", job_soccer_epl, 20 * 60),
]
