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
import asyncio
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone

import httpx

import config
import db
import statcast_pitches
import nhl_shots
import nba_shots
import nfl_pbp
import gameday
from game_context import load_mlb_games, load_nhl_games, load_sport_games, load_tennis_games
from job_runner import run_provider_specs
from archival_bridge import archive_closing_lines, archive_props, archive_results
from provider_matrix import MLB_SGO_ONLY, specs_for
from providers import (
    fetch_oddsapiio,
    fetch_parlayapi,
    fetch_propline,
    fetch_sharpapi,
    fetch_sharpapi_game_lines,
    fetch_sportsgameodds,
)


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
        # The one-line message alone is not enough to act on. P3 L4 recorded
        # both tennis jobs failing with "TypeError: normalize() argument 2 must
        # be str, not None", and that string identified neither the call site
        # nor the row that carried the None.
        #
        # How much that cost, concretely: the same jobs ran green on a laptop
        # and red on Render, and the obvious reading — a data-dependent upstream
        # payload — was wrong. The real cause was a missing `or ""` in
        # load_tennis_games, fixed in commit 87fa65e days earlier and never
        # pushed, so production had simply never received it. A traceback would
        # have named game_context.py in one line instead of costing a day and a
        # false hypothesis.
        #
        # Tail, not head: the innermost frames name the real call site, and the
        # whole summary is a JSON blob in snapshot_cache.
        summary["traceback"] = "".join(traceback.format_exc().splitlines(keepends=True)[-12:])
    summary["elapsed_seconds"] = round(time.monotonic() - t0, 2)

    # Phase 5.S.9 — WORKER RAM IS A CEILING TOO, AND IT HAD NO ALARM.
    # The 512 MB Render plan is as hard a limit as the 8,192 MB database, and it
    # has already OOM-killed a job in this phase — but nothing recorded it, so
    # the only way to learn the worker was near its limit was to watch it die.
    # Database size had `pg_database_size`; RAM had a one-off script.
    #
    # RSS is the whole PROCESS, not this job: the queue is sequential, so the
    # reading is "the worker's high-water mark as of this job", which is exactly
    # what a ceiling alarm wants. It is best-effort — psutil is a measurement
    # dependency and a monitoring read must never be able to fail a real job.
    try:
        import psutil

        summary["rss_mb"] = round(psutil.Process().memory_info().rss / 1e6, 1)
    except Exception:                                        # noqa: BLE001
        pass

    # BLOB CACHE VISIBILITY. The validation cache (blob_cache.py) is the main
    # egress fix, and its effect was being INFERRED from pg_stat_statements call
    # counts rather than observed. Hit RATE alone is misleading here: tiny
    # `provider-throttle:*` keys are rewritten every job run and therefore always
    # miss, dragging the rate down while costing ~80 bytes each, whereas the
    # expensive keys (mlb:snapshot at 6.6 MB) hit. `saved_mb` is the figure that
    # actually maps to the bill, so record both and stop guessing.
    try:
        import blob_cache
        cs = blob_cache.stats()
        summary["cache_hit_rate"] = round(cs["hit_rate"], 3)
        summary["cache_saved_mb"] = round(cs["saved_bytes"] / 1e6, 1)
        summary["cache_fetched_mb"] = round(cs["bytes_fetched"] / 1e6, 1)
    except Exception:                                        # noqa: BLE001
        pass

    # CARRY A SKIP STREAK FORWARD. gameday.skip_summary sets fetched=False for a
    # cycle that ran but deliberately called no provider. One of those is the
    # tier gate working; a long unbroken run of them means either nothing is
    # ever in window or the gate is stuck — and the second case is what let
    # refreshNflJob and refreshCfbJob report healthy for twelve days with their
    # keys unset. health_check.py reads this; without it there is nothing to
    # read, because each breadcrumb overwrites the last.
    if summary.get("fetched", True) is False:
        try:
            previous = await db.read_snapshot(f"python-harness:job-run:{job_name}")
            prior = json.loads(previous).get("consecutive_skips", 0) if previous else 0
        except Exception:
            prior = 0  # a breadcrumb read is never load-bearing
        summary["consecutive_skips"] = int(prior) + 1
    else:
        summary["consecutive_skips"] = 0

    await db.write_job_run_log(job_name, summary)
    return summary


async def job_tier1(yield_fn=None) -> dict:
    # No yield_fn threaded to any spec here — SharpAPI/Odds-API.io/Propline
    # have never shown the multi-window pacing shape in measured runs. If
    # that changes for one of these, this is where a yield-aware fetch would
    # get threaded through, same pattern as the SportsGameOdds specs below.
    games = [g for g in await load_mlb_games() if not g.is_final]
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "refreshTier1", run_provider_specs(client, games, specs_for("mlb"), concurrent=False)
        )


async def job_sportsgameodds(yield_fn=None) -> dict:
    games = [g for g in await load_mlb_games() if not g.is_final]
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "refreshSportsGameOddsJob",
            run_provider_specs(client, games, specs_for("mlb", yield_fn, providers=MLB_SGO_ONLY),
                               yield_fn=yield_fn, concurrent=False),
        )


async def _job_multisport(job_name: str, sport: str, yield_fn=None, specs=None, concurrent: bool = True) -> dict:
    # The free ESPN schedule fetch (game_context.py) always runs every cycle
    # regardless of tier — it's what tells us which tier we're even in.
    # Only the paid provider fetch below is gated. See gameday.py's docstring
    # for the real numbers behind why (flat cadence spent the same 1 credit
    # whether the nearest game was 6 minutes or 6 days out).
    #
    # THE SCHEDULE LOAD RUNS INSIDE _run_timed. It used to run before it, and
    # the loader returned [] when ESPN failed, so a broken schedule read as a
    # cold week: four days of NFL/CFB/EPL/MLS props were skipped from
    # 2026-09-15 as "cold tier" (game_context.EspnScheduleError). The loader
    # now raises, and inside _run_timed that is a failed run in the job log,
    # which health_check reports as one.
    async def body() -> dict:
        # Same is_final filter MLB's job_tier1/job_sportsgameodds already apply.
        games = [g for g in await load_sport_games(sport) if not g.is_final]
        tier, should_fetch = await gameday.should_fetch_paid_providers(sport, games)
        if not should_fetch:
            return gameday.skip_summary(games, tier)
        async with httpx.AsyncClient() as client:
            return await run_provider_specs(client, games, specs if specs is not None else specs_for(sport, yield_fn),
                                            yield_fn=yield_fn, concurrent=concurrent)

    return await _run_timed(job_name, body())


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


async def job_archive_closing_lines(yield_fn=None) -> dict:
    """THE ARCHIVAL BRIDGE. Promotes live book lines into odds_archive.

    5 minutes, and the cadence is the design rather than a tuning choice: this
    keeps upserting a not-yet-started game's price, so whatever is in the row
    when the game begins IS the closing line. A job that instead fired AT
    event_start would lose that game's close permanently on one missed tick,
    with no way to recover it. Here a missed tick makes a close staler, and
    captured_at measures exactly how stale.

    Spends no provider budget — it reads live tables this worker already filled.
    """
    return await _run_timed("archiveClosingLinesJob", archive_closing_lines())


async def job_archive_props(yield_fn=None) -> dict:
    """Captured pre-game PROP prices into prop_odds_archive.

    Same 5-minute cadence and the same freeze as the game-line half: whatever is
    in the row when the game starts IS the close. Separate job rather than folded
    in, because the prop volume is an order of magnitude larger (12,078 two-sided
    MLB props against 1,611 book lines on the same slate) and a slow prop pass
    must not delay the game-line capture.
    """
    return await _run_timed("archivePropsJob", archive_props())


async def job_archive_results(yield_fn=None) -> dict:
    """Settled scores into game_result — the second half of the archival bridge.

    15 minutes, matching gradeFinishedMlbPicksJob's own reasoning: a final score
    does not need recording within seconds, and the write is ON CONFLICT DO
    NOTHING, so a missed tick costs nothing and a repeat tick changes nothing.

    Without this, odds captured by archiveClosingLinesJob have nothing to be
    graded against, and a closing line with no outcome cannot support a CLV
    backtest — which is the entire reason the bridge exists.
    """
    return await _run_timed("archiveResultsJob", archive_results())


async def job_nhl(yield_fn=None) -> dict:
    """NHL's first odds job. Phase 1d, 2026-09-03.

    NHL was not broken before this — it had no odds job at all, in a codebase
    that already carried 24,336 priced NHL games of history and an NHL prop
    model in the build plan. Five of six providers serve it; nobody was asking.

    Uses load_nhl_games (the NHL's own api-web schedule) rather than
    load_sport_games, matching backfill_player_game_history's own split: NHL is
    the one sport here whose schedule does not come from ESPN.

    Coverage is SharpAPI + SportsGameOdds. ParlayAPI is absent only because no
    PARLAYAPI_NHL_KEY exists — a provisioning gap, not a capability one.
    """
    games = [g for g in await load_nhl_games() if not g.is_final]
    tier, should_fetch = await gameday.should_fetch_paid_providers("nhl", games)
    if not should_fetch:
        return await _run_timed("refreshNhlJob", _return_dict(gameday.skip_summary(games, tier)))
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "refreshNhlJob",
            run_provider_specs(client, games, specs_for("nhl", yield_fn),
                               yield_fn=yield_fn, concurrent=False),
        )


