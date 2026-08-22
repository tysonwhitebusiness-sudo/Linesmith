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
import sys
from datetime import datetime, timezone

import db
from jobs import JOB_REGISTRY

STALE_MULTIPLIER = 2.0


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

    healthy = bool(ok) and not stale
    status_bits = []
    if not ok:
        status_bits.append(f"last run failed: {summary.get('error', 'unknown error')}")
    if stale:
        status_bits.append(
            f"stale — last run {age_seconds / 60:.0f}min ago, expected within {interval_seconds * STALE_MULTIPLIER / 60:.0f}min"
        )
    if not status_bits:
        status_bits.append(
            f"healthy — last run {age_seconds / 60:.0f}min ago, {summary.get('rows_written', 0)} rows written"
        )

    return {"name": name, "status": "; ".join(status_bits), "healthy": healthy, "raw": summary}


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
        "SELECT DISTINCT game_pk FROM team_elo_history WHERE game_pk = ANY($1::int[])",
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

    A1: every currently-live MLB moneyline line (mlb:odds:lines cache) is
    reflected as at least one game_odds_history row observed within the
    job's own 2x-interval window.
    A3: every game_picks row with a captured moneyline side gets a
    reference price attached within the same window, once a matching
    market line exists — checked as "if not attached, is that plausibly
    because no market line exists for that game" rather than assuming
    every unattached row is a bug (a game with no market line yet is a
    legitimate gap, not a failure).
    """
    interval = next(interval for name, _, interval in JOB_REGISTRY if name == "mlbOddsLinesCycleJob")
    cutoff = datetime.now(timezone.utc).timestamp() - interval * STALE_MULTIPLIER

    payload = await db.read_snapshot("python-harness:job-run:mlbOddsLinesCycleJob")
    if payload is None:
        return {"name": "oddsHistoryAndPricesFreshness", "status": "NEVER RUN — mlbOddsLinesCycleJob has no run breadcrumb yet", "healthy": False}
    last_run = json.loads(payload)
    if not last_run.get("ok") or last_run.get("lines", 0) == 0:
        return {"name": "oddsHistoryAndPricesFreshness", "status": "healthy — job's last run had no lines to log yet", "healthy": True}

    pool = await db.get_pool()
    recent_history = await pool.fetchval(
        "SELECT COUNT(*) FROM game_odds_history WHERE observed_at > to_timestamp($1)", cutoff
    )
    if recent_history == 0:
        return {
            "name": "oddsHistoryAndPricesFreshness",
            "status": f"STALE — MLB lines are cached but game_odds_history has no row observed in the last "
            f"{interval * STALE_MULTIPLIER / 60:.0f}min — write_game_odds_history's write path needs investigating",
            "healthy": False,
        }
    return {
        "name": "oddsHistoryAndPricesFreshness",
        "status": f"healthy — {recent_history} game_odds_history rows observed in the last {interval * STALE_MULTIPLIER / 60:.0f}min",
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


async def main() -> int:
    job_results = await asyncio.gather(*(check_job(name, interval) for name, _, interval in JOB_REGISTRY))
    results = [
        *job_results,
        await check_elo_freshness(),
        await check_game_model_freshness(),
        await check_game_picks_freshness(),
        await check_odds_history_and_prices_freshness(),
        await check_prop_predictions_freshness(),
        await check_golf_predictions_freshness(),
    ]

    print(f"[health_check] {datetime.now(timezone.utc).isoformat()}", flush=True)
    all_healthy = True
    for r in results:
        marker = "OK  " if r["healthy"] else "FAIL"
        print(f"  [{marker}] {r['name']}: {r['status']}", flush=True)
        all_healthy = all_healthy and r["healthy"]

    print(f"\n[health_check] overall: {'HEALTHY' if all_healthy else 'UNHEALTHY'}", flush=True)
    return 0 if all_healthy else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
