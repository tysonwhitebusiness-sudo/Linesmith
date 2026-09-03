"""Staleness/health monitor for every job in JOB_REGISTRY — the gap Render's
`notifyOnFail` doesn't cover. `notifyOnFail` only fires on a process crash;
it says nothing about a job that's technically still running but stuck
(hung in a yield loop, wedged on a provider that never times out, or just
silently stopped being scheduled) while the process itself stays healthy.

Each job already writes a breadcrumb via db.write_job_run_log() on every
run, success or failure (see jobs.py's _run_timed). This reads those back
and checks two things per job:
  1. Did it actually run recently — within 2x its own registered interval?
     (2x, not 1x: the queue is priority-ordered, not a strict timer, so a
     single job can legitimately wait past its own interval once while
     something more overdue runs first — see job_queue.py's _most_overdue.
     Only a genuinely missed *second* cycle is a real staleness signal.)
  2. Did its last run report ok=True?

check_elo_freshness, check_game_model_freshness, and
check_game_picks_freshness are a second, more targeted kind of check: they
don't read a job's own self-reported breadcrumb, they verify the actual
DATA each job is supposed to be maintaining (team_elo_history,
mlb_game_model_cache, game_picks respectively) against ground truth (real
games/schedule/capture windows from the live Stats API) — catching a job
that runs successfully and reports ok=True while silently failing to write
real rows, which the generic per-job check above cannot detect.

Exit code is 0 if everything's healthy, 1 if anything is stale or failed —
meant to be run manually for a spot-check, or on a schedule (Render cron
job, external uptime pinger) wired to actually page someone. Wiring up the
actual paging/alerting channel is a separate decision; this is the
detection logic that would sit behind it.
"""
import asyncio
import json
import re
import sys
from datetime import datetime, timezone

import db
from jobs import JOB_REGISTRY

# How many consecutive gated, no-fetch cycles before a job counts as stuck.
# 20-minute jobs skip legitimately overnight, so this has to clear a full
# offseason night without crying wolf — 72 is about 24h at that cadence.
SKIP_STREAK_LIMIT = 72
STALE_MULTIPLIER = 2.0


async def feeding_job_stale(name: str, interval_seconds: float) -> str | None:
    """Task 3.3, finding P3 M9. Returns a reason string when the job that
    FEEDS a data-freshness check has not run recently, else None.

    The three data-freshness checks below each measure "is there recent data?"
    over a window much wider than any job interval — 24 hours for
    game_odds_history, 7 days for game_odds_book_lines. Those windows are
    deliberate and were widened for good reason: writes here are
    log-on-change, so a genuinely quiet market legitimately produces nothing
    for many consecutive cycles, and a narrow window false-positived live on
    2026-08-26.

    But a wide window cannot tell "quiet market" from "worker dead" — it
    answers yes to both, because yesterday's rows are still inside it. Proved
    by fault injection on 2026-08-29: with the worker suspended, five job
    checks correctly went FAIL while all three of these reported healthy on
    pre-outage data. That is exactly what P3 M9 describes.

    The information that separates the two cases is whether the writing job
    ran, so these checks now consult it. A quiet market with a healthy job
    stays green — the false positive that forced the widening does not come
    back — while an outage turns them red for the honest reason, instead of
    certifying stale data as fresh.

    Deliberately NOT a duplicate of check_job's own FAIL: that one says "the
    job stopped", this one says "so do not believe this window". Both are
    worth saying, because it is the second that a reader of
    'healthy — 27,051 rows in the last 24h' would otherwise get wrong.
    """
    payload = await db.read_snapshot(f"python-harness:job-run:{name}")
    if payload is None:
        return f"{name} has never run"
    started_at = json.loads(payload).get("started_at")
    if started_at is None:
        return f"{name} has a malformed run log"
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(started_at)).total_seconds()
    if age > interval_seconds * STALE_MULTIPLIER:
        return (
            f"{name} last ran {age / 60:.0f}min ago (expected within "
            f"{interval_seconds * STALE_MULTIPLIER / 60:.0f}min), so the rows counted here predate the gap"
        )
    return None


async def check_job(name: str, interval_seconds: float) -> dict:
    key = f"python-harness:job-run:{name}"
    payload = await db.read_snapshot(key)
    if payload is None:
        return {"name": name, "status": "NEVER RUN", "healthy": False}

    summary = json.loads(payload)
    started_at = summary.get("started_at")
    ok = summary.get("ok")

    if started_at is None:
        return {"name": name, "status": "MALFORMED LOG (no started_at)", "healthy": False}

    started_dt = datetime.fromisoformat(started_at)
    age_seconds = (datetime.now(timezone.utc) - started_dt).total_seconds()
    stale = age_seconds > interval_seconds * STALE_MULTIPLIER

    # A JOB THAT RUNS ON TIME AND NEVER FETCHES IS NOT HEALTHY.
    #
    # `healthy = ok and not stale` was the whole test, and it is how
    # refreshNflJob and refreshCfbJob reported healthy for twelve days while
    # their provider keys were unset: the tier gate returned a successful
    # summary, the job never called a provider, and nothing in the contract
    # noticed. A cap-exhausted provider produces the same silence.
    #
    # `fetched` is set to False by gameday.skip_summary. Absent (older logs, and
    # jobs that do not use the tier gate) is treated as "fetched" so this cannot
    # retroactively fail jobs that never reported it.
    fetched = summary.get("fetched", True)
    consecutive_skips = summary.get("consecutive_skips", 0)
    # One skip is the gate working. A long run of them means either nothing is
    # ever in window — worth knowing — or the gate is stuck.
    skip_stuck = not fetched and consecutive_skips >= SKIP_STREAK_LIMIT

    healthy = bool(ok) and not stale and not skip_stuck
    status_bits = []
    if not ok:
        status_bits.append(f"last run failed: {summary.get('error', 'unknown error')}")
    if stale:
        status_bits.append(
            f"stale — last run {age_seconds / 60:.0f}min ago, expected within {interval_seconds * STALE_MULTIPLIER / 60:.0f}min"
        )
    if skip_stuck:
        status_bits.append(
            f"RUNS BUT NEVER FETCHES — {consecutive_skips} consecutive skipped cycles "
            f"({summary.get('skip_reason', 'no reason recorded')}). Ran on time, called no provider."
        )
    if not status_bits:
        detail = f"{summary.get('rows_written', 0)} rows written"
        if not fetched:
            detail = f"skipped ({summary.get('skip_reason', 'gated')}), {consecutive_skips} in a row"
        status_bits.append(
            f"healthy — last run {age_seconds / 60:.0f}min ago, {detail}"
        )

    return {"name": name, "status": "; ".join(status_bits), "healthy": healthy, "raw": summary}