async def job_nba(yield_fn=None) -> dict:
    # Real coverage today: SportsGameOdds only (shared multisport account,
    # already provisioned) — ParlayAPI NBA naturally no-ops until a real
    # PARLAYAPI_NBA_KEY exists (see config.py / provider_matrix._PARLAYAPI's
    # comments). Reuses _job_multisport generically, same as NFL/CFB —
    # nothing NBA-specific needed in the shared runner.
    return await _job_multisport("refreshNbaJob", "nba", yield_fn)


async def job_soccer_epl(yield_fn=None) -> dict:
    # Propline has no per-minute cap in config.ts (dailyLimit only) — no
    # pacing-wait shape to yield at, same as Tier 1.
    return await _job_multisport("refreshSoccerEplJob", "soccer_epl", specs=specs_for("soccer_epl"), concurrent=False)


async def job_soccer_mls(yield_fn=None) -> dict:
    return await _job_multisport("refreshSoccerMlsJob", "soccer_mls", yield_fn, concurrent=False)


async def _job_tennis(job_name: str, sport_key: str, tour: str, yield_fn) -> dict:
    games = [g for g in await load_tennis_games(sport_key) if not g.is_final]
    tier, should_fetch = await gameday.should_fetch_paid_providers(sport_key, games)
    if not should_fetch:
        return await _run_timed(job_name, _return_dict(gameday.skip_summary(games, tier)))

    async with httpx.AsyncClient() as client:
        return await _run_timed(
            job_name, run_provider_specs(client, games, specs_for(sport_key), yield_fn=yield_fn, concurrent=False)
        )


async def job_tennis_atp(yield_fn=None) -> dict:
    return await _job_tennis("refreshTennisAtpJob", "tennis_atp", "atp", yield_fn)


async def job_tennis_wta(yield_fn=None) -> dict:
    return await _job_tennis("refreshTennisWtaJob", "tennis_wta", "wta", yield_fn)


async def job_grade_finished_mlb_picks(yield_fn=None) -> dict:
    """Phase E of the MLB prediction-engine port (see
    docs/mlb-prediction-engine-python-port-gameplan-2026-08-21.md) — grades
    already-captured Linesmith Picks (game_picks table) against real final
    scores. This is the one piece of predict/game_pick_lock.py's cycle that
    doesn't need Phase G's live model-probability feed: grading only needs
    a final score, which predict/statsapi.py's direct MLB Stats API access
    (Phase B) already provides in full.

    Safe to run alongside TS's own grading (snapshotRebuild.ts, still
    live and unchanged) — both read/write the exact same game_picks table,
    and db.grade_game_pick's `WHERE graded_at IS NULL` guard makes a race
    between the two a harmless no-op, not a correctness problem.

    The moneyline/total CAPTURE cycle (run_moneyline_lock_cycle /
    run_total_lock_cycle) is deliberately NOT wired in here — it needs real
    MoneylineLockInput/TotalLockInput data (gameModel/Elo/sim
    probabilities), which doesn't exist in Python until Phase G's live
    orchestrator replaces adapter.ts's live-compute path. Wiring a capture
    job in now with no real data to feed it would be premature.
    """
    return await _run_timed("gradeFinishedMlbPicksJob", _grade_finished_mlb_picks_inner())


async def _grade_finished_mlb_picks_inner() -> dict:
    from predict import statsapi as sa
    from predict.game_pick_lock import FinishedGameInput, grade_finished_game_picks

    today = sa.eastern_date()
    async with httpx.AsyncClient() as client:
        games = await sa.get_schedule_range(client, today, today)

    finished = [
        FinishedGameInput(
            game_id=str(g.game_pk),
            is_final=g.abstract_state == "Final",
            home_score=(g.teams.get("home") or {}).get("score"),
            away_score=(g.teams.get("away") or {}).get("score"),
        )
        for g in games
    ]
    await grade_finished_game_picks("mlb", finished)
    return {"games": len(games), "finished": sum(1 for f in finished if f.is_final)}


async def job_mlb_game_lines(yield_fn=None) -> dict:
    """Phase F of the MLB prediction-engine port — refreshes the shared
    odds_cache row for MLB game lines (predict/mlb_game_lines.py, a direct
    port of lib/odds/oddsApi.ts's getMlbGameLines).

    Deliberately NOT a ProviderSpec — see predict/mlb_game_lines.py's module
    docstring for the real audit finding this phase required: TS's game-
    lines architecture is request/TTL-driven (whoever hits
    app/api/odds/lines next after the cache goes stale triggers a refetch),
    not a scheduled per-game job like player props, so it doesn't fit
    job_runner.py's cap-check/fetch/record/write shape at all — one
    whole-slate call, one long TTL (6h default), a bespoke credit-header
    budget instead of provider_usage.

    This job just calls the SAME function on a real interval instead of
    leaving the trigger to "whoever loads the page next" — get_mlb_game_
    lines's own internal TTL/reserve check means most of these ticks are a
    free cache read, not a real spend; the real API is only hit once the
    6h TTL has actually lapsed. Writes to the exact odds_cache row TS's
    own getMlbGameLines already reads via the same cache key — this is the
    same "Python writes, TS reads" cutover already proven for player props.
    """
    return await _run_timed("mlbGameLinesJob", _mlb_game_lines_inner())


async def _mlb_game_lines_inner() -> dict:
    from predict.mlb_game_lines import get_mlb_game_lines

    async with httpx.AsyncClient() as client:
        result = await get_mlb_game_lines(client)
    return {
        "games": len(result.lines),
        "from_cache": result.from_cache,
        "requests_remaining": result.requests_remaining,
        "warnings": result.warnings,
    }


async def job_mlb_odds_lines_cycle(yield_fn=None) -> dict:
    """Phase G of the MLB prediction-engine port — the orchestrating job
    tying Phases A-F together: predict/odds_lines_cycle.py, a bounded port
    of app/api/odds/lines/route.ts's MLB path (see that module's own
    docstring for exactly what is and isn't ported and why).

    This is the actual "genuine correctness upgrade" Phase E's own module
    docstring promised and couldn't yet deliver without this phase's data:
    real captures on a real SequentialQueue interval, not "whichever page
    load happens to land near 6am/3-hours-before." 5min matches TS's own
    snapshot-rebuild cadence (snapshotRebuild.ts's CACHE_TTL_MS) — frequent
    enough that the 6am and per-game 3-hour windows are each caught
    reasonably promptly, cheap because get_mlb_game_lines's own 6h TTL
    means most ticks are a plain cache read, not a real vendor spend.

    Safe to run alongside TS's still-live route.ts for the same reason
    Phase E's grading job is: every actual write goes through
    capture_moneyline_pick/capture_total_pick's `_captured_at IS NULL`
    guard, so a race between the two is a harmless no-op, not a
    correctness problem.
    """
    return await _run_timed("mlbOddsLinesCycleJob", _mlb_odds_lines_cycle_inner())


async def _mlb_odds_lines_cycle_inner() -> dict:
    from predict.odds_lines_cycle import run_mlb_odds_lines_cycle

    async with httpx.AsyncClient() as client:
        return await run_mlb_odds_lines_cycle(client)


async def job_sync_provider_quota(yield_fn=None) -> dict:
    """Reconcile provider_usage against the vendors' own numbers.

    See quota_sync.py for why this exists. Short version: provider_usage is a
    DERIVED count, it was wrong by ~50x for sgo_k1 on 2026-09-03, and a wrong
    count does not merely mis-report — it defeats pooling, because job_runner
    reserves against it and will keep choosing a key the vendor has already cut
    off. A 429 now retires that key, but that reacts after the budget is spent.
    This corrects the number before anything is spent against it.

    HOURLY, not per-cycle. The endpoint it calls is free, but the drift it
    corrects accumulates over hours, not minutes, and a job that ran every 2.5
    minutes to fix an hours-scale problem would just be noise in the run log.
    """
    return await _run_timed("syncProviderQuotaJob", _sync_provider_quota_inner())


async def _sync_provider_quota_inner() -> dict:
    import quota_sync

    return await quota_sync.sync_all()


async def job_generic_capture(yield_fn=None) -> dict:
    """Real pick-capture for every sport predict/generic_team_elo.py
    covers (NFL/CFB/NBA/NHL/Soccer EPL/Soccer MLS) — the missing half of
    the data-accumulation loop for docs/mlb-market-centric-model-
    gameplan-2026-08-27.md's Phases 3-5, generalized: market price data
    for these sports already accumulates on its own via
    refreshNflJob/refreshCfbJob/etc above, but nothing was recording what
    the baseline Elo+market-blended model itself predicted, at what
    price, when — without that there's no dataset to ever CLV-backtest
    later. Mirrors mlbOddsLinesCycleJob's own cadence reasoning (5min):
    frequent enough that a game's real kickoff-relative final-capture
    window is caught reasonably promptly, cheap since most of what this
    does per tick is real, cache-fast DB reads plus a handful of ESPN
    scoreboard calls (5 sports' worth, not per-game)."""
    return await _run_timed("genericCaptureJob", _generic_capture_inner())


async def _generic_capture_inner() -> dict:
    from predict.generic_pick_capture import capture_all_sports_today

    async with httpx.AsyncClient() as client:
        results = await capture_all_sports_today(client)
    return {"per_sport": results}


