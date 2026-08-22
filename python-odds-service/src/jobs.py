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
import json
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

    return {"games": len(inputs), "pre_game": len(pre_game), "written": written, "skipped_no_model": skipped_no_model}


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
]