async def check_archive_freshness() -> dict:
    """Is the TRAINING archive still being fed?

    This is the check whose absence let the archive sit frozen for a month. Every
    row of odds_archive, prop_odds_archive and game_result was written by a
    single import on 2026-09-01; the live jobs wrote two other tables that no
    model reads, and nothing anywhere noticed. A model trained on a frozen
    archive decays from its first day and no backtest can include a later game.

    Deliberately checks `captured_at` rather than `ingested_at`: a bulk re-import
    would refresh ingested_at without the bridge running at all.
    """
    pool = await db.get_pool()
    async with pool.acquire(timeout=15.0) as conn:
        row = await conn.fetchrow(
            """SELECT max(captured_at) AS newest, count(*) AS n
                 FROM odds_archive WHERE source = 'live_capture'"""
        )
    if not row or row["newest"] is None:
        return {"name": "archiveFreshness", "healthy": False,
                "status": "NO live_capture ROWS — the archival bridge has never written"}
    age_min = (datetime.now(timezone.utc) - row["newest"]).total_seconds() / 60
    # archiveClosingLinesJob runs every 5 minutes; the same 2x convention
    # check_job uses for staleness.
    healthy = age_min <= 10
    return {"name": "archiveFreshness", "healthy": healthy,
            "status": (f"{'healthy' if healthy else 'STALE'} — newest capture {age_min:.0f}min ago, "
                       f"{row['n']:,} live_capture rows total")}


async def check_capture_latency() -> dict:
    """HOW EARLY are we capturing a 'closing' line?

    Presence is not quality. A price captured six hours before kickoff is
    archived, fresh, and not a closing line — and it looks identical to a good
    one unless someone measures the gap. This is exactly the confusion that made
    the imported prop archive's 'close' no sharper than its open.
    """
    pool = await db.get_pool()
    async with pool.acquire(timeout=15.0) as conn:
        rows = await conn.fetch(
            """SELECT sport,
                      percentile_disc(0.5) WITHIN GROUP (
                        ORDER BY EXTRACT(EPOCH FROM (event_start - captured_at))/60) AS median_min,
                      count(*) AS n
                 FROM odds_archive
                WHERE source = 'live_capture' AND captured_at IS NOT NULL
                  AND event_start IS NOT NULL
                  AND captured_at > now() - interval '7 days'
                GROUP BY 1 ORDER BY 1"""
        )
    if not rows:
        return {"name": "captureLatency", "healthy": True,
                "status": "no captures in the last 7 days to measure"}
    # A capture is only a CLOSE if it is near the start. This is the number the
    # model plan's bar-3 work depends on, so it is reported per sport rather
    # than averaged into one meaningless figure.
    worst = max(rows, key=lambda r: r["median_min"] or 0)
    detail = ", ".join(f"{r['sport']} {r['median_min']:.0f}min (n={r['n']:,})" for r in rows)
    healthy = (worst["median_min"] or 0) <= 60
    return {"name": "captureLatency", "healthy": healthy,
            "status": (f"{'healthy' if healthy else 'EARLY'} — median capture-to-start per sport: "
                       f"{detail}")}


async def check_elo_freshness() -> dict:
    """Verifies team_elo_history is actually being kept current against
    REAL finished games — a stronger, more specific signal than check_job's
    generic "did it run and not crash," which can't distinguish "ran
    successfully, wrote 0 rows because nothing was due yet" from "ran
    successfully, wrote 0 rows despite a real game finishing" (a silent
    logic bug in the write path itself). Added alongside Phase J of the TS
    cutover gameplan (docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md):
    that phase made maintainMlbEloJob the ONLY writer of team_elo_history
    (removed snapshotRebuild.ts's redundant write), so a silent gap here no
    longer gets backstopped by TS's own duplicate path — this check is the
    real, ongoing verification that removal was safe, not a one-time test.

    A missing game right after it goes Final isn't necessarily a problem —
    maintainMlbEloJob runs on a 15min interval, so allow for that before
    treating a gap as a real staleness signal.
    """
    import httpx

    from predict import statsapi as sa

    today = sa.eastern_date()
    async with httpx.AsyncClient() as client:
        games = await sa.get_schedule_range(client, today, today)

    finished = [g for g in games if g.abstract_state == "Final"]
    if not finished:
        return {"name": "eloFreshness", "status": "healthy — no finished MLB games today yet", "healthy": True}

    pool = await db.get_pool()
    rows = await pool.fetch(
        # sport='mlb' explicit since 2026-08-27's migration made this table
        # sport-generic — without it, another sport's Elo backfill landing
        # game_pk values that coincidentally match today's MLB game_pks
        # would silently mark this MLB-specific check healthy for the
        # wrong reason.
        "SELECT DISTINCT game_pk FROM team_elo_history WHERE sport = 'mlb' AND game_pk = ANY($1::int[])",
        [g.game_pk for g in finished],
    )
    covered = {r["game_pk"] for r in rows}
    missing = [g.game_pk for g in finished if g.game_pk not in covered]

    if missing:
        return {
            "name": "eloFreshness",
            "status": f"STALE — {len(missing)} of {len(finished)} finished games today have no team_elo_history row "
            f"(game_pks: {missing[:5]}{'...' if len(missing) > 5 else ''}) — if one just went Final in "
            "the last ~15min this may just not have synced yet; otherwise maintainMlbEloJob's write path needs investigating",
            "healthy": False,
        }
    return {"name": "eloFreshness", "status": f"healthy — all {len(finished)} finished games today are reflected in team_elo_history", "healthy": True}