async def job_grade_finished_generic_picks(yield_fn=None) -> dict:
    """Phase 1 of docs/daily-picks-full-model-build-2026-08-27.md — grades
    the six sports predict/generic_pick_capture.py already captures picks
    for (NFL/CFB/NBA/NHL/Soccer-EPL/Soccer-MLS) against real ESPN final
    scores. Mirrors job_grade_finished_mlb_picks's shape exactly, using
    generic_team_elo.py's own already-proven-live ESPN scoreboard fetch
    instead of predict/statsapi.py (MLB-only). Registered alongside (not
    merged with) gradeFinishedMlbPicksJob — same db.grade_game_pick `WHERE
    graded_at IS NULL` guard makes any future overlap a harmless no-op."""
    return await _run_timed("gradeFinishedGenericPicksJob", _grade_finished_generic_picks_inner())


async def _grade_finished_generic_picks_inner() -> dict:
    from datetime import timedelta

    from predict import generic_team_elo as gte
    from predict.game_pick_lock import FinishedGameInput, grade_finished_game_picks
    from predict.generic_pick_capture import _APP_SPORT_BY_KEY

    today = datetime.now(timezone.utc).date()
    # 2-day lookback, not just today: catches a late-finishing game (e.g.
    # a soccer match that goes past midnight UTC) or a missed tick without
    # re-grading anything already graded — grade_finished_game_picks's own
    # `graded_at` guard makes re-checking an already-graded game a no-op.
    start = (today - timedelta(days=2)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")

    per_sport: dict[str, dict] = {}
    errors: list[str] = []
    async with httpx.AsyncClient() as client:
        for sport_key, app_sport in _APP_SPORT_BY_KEY.items():
            config = gte.SPORT_CONFIGS[sport_key]
            try:
                games = await gte.fetch_finished_games(client, config, start, end)
            except Exception as e:
                # An unreadable schedule is a failure, not "nothing finished";
                # the other sports still grade, and the run fails at the end.
                errors.append(f"{sport_key}: {type(e).__name__}: {e}")
                per_sport[sport_key] = {"error": str(e)}
                continue
            finished = [
                FinishedGameInput(game_id=g.game_id, is_final=True, home_score=g.home_score, away_score=g.away_score)
                for g in games
            ]
            await grade_finished_game_picks(app_sport, finished)
            per_sport[sport_key] = {"finished": len(finished)}
    if errors:
        raise RuntimeError("; ".join(errors))
    return {"per_sport": per_sport}


async def job_attach_generic_prices(yield_fn=None) -> dict:
    """Phase 1 of docs/daily-picks-full-model-build-2026-08-27.md — fills
    in real market prices on already-captured game_picks rows for the six
    sports generic_pick_capture.py covers, generalizing odds_lines_cycle.
    py's attach_prices_from_lines (confirmed MLB-only). Without this,
    these sports' game_picks rows never get a price, and Phase 7's
    simulated $10 bankroll has nothing to compute simulatedProfit from.
    See predict/generic_price_attach.py's own docstring for why no team-
    name matching is needed here the way MLB's version needs it."""
    return await _run_timed("attachGenericPricesJob", _attach_generic_prices_inner())


async def _attach_generic_prices_inner() -> dict:
    from predict.generic_price_attach import attach_prices_all_sports

    results = await attach_prices_all_sports()
    return {"per_sport": results}


async def job_maintain_mlb_elo(yield_fn=None) -> dict:
    """Phase I of the TS cutover gameplan
    (docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md) — Python
    independently writes team_elo_history/pitcher_game_score_history for
    today's finished games, using the already-built, already-tested
    elo_model.update_elo_for_finished_game / log_pitcher_game_score (Phase
    C). Mirrors job_grade_finished_mlb_picks's shape exactly (Phase E):
    same statsapi.get_schedule_range source, same today-only scope matching
    TS's own snapshotRebuild.ts.

    Idempotent (UNIQUE constraints on both tables), so running alongside
    TS's own snapshotRebuild.ts writes is safe from day one — this job's
    whole point is to prove Python can maintain these tables correctly
    BEFORE Phase J removes TS's redundant writes. Do not start Phase J
    until this has run unattended, successfully, across several real game
    days (a single clean run is not enough confidence to remove TS's only
    other writer of a table adapter.ts reads on every live page load).
    """
    return await _run_timed("maintainMlbEloJob", _maintain_mlb_elo_inner())


async def _maintain_mlb_elo_inner() -> dict:
    from predict import elo_model
    from predict import statsapi as sa

    today = sa.eastern_date()
    season = int(today[:4])
    async with httpx.AsyncClient() as client:
        games = await sa.get_schedule_range(client, today, today)

        elo_updates = 0
        pitcher_score_attempts = 0
        for g in games:
            if g.abstract_state != "Final":
                continue
            home = g.teams.get("home") or {}
            away = g.teams.get("away") or {}
            home_team_id = (home.get("team") or {}).get("id")
            away_team_id = (away.get("team") or {}).get("id")
            game_date = g.game_date or today

            home_runs = home.get("score")
            away_runs = away.get("score")
            if home_runs is not None and away_runs is not None and home_runs != away_runs and home_team_id and away_team_id:
                await elo_model.update_elo_for_finished_game(season, g.game_pk, game_date, home_team_id, away_team_id, home_runs, away_runs)
                elo_updates += 1

            home_starter_id = (home.get("probablePitcher") or {}).get("id")
            away_starter_id = (away.get("probablePitcher") or {}).get("id")
            if home_starter_id and home_team_id:
                await elo_model.log_pitcher_game_score(client, g.game_pk, season, home_starter_id, home_team_id, game_date)
                pitcher_score_attempts += 1
            if away_starter_id and away_team_id:
                await elo_model.log_pitcher_game_score(client, g.game_pk, season, away_starter_id, away_team_id, game_date)
                pitcher_score_attempts += 1

    return {"games": len(games), "elo_updates": elo_updates, "pitcher_score_attempts": pitcher_score_attempts}


async def job_compute_mlb_game_model(yield_fn=None) -> dict:
    """Phase N of the TS cutover gameplan
    (docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md) —
    computes gameModel + Elo independently in Python (Phase M) for today's
    still-upcoming games and persists them to mlb_game_model_cache.
    Additive only: nothing reads this table yet (that's Phase O). Only
    computes for status == 'pre' — a prediction for a game already live or
    final isn't a prediction, same principle grade_finished_game_picks
    already documents for the pick-lock side.

    Scoped to today only, matching odds_lines_cycle.py's own
    read_games_from_snapshot (TS's mlb:snapshot key is today-only too);
    extending this to future dates is a real, separate scope decision, not
    assumed here.
    """
    return await _run_timed("computeMlbGameModelJob", _compute_mlb_game_model_inner())


async def _compute_mlb_game_model_inner() -> dict:
    from predict import statsapi as sa
    from predict.game_model_cache import build_slate_context, build_slate_game_inputs, compute_elo_for_game, compute_game_model_for_game
    from predict.game_sim_cache import GameSimInput, ensure_game_sims

    today = sa.eastern_date()
    season = int(today[:4])
    async with httpx.AsyncClient() as client:
        inputs = await build_slate_game_inputs(client, today)
        pre_game = [g for g in inputs if g.status == "pre"]

        starter_ids = [sid for g in pre_game for sid in (g.home_starter_id, g.away_starter_id) if sid]
        context = await build_slate_context(client, season, today, starter_ids)
        batter_ids = [pid for g in pre_game for pid in g.home_lineup_ids + g.away_lineup_ids]
        batters = await sa.get_people_with_game_logs(client, batter_ids, "hitting", season)

        written = 0
        skipped_no_model = 0
        model_entries: list[db.SurfacedEntry] = []
        sim_inputs: list[GameSimInput] = []
        for g in pre_game:
            model = await compute_game_model_for_game(client, context, batters, g)
            if model is None:
                skipped_no_model += 1
                continue
            elo = await compute_elo_for_game(season, g.home_team_id, g.away_team_id, g.game_date_iso, g.home_starter_id, g.away_starter_id)

            await db.write_game_model_cache(
                db.GameModelCacheRow(
                    sport="mlb",
                    game_id=str(g.game_pk),
                    home_expected_runs=model.home_expected_runs,
                    away_expected_runs=model.away_expected_runs,
                    home_win_prob=model.home_win_prob,
                    away_win_prob=model.away_win_prob,
                    diagnostics_json=json.dumps(
                        {
                            "rawLog5HomeWinProb": model.diagnostics.raw_log5_home_win_prob,
                            "homeVenueEdge": model.diagnostics.home_venue_edge,
                            "awayVenueEdge": model.diagnostics.away_venue_edge,
                            "homeRecentEdge": model.diagnostics.home_recent_edge,
                            "awayRecentEdge": model.diagnostics.away_recent_edge,
                            "rawHomeRecentEdge": model.diagnostics.raw_home_recent_edge,
                            "rawAwayRecentEdge": model.diagnostics.raw_away_recent_edge,
                            "parkFactor": model.diagnostics.park_factor,
                        }
                    ),
                    home_elo=elo.home_elo,
                    home_games_played=elo.home_games_played,
                    away_elo=elo.away_elo,
                    away_games_played=elo.away_games_played,
                    home_rest_days=elo.home_rest_days,
                    away_rest_days=elo.away_rest_days,
                    home_travel_miles=elo.home_travel_miles,
                    away_travel_miles=elo.away_travel_miles,
                    home_pitcher_adj=elo.home_pitcher_adj,
                    away_pitcher_adj=elo.away_pitcher_adj,
                    computed_at=datetime.now(timezone.utc).isoformat(),
                )
            )
            written += 1

            # Task 2.9 — today's per-game simulation cache. ensure_game_sims
            # decides for itself whether a game needs simulating: it skips one
            # already done at the same lineup confidence, and re-runs only to
            # upgrade a projected-lineup result to a posted-lineup one. So the
            # steady-state cost on this 15-minute job is near zero, and the
            # full ~3s/game only happens when a real lineup card drops.
            #
            # Wired here rather than into its own job because this is the one
            # place that already holds the real slate WITH lineups; a separate
            # job would have to rebuild all of it to get the same inputs.
            sim_inputs.append(
                GameSimInput(
                    game_pk=g.game_pk, season=season, status=g.status,
                    home_lineup=g.home_lineup_ids, away_lineup=g.away_lineup_ids,
                    home_lineup_projected=g.home_lineup_projected,
                    away_lineup_projected=g.away_lineup_projected,
                    home_team_id=g.home_team_id, away_team_id=g.away_team_id,
                    home_starter_id=g.home_starter_id, away_starter_id=g.away_starter_id,
                    venue_id=g.venue_id,
                )
            )

            # Task 2.7b — port of lib/odds/props/pickHistoryLog.ts's
            # logGameModelPredictions, which ran inside TS's snapshot rebuild
            # (snapshotRebuild.ts) on a 4-minute per-process timer. Two
            # moneyline rows per game, one per side, keyed subject-side so
            # each team's own win probability is separately gradeable.
            #
            # Deliberately here rather than in its own job: these rows are
            # exactly this model's output, and writing them anywhere else
            # would reintroduce the split between "who computes it" and "who
            # records it" that finding P3 H2 is about. log_surfaced is
            # first-surfaced-wins (ON CONFLICT DO NOTHING), so re-running
            # this job on its 15-minute cadence does not overwrite the day's
            # locked prediction — same semantics the TS original had.
            model_entries.extend(
                [
                    db.SurfacedEntry(
                        sport="mlb", subject_id=f"team-{g.home_team_id}", subject_name=g.home_team_name or "",
                        dimension="moneyline", category="win", market_key=None, line=None,
                        game_id=str(g.game_pk), sample_size=0, distance=None, event_context=None,
                        model_prob=model.home_win_prob, commence_time=g.game_date_iso,
                    ),
                    db.SurfacedEntry(
                        sport="mlb", subject_id=f"team-{g.away_team_id}", subject_name=g.away_team_name or "",
                        dimension="moneyline", category="win", market_key=None, line=None,
                        game_id=str(g.game_pk), sample_size=0, distance=None, event_context=None,
                        model_prob=model.away_win_prob, commence_time=g.game_date_iso,
                    ),
                ]
            )

        await db.log_surfaced(model_entries)
        await ensure_game_sims(client, sim_inputs)

    return {
        "games": len(inputs),
        "pre_game": len(pre_game),
        "sim_inputs": len(sim_inputs),
        "written": written,
        "skipped_no_model": skipped_no_model,
        "moneyline_rows_logged": len(model_entries),
    }


async def job_maintain_mlb_statcast_agg(yield_fn=None) -> dict:
    """`predict/savant.py` is a real, careful "direct port... not a
    reimplementation" of `lib/sports/mlb/savant.ts` — same Savant CSV
    endpoint, same batching, same cache key (`mlb:statcast-agg:{season}:v2`
    in `snapshot_cache`) by deliberate design so Python becomes the writer
    and TS's own reader keeps working unmodified, the same "Python writes,
    TS reads" cutover already used for player props. Found 2026-09-23: it
    had zero real callers, so in practice TS's own `getSeasonStatcastPitcher
    Rates`/`getSeasonStatcastBatterRates` were still the only thing keeping
    this cache warm — a page-load-triggered write, exactly what this repo's
    own caching convention exists to avoid. This job is what finally makes
    Python the proactive writer; TS's functions stay as they are, cache-first
    with a live-fetch fallback, the same pattern `adapter.ts` already uses
    for `mlb_game_model_cache`/`mlb_prop_model_cache` — this just means that
    fallback should now rarely fire.

    6 hours, same cadence as the park-factors job this mirrors: Statcast
    aggregates move slowly game to game, not minute to minute."""
    return await _run_timed("maintainMlbStatcastAggJob", _maintain_mlb_statcast_agg_inner())


async def _maintain_mlb_statcast_agg_inner() -> dict:
    from predict import savant
    from predict.statsapi import eastern_date

    season = int(eastern_date()[:4])
    async with httpx.AsyncClient(timeout=60) as client:
        pitchers = await savant.get_season_statcast_pitcher_rates(client, season)
        batters = await savant.get_season_statcast_batter_rates(client, season)
    return {"season": season, "pitchers": len(pitchers), "batters": len(batters)}


async def job_maintain_mlb_park_factors(yield_fn=None) -> dict:
    """Park factors — how much each venue inflates or deflates run scoring
    this season. Task 2.9 (the Phase 2 gate's own finding).

    Until now NOTHING scheduled this. predict/park_factors.py existed and had
    no caller at all; the only thing actually keeping `park_factors` populated
    was lib/sports/mlb/parkFactors.ts, read-through on every MLB snapshot
    rebuild. The ownership map claimed Python owned this table — it did not.

    6 hours. A park's character does not change mid-season (the table's own
    upsert key is (venue_id, season) for that reason), and the input is every
    completed game of the season, so this is deliberately slow-moving. It is
    scheduled at all so that the TypeScript read-through path can be removed
    without the table going stale."""
    return await _run_timed("maintainMlbParkFactorsJob", _maintain_mlb_park_factors_inner())


async def _maintain_mlb_park_factors_inner() -> dict:
    from predict import statsapi as sa
    from predict.park_factors import compute_park_factors

    season = int(sa.eastern_date()[:4])
    async with httpx.AsyncClient() as client:
        results = await compute_park_factors(client, season)
        await db.write_park_factors(season, results)
    return {"season": season, "venues": len(results)}


async def job_maintain_mlb_hr_matchup(yield_fn=None) -> dict:
    """Team-level home-run-rate-allowed, the live signal the fitted home-run
    model was trained against. Task 2.9.

    Same story as park factors: predict/home_run_live_matchup.py has always
    had refresh_team_hr_rate_allowed and nothing ever called it on a schedule
    — its only reader was prop_candidates.py, deleted in Phase 1.1. The
    writer was lib/sports/mlb/homeRunLiveMatchup.ts, read-through on snapshot
    rebuild. Phase 3.2 of docs/master-plan-2026-09-06.md owns whether the
    home-run model survives at all; until it answers, this job keeps the
    signal current rather than letting it rot mid-decision.

    6 hours. This pulls every qualified batter's current-season game log —
    the same expensive pull home_run_model_fit.py's training builder does —
    so it is not something to run per-request, which is precisely why the
    TypeScript version cached it. A season-to-date rate moves slowly enough
    that 6 hours is generous."""
    return await _run_timed("maintainMlbHrMatchupJob", _maintain_mlb_hr_matchup_inner())


async def _maintain_mlb_hr_matchup_inner() -> dict:
    from predict import statsapi as sa
    from predict.home_run_live_matchup import load_team_hr_rate_allowed_cache, refresh_team_hr_rate_allowed

    season = int(sa.eastern_date()[:4])
    async with httpx.AsyncClient() as client:
        await refresh_team_hr_rate_allowed(client, season)
    cache = await load_team_hr_rate_allowed_cache(season)
    return {"season": season, "league_hr_rate": cache.league_hr_rate, "teams": len(cache._by_team)}


async def job_golf_history(yield_fn=None) -> dict:
    """Golf results history: tournaments, hole scores, round scores (with the
    course weather at the time) and final results, from ESPN's live feed.
    The sole writer of those four tables.

    THIS WAS golfPredictionsJob UNTIL 2026-09-13, and the model half was
    deleted by operator decision (master plan Phase 8, 8.1). What it deleted,
    so nobody rebuilds it by accident:
      - the three models were hand-picked priors, never fitted;
      - predictions were UPSERTED until graded, so each tournament's stored
        rows carried one `predicted_at` stamped during the final round:
        winners at P(win) 1.0, 1.0, 0.954, and a "calibration" Brier of
        0.00003 that was really a record of the leaderboard;
      - no golf price was ever archived, so nothing could gate them.
    The history ingestion is DATA, not model, and is what a future rebuild
    needs. A rebuild must freeze predictions before the first tee shot and
    capture outright prices first. Backup of the deleted tables' rows:
    python-odds-service/golf_model_layer_backup_20260913/ (operator machine)."""
    return await _run_timed("golfHistoryJob", _golf_history_inner())


async def _golf_history_inner() -> dict:
    from predict import golf_history
    from predict.golf_espn import fetch_golf_event
    from predict.golf_venues import venue_coords
    from predict.weather import get_weather

    async with httpx.AsyncClient() as client:
        event = await fetch_golf_event(client)
        if event is None:
            # Not always an outage: a Ryder or Presidents Cup week has no
            # stroke-play event on the leaderboard at all (`is_team_event`).
            return {"event": None, "reason": "no stroke-play event on ESPN's leaderboard (feed down, or a team event week)"}

        wind_mph = temp_f = precip_prob = None
        coords = venue_coords(event.course.name if event.course else None)
        if coords:
            weather = await get_weather(client, coords[0], coords[1], False)
            if weather:
                wind_mph, temp_f, precip_prob = weather.wind_mph, weather.temp_f, weather.rain_pct

        await golf_history.ingest_golf_history(event, wind_mph, temp_f, precip_prob)

    return {
        "event": event.id,
        "event_name": event.name,
        "golfers": len(event.golfers),
    }


async def job_tennis_stats(yield_fn=None) -> dict:
    """DJ-TEN — tennis serve and return numbers from TML-Database.

    DAILY, and only the last two seasons: TML rewrites a year's file as
    results land (a retired match can gain its stat line days later), so the
    current season needs re-reading, and a finished one does not. The deep
    history is a one-off from the CLI.

    ATP ONLY, and not by choice — see `tennis_stats.TOURS`. Jeff Sackmann's
    `tennis_atp`/`tennis_wta` repos, which the gameplan names, are both gone;
    TML continues the ATP half and nothing continues the WTA half."""
    return await _run_timed("tennisStatsJob", _tennis_stats_inner(yield_fn))


async def _tennis_stats_inner(yield_fn=None) -> dict:
    import tennis_stats

    year = datetime.now(timezone.utc).year
    async with httpx.AsyncClient() as client:
        return await tennis_stats.ingest(client, year - 1, year, yield_fn)


async def job_golf_elo(yield_fn=None) -> dict:
    """`predict/golf_elo.py` has existed since 2026-09-20, registered in
    `model_status.py` as golf's live game model — but its `ratings()`/
    `rank_field()` functions had zero real callers anywhere in this repo
    (found 2026-09-23 during the dead-code audit). Same shape as tennis's
    "fitted, tested, wired to nothing" gap that `tennisPicksJob` closed:
    this is what finally calls it.

    Hourly, not every 5 minutes: `ratings()` already carries its own 6-hour
    internal TTL cache, so most runs just confirm the cache is warm; a real
    replay only happens when it actually expires or a new event landed.
    Golf has no per-match "today's game" the way tennis does — a tournament
    is 150 players against a field, not a head-to-head — so there is no
    pick to capture here (see golf_elo.py's own docstring: "it does not
    publish a probability... it ranks the field"). This job's job is only
    to keep the ranking engine genuinely live; feeding its output into the
    Slate ranking system is Phase 1h, not this job.
    """
    return await _run_timed("golfEloJob", _golf_elo_inner())


async def _golf_elo_inner() -> dict:
    from predict import golf_elo

    table = await golf_elo.ratings()
    rated = sum(1 for g in table.values() if g.events >= 5)
    return {"golfers": len(table), "rated_5plus_events": rated}


async def job_golf_courses(yield_fn=None) -> dict:
    """DJ-GOLF — fill the course for golf events that have none.

    A BACKFILL THAT BECOMES A NO-OP. 235 events were held and 4 named a
    course (measured 2026-09-22), which is what blocked golf's Course history
    spotlight. It is a scheduled job rather than a one-shot script so that
    `health_check` watches it and so a live event whose leaderboard omitted a
    course still gets one later.

    SIX HOURS, not five minutes like `golfHistoryJob`: a finished
    tournament's course does not change, and once the backlog clears every run
    is one read and no writes. See `golf_courses.py` for why this needed no
    new table and no new writer."""
    return await _run_timed("golfCoursesJob", _golf_courses_inner(yield_fn))


async def _golf_courses_inner(yield_fn=None) -> dict:
    import golf_courses

    async with httpx.AsyncClient() as client:
        return await golf_courses.backfill_courses(client, golf_courses.BATCH, yield_fn)


async def job_grade_mlb_props(yield_fn=None) -> dict:
    """Task 2.7b — MLB prop/moneyline/total grading, ported from
    lib/odds/props/grading.ts where it ran inside TypeScript's snapshot
    rebuild on that file's own 4-minute per-process timer.

    15 minutes, matching every other grading job here: a graded row does not
    need to land within seconds, and the cost is one live-feed call per game
    that still has ungraded rows — zero once a slate is fully graded."""
    return await _run_timed("gradeMlbPropsJob", _grade_mlb_props_inner())


async def _grade_mlb_props_inner() -> dict:
    from predict.mlb_prop_grading import grade_finished_games

    async with httpx.AsyncClient() as client:
        return await grade_finished_games(client)


async def job_mlb_history_summary(yield_fn=None) -> dict:
    """Phase 5.2 — rebuild `player_history_summary` for MLB.

    THE SERVING PATH DEPENDS ON THIS AND CANNOT REBUILD IT. `mlbProjectionsJob`
    now READS the summary instead of replaying `player_game_history`, which is
    what allowed that table to be trimmed from 2,807,445 rows to 758,819. If
    this job stops, the summary goes stale and the board silently serves
    yesterday's history -- and if it had never run at all after the trim, the
    board would have served nothing.

    DAILY, NOT HOURLY. History only changes when games finish, and the union
    source reads the Parquet corpus, which costs Storage egress -- the thing
    5.1 exists to have reduced. Hourly would spend it 24 times for one day's
    worth of new rows.

    SOURCE IS `prefix`, NOT `union`, AND THAT IS A MEMORY DECISION.
    It used to union the Parquet corpus with the Postgres hot window, which was
    correct but cost +118 MB of worker RSS that never came back -- traced across
    one worker lifetime on 2026-09-11: 272 MB before this job, 390 MB after.
    `corpus_store` had already measured that CPython does not return freed
    arenas to the OS and barred the corpus EXPORT from the worker for that
    reason; this job's corpus READ was never costed the same way. Worker RAM is
    one of Phase 5's three ceilings and it was the one that got WORSE during the
    phase.
    
    The corpus half never changes -- every game before the hot window is
    finished forever -- so it is precomputed OFF the worker by
    `build_history_prefix.py` into `player_history_prefix`, and this job merges
    that with the hot window using nothing but Postgres. Same numbers, no
    DuckDB, no Parquet, no S3.
    
    Re-run `build_history_prefix.py --apply` whenever the hot window moves (i.e.
    after a `prune_player_history`). Nothing else can change its answer.
    """
    from datetime import date as _date

    from predict.mlb_board_lines import BOARD_LINES
    from predict.mlb_prop_serving import live_slate_subjects
    from predict.mlb_props import write_history_summary

    async def _run() -> dict:
        import httpx

        as_of = _date.today()
        async with httpx.AsyncClient() as client:
            subjects, meta = await live_slate_subjects(client, as_of)
        if not subjects:
            return {"note": "no mlb slate", **meta}
        pool = await db.get_pool()
        async with pool.acquire(timeout=1800.0) as conn:
            await conn.execute("SET statement_timeout = '30min'")
            out = await write_history_summary(
                conn, as_of, athlete_ids=list(subjects),
                slugs=list(BOARD_LINES), source="prefix")
        return {**out, **meta}

    return await _run_timed("mlbHistorySummaryJob", _run())


async def job_mlb_projections(yield_fn=None) -> dict:
    """Phase 5.8 — the PROJECTION pipe for MLB: what the MLB stats board reads.

    Phase 1.1 (2026-09-06) removed the other pipe. There used to be an EDGE
    pipe alongside this one — genericPropProductionJob and
    computeMlbPropPredictionsJob, writing pick_history from a separate,
    unvalidated model that no walk-forward ever cleared. Deleting it is what
    makes this the single MLB prop pipe rather than one of two.

    Lines matter only for markets whose calibration earned a displayed
    probability; every other market gets a projection and a null probability
    regardless of what is passed. These are the standard numbers.
    """
    from datetime import date as _date
    from predict.mlb_board_lines import BOARD_LINES
    from predict.mlb_prop_serving import run

    return await _run_timed("mlbProjectionsJob", run(_date.today(), BOARD_LINES))


async def job_nhl_projections(yield_fn=None) -> dict:
    """Phase 4.9 — the PROJECTION pipe: what the NHL stats board reads.

    Phase 1.1 (2026-09-06) deleted genericPropProductionNhlJob, the EDGE pipe
    that used to sit beside this one writing `pick_history` from
    `generic_prop_score.build_candidate` — a model the 4.5-4.8 walk-forward
    said nothing about. This is now the only NHL prop pipe.

    Serves TODAY's slate. NHL is out of season until October, so this returns
    zero projections until then and that is the correct result, not a failure —
    `build` reports the reason rather than raising, so health_check sees a job
    that ran fine with nothing to do.
    """
    from datetime import date as _date
    from predict.nhl_prop_serving import run

    # Standard NHL numbers, and they matter only for the two markets that
    # earned a displayed probability; every other market gets a projection and
    # a null probability regardless of what is passed here.
    return await _run_timed("nhlProjectionsJob",
                            run(_date.today(), {"points": 0.5, "assists": 0.5}))


async def job_nfl_projections(yield_fn=None) -> dict:
    """Phase 4.6 — the PROJECTION pipe for NFL: what Scan's NFL board reads.

    NO LINES ARE PASSED, unlike MLB and NHL, and that is the design rather than
    an omission. Those sports serve every player at one fixed line per market,
    which works only because their lines really do concentrate there — 84-93%
    of posted MLB hits lines are 0.5. Phase 4.0c measured NFL at 7.1-14.9%
    across every yardage market, all below the 16% at which `pitcher-outs`
    inverted, because a WR1's receiving line is 70.5 and a WR3's is 15.5. NFL
    therefore serves a projection with a NULL line and Scan pairs it with each
    candidate's own posted line.

    Every NFL calibration is `probability_ok = False`, so this writes no
    probability at all. Phase 4.5 owns that gate and needs the 2026 season to
    produce held-out prop rows.

    Runs hourly like its siblings. Out of season it resolves an empty slate and
    reports that rather than raising, so health_check sees a job that ran fine
    with nothing to do.
    """
    from datetime import date as _date
    from predict.nfl_prop_serving import run

    return await _run_timed("nflProjectionsJob", run(_date.today()))


async def job_player_history_freshness(yield_fn=None) -> dict:
    """Phase 0 of docs/daily-picks-full-model-build-2026-08-27.md — keeps
    player_game_history current going forward, forever, once the one-time
    backfill_player_game_history.py historical pull finishes. Same game-
    based boxscore approach, same live-verified parsers, reused wholesale
    (see predict/generic_freshness_job.py's own docstring) — just scoped
    to a short trailing window instead of a multi-year sweep, so a normal
    pass is a handful of games per sport, comfortably inside this queue's
    per-job timeout."""
    return await _run_timed("genericPlayerHistoryFreshnessJob", _player_history_freshness_inner())


async def _player_history_freshness_inner() -> dict:
    from predict.generic_freshness_job import run_freshness_pass

    async with httpx.AsyncClient(follow_redirects=True) as client:
        per_sport = await run_freshness_pass(client)
    return {"per_sport": per_sport}


async def job_tennis_picks(yield_fn=None) -> dict:
    """Tennis's simple game model — capture today's matches, settle finished ones.

    Tennis is not on the team-sport capture path (`generic_pick_capture` walks
    an ESPN team scoreboard), so it has its own small job. 15 minutes matches
    that path's own cadence: matches start through the day, and a capture that
    arrives after the first ball is a pick made with the result half known.

    The rating engine has existed since Phase 2.2, fitted, tested and wired to
    nothing — this is what finally calls it (operator, 2026-09-20).
    """
    from predict import tennis_serving

    return await _run_timed("tennisPicksJob", tennis_serving.run())


async def job_slate_rankings(yield_fn=None) -> dict:
    """M3 — the Slate's odds-free rankings, refreshed until first pitch.

    15 minutes, and the cadence is the design rather than a preference: each
    ranking must be FROZEN before its sport's first game, and a slate's first
    start can be any quarter hour. A coarser tick would freeze a ranking minutes
    after the games began, which is exactly the self-grading this table exists to
    prevent. Cheap either way — a few reads plus at most ten rows per ranking.

    No lock: the worker runs its jobs sequentially in one process (SequentialQueue),
    so this cannot overlap itself, and nothing else writes slate_rankings.
    Each pass also grades yesterday's frozen top five from player_game_history.
    """
    import slate_rankings

    return await _run_timed("slateRankingsJob", slate_rankings.run())


async def job_model_status(yield_fn=None) -> dict:
    """M1 — mirror the model register (src/model_status.py) for the app to read.

    "Which model is real" used to live across plan documents, so every surface
    decided for itself what to render: a baseline could show a probability beside
    a price as readily as a gated model could. This job is the one writer of
    `model_status`; TypeScript reads it through /api/model-status and the display
    rule follows the status.

    Daily is plenty — a status changes when a fit or a promotion test says so
    (M2, M4), not on its own — and the write is a handful of rows.
    """
    import model_status

    return await _run_timed("modelStatusJob", _model_status_inner(model_status))


async def _model_status_inner(model_status) -> dict:
    rows = model_status.as_rows()
    written = await db.write_model_status(rows)
    by_status: dict[str, int] = {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    return {"rows": written, "by_status": by_status}


async def job_model_gate(yield_fn=None) -> dict:
    """M4 — re-run each model's own pre-registered gate and move it on evidence.

    Weekly: a gate's inputs are graded games and closing prices, which arrive a
    slate at a time, and a status that flickers daily is worse than one that
    moves deliberately. Promotion and demotion both happen here, so a model that
    stops clearing its own bar loses the probability it was allowed to show.
    """
    import model_gate

    return await _run_timed("modelGateJob", model_gate.evaluate(apply=True))


async def job_retention(yield_fn=None) -> dict:
    """Phase 0.2 — the database had reached 1,563 MB against the Free tier's
    500 MB ceiling, and Supabase enforces read-only above quota. Nothing was
    pruning anything: snapshot_cache had no retention at all (P2 H5), prop_odds
    never expired (P3 M10), system_events never rotated (P2 L4).

    The policy itself lives in db.RETENTION_RULES so it reads as one list
    rather than being spread through a job body — read that list before
    changing anything here, particularly its note on which tables must never
    be added to it.
    """
    return await _run_timed("retentionJob", db.run_retention())


async def job_disk_guard(yield_fn=None) -> dict:
    """P5 A2 (D24): measure database + WAL, set the history's hot window,
    pause the bridge if even the floor cannot hold the disk, make partitions
    ahead. See disk_guard.py. A handful of catalogue queries; no yield needed."""
    import disk_guard

    return await _run_timed("diskGuardJob", disk_guard.run_disk_guard())


async def job_cost_guard(yield_fn=None) -> dict:
    """P6.0 (D25): see cost_guard.py. One S3 listing and a few small reads."""
    import cost_guard

    return await _run_timed("costGuardJob", cost_guard.run_cost_guard())


async def job_market_edge(yield_fn=None) -> dict:
    """P11 (E1): the market edge — every gate in predict/market_edge.py, written
    to market_edges / market_edge_log and the edge_auto_off flag. Reads prop_odds
    and game_lines for the next four days' games and evaluates in memory; its
    summary carries `runtime_s`, which the P11 runtime check reads (p95 over 20 s
    on a full NFL Sunday means moving run() to the laptop bridge's cycle).
    Sequential DB reads, no provider spend, so no yield point is needed."""
    from predict import market_edge

    return await _run_timed("marketEdgeJob", market_edge.run())


# Task 4.5 (P3 M1) — CLV, computed here and STORED, never computed by the
# renderer (Q13).
#
# P3 M1: "P3 computed CLV once (n=78, -4.6% ROI, 27% beat the close) and
# nothing reports it." predict/clv_backtest.py was already written, careful and
# fully documented — and wired to nothing. It had no entry in JOB_REGISTRY and
# no reader anywhere in app/ or lib/. This is the missing half.
#
# THE CLOSING REFERENCE, stated explicitly as 4.5 requires: the last real
# observed price for one (event, market, side) at the reference book, strictly
# before that game's own commence_time, read from game_odds_history's
# observation log (db.get_closing_price). Not game_picks' capture-window
# snapshots, which are taken on a timer and are therefore "near the close"
# rather than "the close".
#
# Hourly, not per-cycle: CLV only changes when games finish and their closing
# prices are logged, and the backtest walks every captured pick each run.
CLV_SUMMARY_CACHE_KEY = "python-harness:clv-summary"


async def job_team_production(yield_fn=None) -> dict:
    """R5b (research pages) -- strength rollups: production for and allowed per
    team, game and position group, and each player's production score. See
    `team_production.py`.

    DAILY. Every input is a finished game in `player_game_history`, which
    `genericPlayerHistoryFreshnessJob` keeps current; the rebuild is plain
    Postgres (INSERT ... SELECT), and positions change with rosters, not by the
    hour. Measured from the operator machine: 229 s for every sport, most of it
    roster requests.
    """
    import team_production

    async def run() -> dict:
        pool = await db.get_pool()
        async with pool.acquire(timeout=120.0) as conn, httpx.AsyncClient(follow_redirects=True) as client:
            return await team_production.run(conn, client)

    return await _run_timed("teamProductionJob", run())


async def job_venue_factors(yield_fn=None) -> dict:
    """Phase 6.10 -- home/road scoring factors for the sports that are not
    baseball. `park_factors` stays MLB's, keyed by a real venue id; nothing
    else stores a venue per game, so this is keyed by the home team. See
    `venue_factors.py` for why that is the honest key rather than a fudge.

    DAILY. Every input is a completed game, so the number only moves when games
    finish, and a season-level ratio does not meaningfully change between two
    runs on the same day.
    """
    import venue_factors

    async def run() -> dict:
        return await venue_factors.refresh_all()

    return await _run_timed("venueFactorsJob", run())


async def job_injury_snapshot(yield_fn=None) -> dict:
    """Daily availability snapshot -- see injury_snapshot.py for why this is not
    new ingestion but the retention of something already fetched and discarded.

    DAILY, and the cadence is the point: unlike odds, an injury report cannot be
    bought retroactively. Every day this does not run is a day of training data
    that will never exist. health_check.py picks this up with no edit of its own.
    """
    import injury_snapshot

    async def run() -> dict:
        return await injury_snapshot.run_snapshot()

    return await _run_timed("injurySnapshotJob", run())


async def job_clv_summary(yield_fn=None) -> dict:
    from predict import clv_backtest

    async def run() -> dict:
        results = [
            await clv_backtest.backtest_moneyline_clv("mlb"),
            await clv_backtest.backtest_total_clv("mlb"),
        ]
        payload = {
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "reference_definition": (
                "last observed price at the reference book strictly before the game's "
                "commence_time, from game_odds_history"
            ),
            "markets": [
                {
                    "market": r.market,
                    "reference_bookmaker": r.reference_bookmaker,
                    "picks_considered": r.picks_considered,
                    "picks_with_reference_close": r.picks_with_reference_close,
                    "mean_clv_prob_points": r.mean_clv_prob_points,
                    "median_clv_prob_points": r.median_clv_prob_points,
                    "positive_clv_rate": r.positive_clv_rate,
                    "summary": r.summary_line(),
                }
                for r in results
            ],
        }
        await db.write_snapshot(CLV_SUMMARY_CACHE_KEY, json.dumps(payload))
        return {
            "markets": len(payload["markets"]),
            "matched": sum(m["picks_with_reference_close"] for m in payload["markets"]),
            "considered": sum(m["picks_considered"] for m in payload["markets"]),
            "ok": True,
        }

    return await _run_timed("clvSummaryJob", run())


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

async def job_statcast_pitches(yield_fn=None) -> dict:
    """Phase 6.6 — keep `mlb_pitch_events` current with the last few days.

    NOT the backfill. The historical 2024-onwards sweep is an operator-run
    command (`statcast_pitches.py backfill`) deliberately kept off the schedule:
    it is a long multi-season pull, and the job loop is for recurring work.

    3 days mirrors genericPlayerHistoryFreshnessJob's own LOOKBACK_DAYS, and
    costs almost nothing when it re-covers ground: the write is idempotent on
    (game_pk, at_bat_number, pitch_number), so a re-fetched day is one request
    and zero inserts.
    """
    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "ingestStatcastPitchesJob", statcast_pitches.ingest_recent(client, days=3, yield_fn=yield_fn)
        )


async def job_nhl_shots(yield_fn=None) -> dict:
    """Phase 6.7 — keep `nhl_shot_events` current with the last few days.

    NOT the backfill. The historical sweep is an operator-run command
    (`nhl_shots.py backfill 20242025`) deliberately kept off the schedule: it is
    ~1,300 games of per-game requests, and the job loop is for recurring work.

    3 days mirrors `ingestStatcastPitchesJob`'s own lookback. Cheap when it
    re-covers ground for a better reason than idempotency alone:
    `nhl_shot_events_done_games` skips the FETCH for a game already stored, so a
    tick over a quiet stretch costs the schedule lookups and nothing else.

    OUT OF SEASON THIS DOES NOTHING AND THAT IS CORRECT. The NHL runs Oct-Jun;
    from July to September `season_game_ids` returns no finished games for the
    current season and the job reports zero written. `health_check.py` cannot
    tell that apart from a stuck job on its own — the same ambiguity CURRENT.md
    already records for every other out-of-season sport.
    """
    async with httpx.AsyncClient() as client:
        return await _run_timed("ingestNhlShotsJob", nhl_shots.ingest_recent(client, days=3, yield_fn=yield_fn))


async def job_nba_shots(yield_fn=None) -> dict:
    """Phase 6.7 — keep `nba_shot_events` current with the last few days.

    NOT the backfill; that is an operator-run date range
    (`nba_shots.py backfill 2024-10-22 2025-04-13`), ~1,300 games of per-game
    requests.

    Same 3-day lookback and same out-of-season behaviour as `ingestNhlShotsJob`:
    the NBA runs Oct-Jun, so from July to September this reports zero written
    and that is correct, not stuck.
    """
    async with httpx.AsyncClient() as client:
        return await _run_timed("ingestNbaShotsJob", nba_shots.ingest_recent(client, days=3, yield_fn=yield_fn))


async def job_nfl_pbp(yield_fn=None) -> dict:
    """Phase 6.8 — keep `nfl_target_events` current for the running season.

    DAILY, not hourly, and that is deliberate. nflverse has no incremental
    endpoint: it republishes the whole ~99 MB season file. So unlike every
    other ingester here, this job's cost does NOT fall as it catches up — a
    quiet day costs exactly as much as a busy one. Twelve pulls a day for a
    handful of new plays would be ninety-nine megabytes each time, against a
    free release we do not own, for a write that is idempotent anyway.
    """
    async with httpx.AsyncClient() as client:
        return await _run_timed("ingestNflPbpJob", nfl_pbp.ingest_recent(client, yield_fn=yield_fn))


async def job_team_name_index(yield_fn=None) -> dict:
    """Phase 5.S.7 — keep `team_name_index` current from the LIVE tail.

    `archival_bridge._team_ids` no longer scans `odds_archive` (1,982,889 rows
    for 859 pairs); it reads this index. Once 5.S.7 pruned the archive to its
    unfrozen tail plus a 30-day margin, that scan could no longer have found the
    pairs anyway.

    THIS JOB IS WHY THE INDEX DOES NOT GO STALE. A genuinely new team spelling
    arrives as a LIVE odds_archive row, so a scan of the unfrozen tail sees it
    before the row freezes and is pruned. Miss that window and the spelling is
    lost to the index forever and every capture carrying it lands in
    `odds_unresolved` -- silently, which is the whole failure this index exists
    to prevent, reintroduced by neglecting to refresh it.

    Hourly, not daily, for exactly that reason: the window in which a new
    spelling is visible is bounded by the retention margin, but a slate's worth
    of captures is bounded by hours.

    IT NEVER READS THE CORPUS. `build_team_name_index.py --seed` does that, once,
    by hand. Re-reading ~100 MB of Parquet hourly to rebuild 859 rows would
    spend Storage egress to solve a problem this table already solves.
    """
    import subprocess

    _here = os.path.dirname(os.path.abspath(__file__))

    def _run():
        return subprocess.run(
            [sys.executable,
             os.path.join(_here, "..", "build_team_name_index.py"), "--apply"],
            capture_output=True, text=True, timeout=900)

    async def _inner() -> dict:
        r = await asyncio.to_thread(_run)
        tail = [l for l in (r.stdout or "").splitlines() if l.strip()][-3:]
        if r.returncode != 0:
            raise RuntimeError(f"build_team_name_index failed: {(r.stderr or '')[-400:]}")
        return {"ok": True, "output": tail}

    return await _run_timed("teamNameIndexJob", _inner())


JOB_REGISTRY = [
    # Phase 0.2 — the one job whose absence let the database reach 3x the
    # Free tier ceiling. Daily is the right cadence: every rule's window is
    # measured in days, so running it more often deletes the same zero rows,
    # while running it less often lets one stuck day's mlb:full-raw blobs
    # (~70 MB each) accumulate. health_check.py picks this up with no edit of
    # its own, per CLAUDE.md's job architecture — a claim the Phase 0 gate
    # tests rather than assumes.
    ("retentionJob", job_retention, 24 * 60 * 60),
    # P5 A2 (D24) — holds database + WAL under 85% of the provisioned disk by
    # setting the history's hot window, and keeps partitions made ahead. The
    # export and drops run in the health-check cron (history_mover.py).
    ("diskGuardJob", job_disk_guard, 15 * 60),
    # P6.0 (D25): the month's cost projection against the $50 ceiling, and the
    # brake the scraper bridge obeys. Hourly: its inputs move by the day.
    ("costGuardJob", job_cost_guard, 60 * 60),
    # M1 — the model register the app reads; see job_model_status.
    ("modelStatusJob", job_model_status, 24 * 60 * 60),
    # M3 — the Slate's rankings; see job_slate_rankings for why 15 minutes.
    ("slateRankingsJob", job_slate_rankings, 15 * 60),
    # Tennis's own capture path; see job_tennis_picks.
    ("tennisPicksJob", job_tennis_picks, 15 * 60),
    # M4 — the promotion test. Weekly; see job_model_gate.
    ("modelGateJob", job_model_gate, 7 * 24 * 60 * 60),
    # Phase 5.S.7 — hourly, because a new team spelling is only visible in
    # odds_archive's unfrozen tail before the prune reaches it.
    ("teamNameIndexJob", job_team_name_index, 60 * 60),
    # Task 4.5 — CLV only moves when games finish and their closing prices are
    # logged, and the backtest walks every captured pick per run, so hourly is
    # the right cadence. health_check.py picks this up with no edit of its own.
    ("clvSummaryJob", job_clv_summary, 60 * 60),
    # Phase 6.10 -- venue factors for the non-MLB sports. Daily: every input is
    # a completed game. health_check.py picks this up with no edit of its own.
    ("venueFactorsJob", job_venue_factors, 24 * 60 * 60),
    # Daily availability snapshot. ESPN injuries are already fetched every day
    # and thrown away; this retains them. Unlike odds it cannot be bought
    # retroactively, which is why it is daily and why it shipped before any
    # model that will consume it.
    ("injurySnapshotJob", job_injury_snapshot, 24 * 60 * 60),
    ("refreshTier1", job_tier1, 2.5 * 60),
    ("refreshSportsGameOddsJob", job_sportsgameodds, 90 * 60),
    ("refreshNflJob", job_nfl, 20 * 60),
    ("refreshCfbJob", job_cfb, 20 * 60),
    ("refreshNbaJob", job_nba, 20 * 60),
    ("refreshNhlJob", job_nhl, 20 * 60),
    # Every 5 minutes. See job_archive_closing_lines' docstring for why the
    # cadence is load-bearing rather than a preference.
    ("archiveClosingLinesJob", job_archive_closing_lines, 5 * 60),
    ("archivePropsJob", job_archive_props, 5 * 60),
    ("archiveResultsJob", job_archive_results, 15 * 60),
    ("refreshSoccerEplJob", job_soccer_epl, 20 * 60),
    ("refreshSoccerMlsJob", job_soccer_mls, 20 * 60),
    ("refreshTennisAtpJob", job_tennis_atp, 20 * 60),
    ("refreshTennisWtaJob", job_tennis_wta, 20 * 60),
    # Grading isn't time-critical (a final score doesn't need grading within
    # seconds) and the fetch it drives is TTL-cached — 15min is conservative,
    # not a real constraint being protected.
    ("gradeFinishedMlbPicksJob", job_grade_finished_mlb_picks, 15 * 60),
    # Outer poll cadence, not the real-spend cadence — get_mlb_game_lines's
    # own 6h TTL is what actually protects the monthly credit budget; this
    # just needs to check often enough that a lapsed TTL doesn't sit stale
    # for hours before the next tick notices. 30min errs toward checking
    # more often since most ticks cost nothing (a plain cache read).
    ("mlbGameLinesJob", job_mlb_game_lines, 30 * 60),
    # Matches TS's own snapshot-rebuild cadence (snapshotRebuild.ts's
    # CACHE_TTL_MS) — frequent enough that the 6am and each game's 3-hour
    # windows are caught reasonably promptly, cheap since most of what this
    # does per tick is cache reads (get_mlb_game_lines, the snapshot).
    ("mlbOddsLinesCycleJob", job_mlb_odds_lines_cycle, 5 * 60),
    # Not time-critical (Elo credit for a finished game doesn't need to land
    # within seconds) — matches gradeFinishedMlbPicksJob's own interval and
    # reasoning.
    ("maintainMlbEloJob", job_maintain_mlb_elo, 15 * 60),
    # Not gating any real-time capture yet (nothing reads this table until
    # Phase O) — 15min just keeps it reasonably current as lineups post and
    # standings/Elo move through the day, matching maintainMlbEloJob's cadence.
    ("computeMlbGameModelJob", job_compute_mlb_game_model, 15 * 60),
    # Matches mlbOddsLinesCycleJob's 5min cadence — the "first-surfaced-
    # wins" capture pattern needs to run often enough that a candidate's
    # model_prob locks in early, not whatever a much-later refresh would
    # have computed.
    # Task 2.9 — the two seasonal aggregates the Phase 2 gate found had no
    # scheduled writer in either language's registry, only a TypeScript
    # read-through on snapshot rebuild. 6h: both are season-to-date figures
    # over every completed game, and neither moves meaningfully faster.
    # Task 6.6 — pitch-level Statcast. Hourly: Savant publishes a game's
    # pitches shortly after it ends, and a 3-day lookback means an hourly
    # tick that finds nothing costs one request. Not more often than that,
    # because this is a free public endpoint we do not own.
    ("ingestStatcastPitchesJob", job_statcast_pitches, 60 * 60),
    # Task 6.7 — NHL shot coordinates. Hourly, matching the Statcast job's own
    # reasoning: the play-by-play is published shortly after a game ends, and a
    # 3-day lookback whose already-stored games are skipped before the fetch
    # means a tick that finds nothing costs 32 schedule lookups. Not more often
    # than that, because this is a free public API we do not own.
    ("ingestNhlShotsJob", job_nhl_shots, 60 * 60),
    # Task 6.7 — NBA shot coordinates. Hourly, same reasoning as the NHL job.
    ("ingestNbaShotsJob", job_nba_shots, 60 * 60),
    # Task 6.8 — nflverse play-by-play. DAILY: see the job's own docstring on
    # why this one cannot be hourly like the other ingesters.
    ("ingestNflPbpJob", job_nfl_pbp, 24 * 60 * 60),
    ("maintainMlbParkFactorsJob", job_maintain_mlb_park_factors, 6 * 60 * 60),
    ("maintainMlbStatcastAggJob", job_maintain_mlb_statcast_agg, 6 * 60 * 60),
    ("maintainMlbHrMatchupJob", job_maintain_mlb_hr_matchup, 6 * 60 * 60),
    # 5 min so a round's hole scores and its weather are captured while the
    # round is played. Was golfPredictionsJob; see job_golf_history.
    ("golfHistoryJob", job_golf_history, 5 * 60),
    # DJ-GOLF. Six-hourly and self-limiting: a finished tournament's course
    # never changes, so once the 235-event backlog clears this reads one row
    # and writes nothing.
    ("golfCoursesJob", job_golf_courses, 6 * 60 * 60),
    # Hourly cache-warm for golf_elo.py's ratings engine — see job_golf_elo's
    # own docstring. ratings() carries its own 6h internal TTL, so most runs
    # just confirm it's alive rather than paying for a full replay.
    ("golfEloJob", job_golf_elo, 60 * 60),
    # DJ-TEN. Daily: TML rewrites a year's file as results land, so the current
    # season is re-read and finished ones are not.
    ("tennisStatsJob", job_tennis_stats, 24 * 60 * 60),
    # Matches mlbOddsLinesCycleJob's own 5min cadence and reasoning — see
    # job_generic_capture's own docstring.
    ("genericCaptureJob", job_generic_capture, 5 * 60),
    # Hourly: the endpoint is free, but the drift it corrects builds over hours.
    # health_check picks this up automatically from JOB_REGISTRY, so a sync that
    # silently stops running becomes a failing check rather than a slow return
    # to the exact blindness it was added to remove.
    ("syncProviderQuotaJob", job_sync_provider_quota, 60 * 60),
    # Not time-critical, matches gradeFinishedMlbPicksJob's own 15min
    # reasoning — a final score doesn't need grading within seconds.
    ("gradeFinishedGenericPicksJob", job_grade_finished_generic_picks, 15 * 60),
    # A captured pick's price isn't needed until it's graded, so this can
    # run on the same cadence as gradeFinishedGenericPicksJob rather than
    # genericCaptureJob's tighter 5min — cheap either way (DB reads plus a
    # handful of already-cached-by-other-jobs book-line rows).
    ("attachGenericPricesJob", job_attach_generic_prices, 15 * 60),
    # Not time-critical (a finished game's boxscore doesn't need to land in
    # player_game_history within minutes — nothing reads today's own rows
    # until the next day's picks are built) and LOOKBACK_DAYS=3 already
    # covers a missed tick, so 30min just keeps the table reasonably
    # current without adding real ESPN load beyond what a normal day's
    # game volume already costs.
    ("genericPlayerHistoryFreshnessJob", job_player_history_freshness, 30 * 60),
    # Not time-critical (a graded prop doesn't need to land within
    # seconds), matches gradeFinishedGenericPicksJob's own 15min
    # reasoning — real per-tick cost is cheap (a handful of ESPN
    # scoreboard calls plus DB reads for whatever's still ungraded).
    ("gradeMlbPropsJob", job_grade_mlb_props, 15 * 60),
    # The two projection pipes — the only prop model output this app now
    # produces. 60 minutes.
    ("nhlProjectionsJob", job_nhl_projections, 60 * 60),
    ("nflProjectionsJob", job_nfl_projections, 60 * 60),
    # MUST come before mlbProjectionsJob in this list: the projections job
    # now READS the summary this one writes, and on a cold start the
    # registry order is the burst order.
    ("mlbHistorySummaryJob", job_mlb_history_summary, 24 * 60 * 60),
    # R5b -- strength rollups for the research pages. Daily; see the job.
    ("teamProductionJob", job_team_production, 24 * 60 * 60),
    ("mlbProjectionsJob", job_mlb_projections, 60 * 60),
    # P11 (E1). Every 2 minutes, the spec's cadence: an edge is only shown while
    # the soft quote was checked within 3 minutes, so a slower job would show
    # edges whose inputs had already aged past their own gate.
    ("marketEdgeJob", job_market_edge, 120),
]


# ---------------------------------------------------------------------------
# Disabled jobs — deliberately NOT in JOB_REGISTRY
# ---------------------------------------------------------------------------
# Same (name, fn, interval) shape as JOB_REGISTRY so re-enabling is a move
# between two lists, not a rewrite. Kept as real references rather than
# deleted code so that nothing here silently rots: this file still has to
# import and construct each job, so a change that breaks one of them still
# breaks the build.
#
# Nothing reads this list. SequentialQueue does not run these, and
# health_check.py does not check them — which is correct: a job that is
# deliberately off should not be reported as stale. Rule G6 of
# docs/audit-remediation-plan.md applies — every entry needs a date, a
# reason, and the phase that re-enables it.
#
# Empty on purpose. If something is added here it needs a date, a reason,
# and the phase that re-enables it — rule G6 of docs/audit-remediation-plan.md.
DISABLED_JOBS: list = []