MAX_MODEL_AGE_DAYS = 45  # deliberately generous manual-retrain cadence — no automated job exists to compare against (see predict/run_walkforward.py's own docstring on why model-fitting stays a manual CLI, never JOB_REGISTRY), so this can't reuse check_job's 2x-registered-interval convention.


async def check_mlb_model_freshness() -> dict:
    """Verifies an active predict/mlb_* moneyline model actually exists
    and isn't stale — the cross-sport prediction framework's own
    ground-truth check, same "did it run" vs. "is the DATA actually
    current" distinction check_elo_freshness's own docstring makes.
    Expected to report STALE on a fresh environment where
    run_walkforward.py --activate has never been run — that's a real,
    honest signal (still running on the hand-coded formula only), not a
    bug in this check."""
    row = await db.get_active_model_weights("mlb", "moneyline")
    if row is None:
        return {
            "name": "mlbModelFreshness",
            "status": "STALE — no active mlb/moneyline model_weights row (still running on the hand-coded formula only) — "
            "run `python src/run_walkforward.py --sport mlb --market moneyline --activate`",
            "healthy": False,
        }
    fitted_at = datetime.fromisoformat(row.fitted_at)
    age_days = (datetime.now(timezone.utc) - fitted_at).total_seconds() / 86400
    if age_days > MAX_MODEL_AGE_DAYS:
        return {
            "name": "mlbModelFreshness",
            "status": f"STALE — active model_weights (version {row.version}) fitted {age_days:.0f}d ago, past the {MAX_MODEL_AGE_DAYS}d manual-retrain cadence",
            "healthy": False,
        }
    return {"name": "mlbModelFreshness", "status": f"healthy — active model_weights (version {row.version}) fitted {age_days:.0f}d ago", "healthy": True}


async def check_game_model_freshness() -> dict:
    """Same idea as check_elo_freshness, for Phase N's mlb_game_model_cache
    — verifies every real still-upcoming ('pre') game today actually has a
    fresh row, against live ground truth (the real schedule + real posted/
    projected lineups), not just "did computeMlbGameModelJob report ok".
    This is the check Phase O's adapter.ts cutover depends on: a stale or
    missing row here is exactly the case that cutover's live-compute
    fallback exists to catch, but this check is what tells a human whether
    that fallback is quietly doing all the work (a sign something's wrong)
    or genuinely idle (the healthy case).

    "Fresh" here means computed within the last 2x this job's own registered
    interval — reuses JOB_REGISTRY's own interval for computeMlbGameModelJob
    rather than a second hardcoded number that could drift out of sync with it.
    """
    from predict import statsapi as sa
    from predict.game_model_cache import build_slate_game_inputs

    today = sa.eastern_date()
    interval = next(interval for name, _, interval in JOB_REGISTRY if name == "computeMlbGameModelJob")

    import httpx

    async with httpx.AsyncClient() as client:
        inputs = await build_slate_game_inputs(client, today)
    pre_game = [g for g in inputs if g.status == "pre"]
    if not pre_game:
        return {"name": "gameModelFreshness", "status": "healthy — no pre-game MLB games today", "healthy": True}

    pool = await db.get_pool()
    rows = await pool.fetch(
        "SELECT game_id, computed_at FROM mlb_game_model_cache WHERE sport = 'mlb' AND game_id = ANY($1::text[])",
        [str(g.game_pk) for g in pre_game],
    )
    by_id = {r["game_id"]: r["computed_at"] for r in rows}
    now = datetime.now(timezone.utc)

    missing = []
    stale = []
    for g in pre_game:
        computed_at = by_id.get(str(g.game_pk))
        if computed_at is None:
            missing.append(g.game_pk)
        elif (now - computed_at).total_seconds() > interval * STALE_MULTIPLIER:
            stale.append(g.game_pk)

    if missing or stale:
        bits = []
        if missing:
            bits.append(f"{len(missing)} missing (game_pks: {missing[:5]}{'...' if len(missing) > 5 else ''})")
        if stale:
            bits.append(f"{len(stale)} stale (game_pks: {stale[:5]}{'...' if len(stale) > 5 else ''})")
        return {
            "name": "gameModelFreshness",
            "status": f"STALE — {', '.join(bits)} of {len(pre_game)} pre-game matchups today — adapter.ts's live-compute fallback (Phase O) is covering the gap, but computeMlbGameModelJob needs investigating",
            "healthy": False,
        }
    return {"name": "gameModelFreshness", "status": f"healthy — all {len(pre_game)} pre-game matchups today have a fresh mlb_game_model_cache row", "healthy": True}


async def check_game_picks_freshness() -> dict:
    """Same idea as check_elo_freshness/check_game_model_freshness, for
    Phase P's cutover of route.ts's moneyline lock cycle onto
    mlbOddsLinesCycleJob — verifies real game_picks rows are actually being
    captured against ground truth (today's real schedule + the real 6am CT
    initial-capture window from game_pick_lock.py), not just "did the job
    report ok". Added alongside Phase P of the TS cutover gameplan
    (docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md): that
    phase removed route.ts's own runMoneylineLockFromSnapshot/
    runTotalLockFromLines, making mlbOddsLinesCycleJob the only writer of
    the initial/final moneyline+total locks — this is the ongoing
    verification that removal was safe.

    Covers both moneyline capture windows: the 6am CT initial read, and the
    final read frozen 3 hours before each game's own first pitch (checked
    per-game against that game's real commence_time, not a single global
    cutoff — see game_pick_lock.py's _is_final_lock_due). Deliberately
    scoped to moneyline only, not total: run_moneyline_lock_cycle runs for
    every game with a computed gameModel regardless of whether a market
    price exists yet (see odds_lines_cycle.py's run_moneyline_lock_from_snapshot),
    so it's the one universal ground-truth signal available without also
    replicating the market-lines fetch here. A missing capture right at the
    moment a window opens isn't necessarily a problem — the job runs on a
    5min interval, so allow for that before treating a gap as real staleness.
    """
    import httpx

    from predict import statsapi as sa
    from predict.game_pick_lock import _is_final_lock_due, _is_past_initial_window

    now = datetime.now(timezone.utc)
    if not _is_past_initial_window(now):
        return {"name": "gamePicksFreshness", "status": "healthy — before today's 6am CT initial-capture window", "healthy": True}

    today = sa.eastern_date()
    async with httpx.AsyncClient() as client:
        games = await sa.get_schedule_range(client, today, today)

    # Mirrors run_moneyline_lock_from_snapshot's own precondition: a game
    # only gets a capture attempt once mlb_game_model_cache actually has a
    # row for it (Phase O), so a game missing that isn't a gamePicks bug —
    # it's covered by check_game_model_freshness above instead.
    pool = await db.get_pool()
    model_rows = await pool.fetch(
        "SELECT game_id FROM mlb_game_model_cache WHERE sport = 'mlb' AND game_id = ANY($1::text[])",
        [str(g.game_pk) for g in games],
    )
    modeled = {r["game_id"] for r in model_rows}
    eligible = [g for g in games if str(g.game_pk) in modeled]
    if not eligible:
        return {"name": "gamePicksFreshness", "status": "healthy — no MLB games today have a computed game model yet", "healthy": True}

    pick_rows = await pool.fetch(
        "SELECT game_id, ml_initial_captured_at, ml_final_captured_at FROM game_picks WHERE sport = 'mlb' AND game_id = ANY($1::text[])",
        [str(g.game_pk) for g in eligible],
    )
    by_id = {r["game_id"]: r for r in pick_rows}

    missing_initial = [g.game_pk for g in eligible if by_id.get(str(g.game_pk), {}).get("ml_initial_captured_at") is None]
    missing_final = [
        g.game_pk
        for g in eligible
        if _is_final_lock_due(g.game_date, now) and by_id.get(str(g.game_pk), {}).get("ml_final_captured_at") is None
    ]

    if missing_initial or missing_final:
        bits = []
        if missing_initial:
            bits.append(f"{len(missing_initial)} missing initial capture (game_pks: {missing_initial[:5]}{'...' if len(missing_initial) > 5 else ''})")
        if missing_final:
            bits.append(f"{len(missing_final)} missing final capture past their 3hr-before-first-pitch lock (game_pks: {missing_final[:5]}{'...' if len(missing_final) > 5 else ''})")
        return {
            "name": "gamePicksFreshness",
            "status": f"STALE — {', '.join(bits)} of {len(eligible)} modeled games today — if a window just opened in the last "
            "~5min this may not have run yet; otherwise mlbOddsLinesCycleJob's write path needs investigating",
            "healthy": False,
        }
    return {"name": "gamePicksFreshness", "status": f"healthy — all {len(eligible)} modeled games today have every moneyline capture due so far", "healthy": True}


async def check_odds_history_and_prices_freshness() -> dict:
    """Ground truth for Track A1/A3 of docs/full-prediction-engine-python-
    port-gameplan-2026-08-22.md — game_odds_history logging and
    attach_prices_from_lines, both now written by mlbOddsLinesCycleJob.
    Verifies real writes are landing, not just that the job reports ok.

    A1: at least one game_odds_history row has been observed recently
    enough to prove the write path is actually capable of firing — NOT
    "a row landed this exact 2x-interval cycle." db.write_game_odds_history
    is deliberately log-on-change-only (see its own docstring: "calling
    this every 5 minutes with an unchanged price is a harmless no-op"), so
    a stable market can legitimately go many consecutive job cycles with
    zero new rows without anything being broken — real, confirmed live
    2026-08-26: this check originally used the same 2x-interval (10min)
    window every other check_job uses, and false-positived STALE during a
    genuinely quiet, price-unchanged stretch. Widened to 24h, a real
    ground-truth bar (an active MLB slate moves at least one price
    somewhere within a day from injury news/lineup changes/normal market
    movement) instead of assuming every cycle writes.
    A3: every game_picks row with a captured moneyline side gets a
    reference price attached within the same window, once a matching
    market line exists — checked as "if not attached, is that plausibly
    because no market line exists for that game" rather than assuming
    every unattached row is a bug (a game with no market line yet is a
    legitimate gap, not a failure).
    """
    # Task 3.3 — a wide window cannot tell a quiet market from a dead worker.
    # See feeding_job_stale() for why this consults the job rather than
    # narrowing the window.
    stale_reason = await feeding_job_stale("mlbOddsLinesCycleJob", 5 * 60)
    if stale_reason:
        return {
            "name": "oddsHistoryAndPricesFreshness",
            "status": f"cannot vouch for freshness — {stale_reason}",
            "healthy": False,
        }

    HISTORY_FRESHNESS_WINDOW_S = 24 * 3600

    payload = await db.read_snapshot("python-harness:job-run:mlbOddsLinesCycleJob")
    if payload is None:
        return {"name": "oddsHistoryAndPricesFreshness", "status": "NEVER RUN — mlbOddsLinesCycleJob has no run breadcrumb yet", "healthy": False}
    last_run = json.loads(payload)
    if not last_run.get("ok") or last_run.get("lines", 0) == 0:
        return {"name": "oddsHistoryAndPricesFreshness", "status": "healthy — job's last run had no lines to log yet", "healthy": True}

    cutoff = datetime.now(timezone.utc).timestamp() - HISTORY_FRESHNESS_WINDOW_S
    pool = await db.get_pool()
    recent_history = await pool.fetchval(
        "SELECT COUNT(*) FROM game_odds_history WHERE observed_at > to_timestamp($1)", cutoff
    )
    if recent_history == 0:
        return {
            "name": "oddsHistoryAndPricesFreshness",
            "status": "STALE — MLB lines are cached but game_odds_history has no row observed in the last 24h — "
            "write_game_odds_history's write path needs investigating",
            "healthy": False,
        }
    return {
        "name": "oddsHistoryAndPricesFreshness",
        "status": f"healthy — {recent_history} game_odds_history rows observed in the last 24h",
        "healthy": True,
    }


async def check_prop_predictions_freshness() -> dict:
    """Ground truth for job_compute_mlb_prop_predictions (predict/
    prop_candidates.py + predict/prop_pick_history.py) — verifies real
    pick_history rows are landing for today's real slate, not just that
    the job reports ok. Deliberately doesn't recompute the full candidate
    pipeline here (expensive — real stat-API fetches for every batter/
    starter on the slate, same cost as a real job run); instead
    cross-checks the job's own last-run candidate count against
    pick_history's actual row count for today's real games (from a cheap
    schedule read, same source check_game_picks_freshness already uses),
    generous enough (50% floor) to absorb normal day-to-day variance
    (lineup changes, off days) without false-positiving, while still
    catching a genuine write-path break."""
    # Task 3.3 — a wide window cannot tell a quiet market from a dead worker.
    # See feeding_job_stale() for why this consults the job rather than
    # narrowing the window.
    stale_reason = await feeding_job_stale("computeMlbPropPredictionsJob", 5 * 60)
    if stale_reason:
        return {
            "name": "propPredictionsFreshness",
            "status": f"cannot vouch for freshness — {stale_reason}",
            "healthy": False,
        }

    import httpx

    from predict import statsapi as sa
    from predict.prop_candidates import STAT_MARKET_BY_DIMENSION

    payload = await db.read_snapshot("python-harness:job-run:computeMlbPropPredictionsJob")
    if payload is None:
        return {"name": "propPredictionsFreshness", "status": "NEVER RUN — computeMlbPropPredictionsJob has no run breadcrumb yet", "healthy": False}
    last_run = json.loads(payload)
    if not last_run.get("ok"):
        return {"name": "propPredictionsFreshness", "status": f"job's last run failed: {last_run.get('error', 'unknown error')}", "healthy": False}

    expected = last_run.get("candidates", 0)
    if expected == 0:
        return {"name": "propPredictionsFreshness", "status": "healthy — no prop candidates on the last run (off day or empty slate)", "healthy": True}

    today = sa.eastern_date()
    async with httpx.AsyncClient() as client:
        games = await sa.get_schedule_range(client, today, today)
    if not games:
        return {"name": "propPredictionsFreshness", "status": "healthy — no MLB games today", "healthy": True}

    pool = await db.get_pool()
    actual = await pool.fetchval(
        "SELECT COUNT(*) FROM pick_history WHERE sport = 'mlb' AND model_prob IS NOT NULL "
        "AND game_id = ANY($1::text[]) AND dimension = ANY($2::text[])",
        [str(g.game_pk) for g in games],
        [*STAT_MARKET_BY_DIMENSION.keys(), "hit-in-game"],
    )

    if actual < expected * 0.5:
        return {
            "name": "propPredictionsFreshness",
            "status": f"STALE — last run reported {expected} candidates but pick_history only has {actual} rows for today's real "
            "games — computeMlbPropPredictionsJob's write path needs investigating",
            "healthy": False,
        }
    return {"name": "propPredictionsFreshness", "status": f"healthy — {actual} pick_history rows for today's real games (last run reported {expected} candidates)", "healthy": True}


GAME_ODDS_BOOK_LINES_SPORTS = ["mlb", "nfl", "cfb", "nba", "nhl", "soccer", "tennis"]  # every sport odds-architecture-rebuild-2026-08-25.md covers except golf, which has no game-line concept at all


async def check_game_odds_book_lines_freshness() -> dict:
    """The blind spot the whole odds-architecture rebuild plan called out
    explicitly: /diagnostics and every job-level check above verify a job
    RAN, not that its output actually reached game_odds_book_lines — the
    shared table every real source (OddsHarvester, the-odds-api,
    SportsGameOdds, SharpAPI, Propline, ESPN) writes into and every sport's
    Game Detail/Scan page reads through. This is what would have caught
    NHL sitting at zero rows before Phase 4/5 shipped real OddsHarvester
    coverage for it, automatically, instead of requiring a manual audit.

    Deliberately per-sport, not per-(sport,source): which sources SHOULD be
    live for a given sport changes as jobs.py's ProviderSpec lists change
    (see CLAUDE.md's own provider-job architecture section), and hardcoding
    that expectation here would just be a second copy to drift out of sync
    with jobs.py — the exact duplication problem CLAUDE.md's job_runner
    section describes for the cap-checking case. Per-source counts are
    still reported in the status text as real diagnostic detail; only the
    sport-wide freshness gates healthy/unhealthy.

    No per-sport schedule fetch (unlike check_elo_freshness etc.) — building
    a real schedule integration for all seven of these sports here would be
    its own project. Instead: a sport with real rows sometime in the last 7
    days is treated as "currently tracked" and expected to have a row within
    the last 24h; a sport with zero rows in 7 days is reported but not
    failed, since that's honestly indistinguishable from a real off-season
    without a schedule to check against.
    """
    # Task 3.3 — a wide window cannot tell a quiet market from a dead worker.
    # See feeding_job_stale() for why this consults the job rather than
    # narrowing the window.
    stale_reason = await feeding_job_stale("refreshTier1", 2.5 * 60)
    if stale_reason:
        return {
            "name": "gameOddsBookLinesFreshness",
            "status": f"cannot vouch for freshness — {stale_reason}",
            "healthy": False,
        }

    pool = await db.get_pool()
    now = datetime.now(timezone.utc)
    problems: list[str] = []
    healthy_bits: list[str] = []
    quiet_bits: list[str] = []

    for sport in GAME_ODDS_BOOK_LINES_SPORTS:
        rows = await pool.fetch(
            "SELECT source, MAX(fetched_at) AS latest, COUNT(*) AS n FROM game_odds_book_lines "
            "WHERE sport = $1 AND fetched_at > now() - interval '7 days' GROUP BY source",
            sport,
        )
        if not rows:
            quiet_bits.append(f"{sport}: no rows from any source in the last 7 days")
            continue

        latest_overall = max(r["latest"] for r in rows)
        age_hours = (now - latest_overall).total_seconds() / 3600
        sources_desc = ", ".join(f"{r['source']}={r['n']}" for r in rows)
        if age_hours > 24:
            problems.append(f"{sport}: freshest row {age_hours:.0f}h old (last 7d by source: {sources_desc})")
        else:
            healthy_bits.append(f"{sport} (last 7d by source: {sources_desc}, freshest {age_hours:.1f}h ago)")

    healthy = len(problems) == 0
    bits = []
    if problems:
        bits.append("STALE — " + "; ".join(problems))
    if healthy_bits:
        bits.append("healthy: " + "; ".join(healthy_bits))
    if quiet_bits:
        bits.append("no recent activity (not failed — no schedule check to confirm this is a real gap vs. off-season): " + "; ".join(quiet_bits))

    return {"name": "gameOddsBookLinesFreshness", "status": " | ".join(bits) if bits else "no sports configured", "healthy": healthy}


# Real, disclosed egress-risk thresholds — not fit against anything,
# same "reasoned starting default" status as every other hand-set
# constant in this codebase. Confirmed live 2026-08-27: snapshot_cache's
# total size (1,086 MB at the time) and its single largest payload
# (mlb:snapshot, 11.22MB, re-transferred on every cache-hit HTTP request
# before the same-day cache-control fix — see lib/db/jsonPassthrough.ts's
# cacheControlFor) were the dominant driver of a real 103GB overage
# against a 5GB Supabase plan. Deliberately set BELOW current real state
# (1,086MB / 11.22MB) so this check honestly reports unhealthy until the
# actual data-shape fix (splitting the MLB snapshot into scoped, smaller
# caches, plus a retention policy for the dated mlb:full-raw:{date}/
# mlb:snapshot:{date} archive blobs) — real, larger work explicitly
# deferred, not done here — actually lands. A false "healthy" here would
# be worse than a currently-true "still needs attention."
SNAPSHOT_CACHE_TOTAL_WARN_MB = 800
SNAPSHOT_CACHE_SINGLE_KEY_WARN_MB = 10


async def check_declared_pairs_produce() -> dict:
    """Every (sport, provider) MATRIX declares must actually produce.

    See declared_pairs.py for why this exists and why it does not duplicate
    check_game_odds_book_lines_freshness. The DB half lives here; the decision
    half is a pure function there, so it is testable without a database.
    """
    import declared_pairs
    import provider_matrix as pm

    window = "24 hours"
    pool = await db.get_pool()
    async with pool.acquire(timeout=20.0) as conn:
        lines = await conn.fetch(
            "SELECT DISTINCT sport, source FROM game_odds_book_lines "
            "WHERE fetched_at > now() - interval '24 hours'"
        )
        props = await conn.fetch(
            "SELECT DISTINCT provider_id FROM prop_odds "
            "WHERE fetched_at > now() - interval '24 hours'"
        )
    line_pairs = {(r["sport"], r["source"]) for r in lines}
    prop_providers = {r["provider_id"] for r in props}
    # A sport counts as LIVE if anything at all produced for it. Deriving this
    # from real production rather than a schedule is what lets the check run
    # with no season logic and no per-sport schedule fetch.
    active = {sport for sport, _ in line_pairs}
    result = declared_pairs.evaluate(pm.MATRIX, line_pairs, prop_providers, active)
    result["window"] = window
    return result


async def check_snapshot_cache_size() -> dict:
    """Catches runaway snapshot_cache growth (the exact class of problem
    that produced a real 103GB egress overage before anyone noticed) in
    days via this cron's own 15min cadence, not after a full billing
    cycle has already blown through its cap. Two real signals: total
    table size, and the single largest payload (a large individual
    cache key means every hit-or-miss request for it is expensive
    regardless of how often it's actually re-fetched)."""
    # pg_column_size, not LENGTH. LENGTH(payload) counts CHARACTERS of the
    # uncompressed text; pg_column_size returns what the value actually
    # occupies after TOAST compression, which is the number a storage alarm
    # is about. They differ by ~6.4x here: this check reported "largest
    # single payload 72.4MB" for mlb:full-raw:2026-08-26 while that row cost
    # 11.2MB on disk (measured 2026-08-28). The thresholds below were
    # themselves calibrated against the compressed figure — the comment on
    # SNAPSHOT_CACHE_SINGLE_KEY_WARN_MB cites 11.22MB, which is a
    # pg_column_size number — so the check was comparing an uncompressed
    # measurement against a compressed threshold and overstating every
    # reading. Found by Phase 0's gate (docs/audit-remediation-plan.md).
    pool = await db.get_pool()
    total_row = await pool.fetchrow("SELECT SUM(pg_column_size(payload)) AS total_bytes, COUNT(*) AS n FROM snapshot_cache")
    total_bytes = total_row["total_bytes"] or 0
    total_mb = total_bytes / 1024 / 1024

    biggest = await pool.fetch("SELECT cache_key, pg_column_size(payload) AS bytes FROM snapshot_cache ORDER BY pg_column_size(payload) DESC LIMIT 5")
    biggest_desc = ", ".join(f"{r['cache_key']} ({r['bytes'] / 1024 / 1024:.1f}MB)" for r in biggest)
    max_single_mb = (biggest[0]["bytes"] / 1024 / 1024) if biggest else 0.0

    problems = []
    if total_mb > SNAPSHOT_CACHE_TOTAL_WARN_MB:
        problems.append(f"total size {total_mb:.0f}MB exceeds {SNAPSHOT_CACHE_TOTAL_WARN_MB}MB")
    if max_single_mb > SNAPSHOT_CACHE_SINGLE_KEY_WARN_MB:
        problems.append(f"largest single payload {max_single_mb:.1f}MB exceeds {SNAPSHOT_CACHE_SINGLE_KEY_WARN_MB}MB")

    if problems:
        return {
            "name": "snapshotCacheSize",
            "status": f"STALE — {'; '.join(problems)} — top keys: {biggest_desc}",
            "healthy": False,
        }
    return {
        "name": "snapshotCacheSize",
        "status": f"healthy — {total_mb:.0f}MB total across {total_row['n']} rows, largest single payload {max_single_mb:.1f}MB",
        "healthy": True,
    }


async def check_golf_predictions_freshness() -> dict:
    """Ground truth for job_golf_predictions (predict/golf_candidates.py
    + predict/golf_history.py + predict/golf_grading.py) — verifies real
    golf_model_predictions/golf_tournament_predictions rows exist for
    today's real field, not just that the job reports ok. `probWin`/
    `probTop5`/`probTop10`/`probMadeCut` are also range-sanity-checked
    (each in [0,1], `probTop5 >= probWin`, `probTop10 >= probTop5`) —
    golf has no MLB-style fixed schedule to check candidate counts
    against, so a probability-shape check is the meaningful ground truth
    here instead."""
    payload = await db.read_snapshot("python-harness:job-run:golfPredictionsJob")
    if payload is None:
        return {"name": "golfPredictionsFreshness", "status": "NEVER RUN — golfPredictionsJob has no run breadcrumb yet", "healthy": False}
    last_run = json.loads(payload)
    if not last_run.get("ok"):
        return {"name": "golfPredictionsFreshness", "status": f"job's last run failed: {last_run.get('error', 'unknown error')}", "healthy": False}

    event_id = last_run.get("event")
    if not event_id:
        return {"name": "golfPredictionsFreshness", "status": "healthy — no golf event in progress (ESPN feed reported nothing to show)", "healthy": True}

    golfers = last_run.get("golfers", 0)
    if golfers == 0:
        return {"name": "golfPredictionsFreshness", "status": "healthy — event reported but no golfers in the field yet", "healthy": True}

    pool = await db.get_pool()
    hole_round_rows = await pool.fetchval("SELECT COUNT(DISTINCT espn_id) FROM golf_model_predictions WHERE event_id = $1", event_id)
    tournament_rows = await pool.fetch("SELECT prob_win, prob_top5, prob_top10, prob_made_cut FROM golf_tournament_predictions WHERE event_id = $1", event_id)

    problems: list[str] = []
    if hole_round_rows == 0:
        problems.append("zero golfers have any hole/round-score prediction row")
    for r in tournament_rows:
        vals = (r["prob_win"], r["prob_top5"], r["prob_top10"], r["prob_made_cut"])
        if any(v is not None and not (0.0 <= v <= 1.0) for v in vals):
            problems.append(f"a tournament prediction row has a probability outside [0,1]: {vals}")
            break
    bad_ordering = next((r for r in tournament_rows if r["prob_top5"] is not None and r["prob_win"] is not None and r["prob_top5"] < r["prob_win"] - 1e-9), None)
    if bad_ordering:
        problems.append("a golfer's probTop5 is less than their own probWin — impossible ordering")

    if problems:
        return {"name": "golfPredictionsFreshness", "status": f"STALE/BROKEN — {'; '.join(problems)} (event {event_id}, {golfers} golfers reported by last run)", "healthy": False}

    return {
        "name": "golfPredictionsFreshness",
        "status": f"healthy — {hole_round_rows} golfers have hole/round predictions, {len(tournament_rows)} have tournament predictions, all probabilities well-formed (event {event_id})",
        "healthy": True,
    }



# ---------------------------------------------------------------------------
# Acknowledged checks — reported, but not alerted on
# ---------------------------------------------------------------------------
# A check listed here still runs, still prints, and still writes its real
# healthy=False to job_health_checks. It just doesn't drive this script's exit
# code, which is what Render turns into an email.
#
# Why this exists. snapshotCacheSize has a threshold deliberately set below
# real state (see SNAPSHOT_CACHE_SINGLE_KEY_WARN_MB) so it stays red until the
# MLB snapshot is split into scoped caches — a decision worth keeping. But a
# check that is red on purpose, forever, makes the cron exit 1 on every one of
# its 96 daily runs, so the alert channel can no longer distinguish "the thing
# we already know about" from "something just broke." The operator filters the
# mail to trash within days, and every later observability improvement lands on
# a channel nobody reads. Phase 0.8 of docs/audit-remediation-plan.md names
# exactly this failure: "a permanently-red check trains you to ignore the
# dashboard."
#
# The obvious risk is that this becomes a place to hide failures. Rules, same
# as DISABLED_JOBS in jobs.py (rule G6):
#
#   1. Every entry needs a date, a reason, and the TASK NUMBER that removes it.
#      _validate_acknowledged() enforces the task number at import time — an
#      entry without one is a crash, not a silent pass.
#   2. Acknowledging is for a condition you have decided to live with on a
#      schedule. It is never for a check you have not understood yet.
#   3. An acknowledged check that turns healthy should be deleted from here,
#      not left "in case." The run output flags that for you.
ACKNOWLEDGED_CHECKS: dict[str, str] = {
    "snapshotCacheSize": (
        "2026-08-28, task 3.3 — threshold is deliberately below real state "
        "(largest payload 11.3MB vs a 10MB guard) and stays red until the MLB "
        "snapshot is split into scoped caches. Cleared by task 3.3."
    ),
}


def _validate_acknowledged() -> None:
    """Fails loudly at import if an entry skips the discipline above. A rule
    nothing enforces is a comment."""
    for name, reason in ACKNOWLEDGED_CHECKS.items():
        if not re.search(r"task \d+(\.\d+)?", reason):
            raise ValueError(
                f"ACKNOWLEDGED_CHECKS[{name!r}] must name the task that clears it "
                f"(e.g. 'task 3.3'); got: {reason!r}"
            )


_validate_acknowledged()


async def main() -> int:
    job_results = await asyncio.gather(*(check_job(name, interval) for name, _, interval in JOB_REGISTRY))
    results = [
        *job_results,
        await check_archive_freshness(),
        await check_capture_latency(),
        await check_elo_freshness(),
        await check_mlb_model_freshness(),
        await check_game_model_freshness(),
        await check_game_picks_freshness(),
        await check_odds_history_and_prices_freshness(),
        await check_prop_predictions_freshness(),
        await check_golf_predictions_freshness(),
        await check_game_odds_book_lines_freshness(),
        await check_snapshot_cache_size(),
        await check_declared_pairs_produce(),
    ]

    print(f"[health_check] {datetime.now(timezone.utc).isoformat()}", flush=True)
    alerting_failures: list[str] = []
    acknowledged_failures: list[str] = []
    resolved_acknowledgements: list[str] = []

    for r in results:
        acknowledged = r["name"] in ACKNOWLEDGED_CHECKS
        if r["healthy"]:
            marker = "OK  "
            if acknowledged:
                # It recovered. Say so every run until someone deletes the
                # entry — an acknowledgement nobody removes is how this list
                # turns into a permanently-green board that means nothing.
                resolved_acknowledgements.append(r["name"])
        elif acknowledged:
            marker = "ACK "
            acknowledged_failures.append(r["name"])
        else:
            marker = "FAIL"
            alerting_failures.append(r["name"])
        print(f"  [{marker}] {r['name']}: {r['status']}", flush=True)

    for name in acknowledged_failures:
        print(f"  [ACK ] ^ acknowledged: {ACKNOWLEDGED_CHECKS[name]}", flush=True)
    for name in resolved_acknowledgements:
        print(
            f"  [NOTE] {name} is healthy but still in ACKNOWLEDGED_CHECKS — "
            f"remove it from health_check.py so it can alert again",
            flush=True,
        )

    # Writes every check's REAL healthy value, acknowledged or not. The
    # acknowledgement changes what wakes somebody up; it must never change what
    # /diagnostics and job_health_checks report, or this becomes a way to lie
    # to the dashboard as well as to the pager.
    await db.write_health_check_results(results)

    if alerting_failures:
        overall = f"UNHEALTHY — {len(alerting_failures)} check(s) failing: {', '.join(alerting_failures)}"
    elif acknowledged_failures:
        overall = (
            f"HEALTHY (nothing new) — {len(acknowledged_failures)} acknowledged: "
            f"{', '.join(acknowledged_failures)}"
        )
    else:
        overall = "HEALTHY"
    print(f"\n[health_check] overall: {overall}", flush=True)

    # Exit code drives Render's failure notification, so only genuinely new
    # failures may set it.
    return 1 if alerting_failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
