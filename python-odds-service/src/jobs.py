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
from game_context import load_mlb_games, load_sport_games, load_tennis_games
from job_runner import run_provider_specs
from providers import (
    ProviderSpec,
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
            # Recovered game-lines board (2026-08-26 odds-architecture
            # rebuild) — a second, genuinely separate request against the
            # same SharpAPI account (is_player_prop=false). Real added
            # volume, not a free parse: still cap_kind="none" because
            # SharpAPI's documented free-tier limit is 12 req/min and Tier
            # 1's real cadence is ~1 cycle/2.5min, so even two calls per
            # cycle stays far under that — see fetch_sharpapi_game_lines's
            # own docstring for the arithmetic.
            provider_id="sharpapi_lines",
            enabled=config.SHARPAPI_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_sharpapi_game_lines(client, config.SHARPAPI_KEY, games),
            cap_kind="none",
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
    # MLS reuses EPL's identity (same provider_id "parlayapi_soccer") rather
    # than a new key — no dedicated MLS ParlayAPI account exists yet (see
    # docs/soccer-gameplan-2026-08-22.md §3.4/§9). Real consequence: EPL and
    # MLS now share one soccer-wide monthly budget instead of each having
    # their own — flagged, not silently absorbed.
    "soccer_mls": (
        "parlayapi_soccer",
        config.PARLAYAPI_SOCCER_KEY,
        config.PARLAYAPI_SOCCER_ENABLED,
        config.PARLAYAPI_SOCCER_MONTHLY_LIMIT,
    ),
    # No real ParlayAPI NBA account yet — PARLAYAPI_NBA_ENABLED naturally
    # stays False until config.py's PARLAYAPI_NBA_KEY is set on Render (see
    # that file's comment). Declared anyway so job_nba can reuse
    # _job_multisport generically instead of a bespoke job body.
    "nba": ("parlayapi_nba", config.PARLAYAPI_NBA_KEY, config.PARLAYAPI_NBA_ENABLED, config.PARLAYAPI_NBA_MONTHLY_LIMIT),
}


_PARLAYAPI_SPORT_SOFT_CAP = {
    "mlb": config.PARLAYAPI_MLB_SOFT_CAP,
    "nfl": config.PARLAYAPI_NFL_SOFT_CAP,
    "cfb": config.PARLAYAPI_CFB_SOFT_CAP,
    "soccer_epl": config.PARLAYAPI_SOCCER_SOFT_CAP,
    "soccer_mls": config.PARLAYAPI_SOCCER_SOFT_CAP,
    "nba": config.PARLAYAPI_NBA_SOFT_CAP,
}


def _parlayapi_sport_spec(sport: str) -> ProviderSpec:
    provider_id, key, enabled, cap_limit = _PARLAYAPI_SPORT_CONFIG[sport]
    return ProviderSpec(
        provider_id=provider_id,
        enabled=enabled,
        fetch=lambda client, games, yield_fn: fetch_parlayapi(client, key, games, sport),
        cap_kind="monthly",
        cap_limit=cap_limit,  # hard limit — matches multiSportRefresh.ts's `budget.exhausted` gate
        # Task 5.9 (P2 H3): the PARLAYAPI_*_SOFT_CAP env vars were configured,
        # documented, and never read by config.py. Now they gate, below the
        # hard limit, and job_runner names which of the two stopped the job.
        soft_cap=_PARLAYAPI_SPORT_SOFT_CAP.get(sport) or None,
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


async def job_nba(yield_fn=None) -> dict:
    # Real coverage today: SportsGameOdds only (shared multisport account,
    # already provisioned) — ParlayAPI NBA naturally no-ops until a real
    # PARLAYAPI_NBA_KEY exists (see config.py/_PARLAYAPI_SPORT_CONFIG's
    # comments). Reuses _job_multisport generically, same as NFL/CFB —
    # nothing NBA-specific needed in the shared runner.
    return await _job_multisport("refreshNbaJob", "nba", yield_fn)


def _soccer_epl_specs() -> list[ProviderSpec]:
    return [
        ProviderSpec(
            # Task 5.2 (P3 H7). The gap flagged here in Phase 2 is now closed.
            # cap_kind="none" meant no rate-limit gate AND — the part only
            # measurement revealed — no spend recording either, since
            # job_runner only recorded spend when cap_kind != "none". So
            # propline_2's usage simply vanished, which is why the audit read
            # its silence as vendor-side rejection.
            provider_id="propline_2",
            enabled=config.PROPLINE_2_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_propline(
                client, config.PROPLINE_2_KEY, games, "soccer_epl", provider_id="propline_2"
            ),
            cap_kind="daily",
            cap_limit=config.PROPLINE_2_DAILY_LIMIT,
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


def _soccer_mls_specs(yield_fn) -> list[ProviderSpec]:
    """MLS gets the same Propline/ParlayAPI shape as EPL (§9), plus a real
    SportsGameOdds spec EPL doesn't get — SGO's soccer coverage is MLS/UCL
    specifically, confirmed live (docs/soccer-gameplan-2026-08-22.md §2):
    a real MLS event returned 160 game-level odds entries (3-way
    moneyline/spread/total/odd-even) alongside 1,580 player-prop entries.
    Reuses the NFL/CFB SportsGameOdds account (`_sportsgameodds_multisport_spec`)
    rather than provisioning a 4th key — no new MLS-dedicated SGO account
    exists, same reuse-and-flag posture as the ParlayAPI identity above.
    """
    return [
        ProviderSpec(
            # Same real daily cap as EPL's spec above (task 5.2) — one vendor
            # account, so EPL and MLS share the one 1,000/day budget, which is
            # exactly what the shared provider_id already implied.
            provider_id="propline_2",
            enabled=config.PROPLINE_2_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_propline(
                client, config.PROPLINE_2_KEY, games, "soccer_mls", provider_id="propline_2"
            ),
            cap_kind="daily",
            cap_limit=config.PROPLINE_2_DAILY_LIMIT,
        ),
        _parlayapi_sport_spec("soccer_mls"),
        _sportsgameodds_multisport_spec(yield_fn),
    ]


async def job_soccer_mls(yield_fn=None) -> dict:
    games = [g for g in await load_sport_games("soccer_mls") if not g.is_final]
    tier, should_fetch = await gameday.should_fetch_paid_providers("soccer_mls", games)
    if not should_fetch:
        return await _run_timed("refreshSoccerMlsJob", _return_dict(gameday.skip_summary(games, tier)))

    async with httpx.AsyncClient() as client:
        return await _run_timed(
            "refreshSoccerMlsJob",
            run_provider_specs(client, games, _soccer_mls_specs(yield_fn), yield_fn=yield_fn, concurrent=False),
        )


def _tennis_specs(tour: str) -> list[ProviderSpec]:
    """SharpAPI is tennis's real, already-proven primary (per the multi-
    sport audit — "SharpAPI's tennis coverage rides the on-demand path" in
    the old TS scheduler). Reuses the shared MLB SHARPAPI_KEY rather than a
    new dedicated key — no separate tennis SharpAPI account exists, same
    reuse-and-flag posture as MLS's ParlayAPI/SportsGameOdds reuse above.
    Real `sport`/`league` query values (`tennis`/`atp` or `tennis/wta`) are
    a reasoned guess (matching the tennis_atp/tennis_wta SportKey
    convention already used elsewhere) — not yet live-verified against a
    real call, same caveat as NBA's/NHL's own market-key guesses.
    """
    return [
        ProviderSpec(
            provider_id="sharpapi",
            enabled=config.SHARPAPI_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_sharpapi(client, config.SHARPAPI_KEY, games, sport="tennis", league=tour),
            cap_kind="none",
        ),
        ProviderSpec(
            # Tennis has no spread/total concept (moneyline — and games/sets
            # handicap markets this doesn't yet cover — is the real market),
            # so this mainly recovers moneyline here; same market_type
            # matching as MLB, same unverified-live caveat as this file's
            # own tennis sport/league query values above.
            provider_id="sharpapi_lines",
            enabled=config.SHARPAPI_ENABLED,
            fetch=lambda client, games, yield_fn: fetch_sharpapi_game_lines(client, config.SHARPAPI_KEY, games, sport="tennis", league=tour),
            cap_kind="none",
        ),
    ]


async def _job_tennis(job_name: str, sport_key: str, tour: str, yield_fn) -> dict:
    games = [g for g in await load_tennis_games(sport_key) if not g.is_final]
    tier, should_fetch = await gameday.should_fetch_paid_providers(sport_key, games)
    if not should_fetch:
        return await _run_timed(job_name, _return_dict(gameday.skip_summary(games, tier)))

    async with httpx.AsyncClient() as client:
        return await _run_timed(
            job_name, run_provider_specs(client, games, _tennis_specs(tour), yield_fn=yield_fn, concurrent=False)
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
    async with httpx.AsyncClient() as client:
        for sport_key, app_sport in _APP_SPORT_BY_KEY.items():
            config = gte.SPORT_CONFIGS[sport_key]
            games = await gte.fetch_finished_games(client, config, start, end)
            finished = [
                FinishedGameInput(game_id=g.game_id, is_final=True, home_score=g.home_score, away_score=g.away_score)
                for g in games
            ]
            await grade_finished_game_picks(app_sport, finished)
            per_sport[sport_key] = {"finished": len(finished)}
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
    — prop_candidates.py only ever READ the cache
    (load_team_hr_rate_allowed_cache). The writer was
    lib/sports/mlb/homeRunLiveMatchup.ts, read-through on snapshot rebuild.

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


async def job_compute_mlb_prop_predictions(yield_fn=None) -> dict:
    """Player-prop predictions — port of adapter.ts's prediction-relevant
    candidate-building logic (predict/prop_candidates.py) plus Prop Score
    v1 (predict/prop_pick_history.py), run on a schedule instead of inside
    every live snapshot request. No status ('pre'/'live'/'done') gate,
    matching adapter.ts's own unconditional candidate loop — see
    prop_candidates.build_todays_candidates's docstring for why. Writes
    via db.log_surfaced's first-surfaced-wins INSERT ... ON CONFLICT DO
    NOTHING — whichever cycle is first to surface a (subject, dimension,
    category, game) tuple today locks its model_prob for the day, same as
    the TS original's logSnapshotCandidates."""
    return await _run_timed("computeMlbPropPredictionsJob", _compute_mlb_prop_predictions_inner())


def apply_prop_calibrations(candidates: list, calibrations: dict) -> tuple[list, int]:
    """Return (candidates with calibrated model_prob, how many were changed).

    Task 4.3 / Q39. Pulled out of _compute_mlb_prop_predictions_inner so it can
    be tested without a database -- see test_prop_calibration_applied.py. The
    job itself is a network+DB call end to end, which is exactly the shape that
    let 4.3 ship a calibration nothing applied.

    A candidate whose market has no ACTIVE calibration, or whose model_prob is
    None, passes through untouched. `dataclasses.replace` rather than mutation
    because CandidateResult is shared with the pick_history writer and an
    in-place edit would be invisible at the call site.
    """
    import dataclasses

    from predict.calibration import apply_calibration

    changed = 0
    out = []
    for c in candidates:
        row = calibrations.get(c.dimension)
        if row is not None and c.model_prob is not None:
            c = dataclasses.replace(c, model_prob=apply_calibration(c.model_prob, row))
            changed += 1
        out.append(c)
    return out, changed


async def _compute_mlb_prop_predictions_inner() -> dict:
    from predict import prop_candidates as pc
    from predict import prop_pick_history
    from predict import statsapi as sa

    today = sa.eastern_date()
    season = int(today[:4])
    async with httpx.AsyncClient() as client:
        ctx = await pc.build_snapshot_context(client, season)
        candidates = await pc.build_todays_candidates(client, today, season, ctx)

        # Task 4.3 / Q39 — APPLY the fitted calibrations. Until the Phase 4
        # gate this did not happen anywhere: 4.3 fitted seven Platt
        # calibrations into model_calibration and its VERIFY ("the table is no
        # longer empty") passed, but the only serve-time consumer
        # (odds_lines_cycle.py:557) asks for ('mlb','moneyline') and every
        # fitted row is a PROP market. So P3 H1 -- "probabilities are
        # uncalibrated" -- was still true of every number this job produced.
        #
        # This is the right insertion point rather than either writer, because
        # log_snapshot_candidates and write_prop_model_cache below deliberately
        # consume THIS ONE list so they cannot disagree about what the model
        # computed. Calibrating here keeps that invariant; calibrating in one
        # writer would break it.
        #
        # get_active_calibration returns only active=true rows, so a market
        # whose calibration lost to its baseline (runs, total-bases) is left
        # uncalibrated -- apply_calibration(p, None) is a no-op by design.
        calibrations: dict[str, "db.CalibrationRow"] = {}
        for dim in sorted({c.dimension for c in candidates}):
            row = await db.get_active_calibration("mlb", dim)
            if row is not None:
                calibrations[dim] = row
        if calibrations:
            candidates, calibrated_n = apply_prop_calibrations(candidates, calibrations)
            print(
                f"[computeMlbPropPredictionsJob] calibrated {calibrated_n} of "
                f"{len(candidates)} candidates across {len(calibrations)} markets: "
                f"{', '.join(sorted(calibrations))}",
                flush=True,
            )

        await prop_pick_history.log_snapshot_candidates("mlb", candidates)

        # Task 2.7a — the same candidates, written a second way, for a
        # different job. log_snapshot_candidates above is the immutable
        # record (first-surfaced-wins, never revised); this is the mutable
        # current state lib/sports/mlb/adapter.ts reads instead of
        # recomputing the model itself. Both come from THIS list, in one
        # pass, so they cannot disagree about what the model computed —
        # they differ only in which moment each preserves. See migration
        # 20260829010000.
        cached = await db.write_prop_model_cache(
            [
                db.PropModelCacheRow(
                    sport="mlb", game_id=c.game_id, subject_id=c.subject_id,
                    dimension=c.dimension, category=c.category, line=c.line,
                    model_prob=c.model_prob, model_std_dev=c.model_std_dev,
                    model_sample_size=c.model_sample_size, league_rate=c.league_rate,
                    matchup_favorable=c.matchup_favorable, model_version=c.model_version,
                )
                for c in candidates
            ]
        )
        pruned = await db.prune_prop_model_cache()

    by_dimension: dict[str, int] = {}
    for c in candidates:
        by_dimension[c.dimension] = by_dimension.get(c.dimension, 0) + 1

    return {"candidates": len(candidates), "by_dimension": by_dimension, "model_cache_rows": cached, "model_cache_pruned": pruned}


async def job_golf_predictions(yield_fn=None) -> dict:
    """Port of golf's own inline "Phase A prediction models" block
    (adapter.ts, adjacent to candidatesForGolfer/roundScoreCandidate) —
    compute models -> log predictions -> ingest history -> grade, on a
    scheduled interval. Golf has no pick-lock system (see
    predict/golf_history.py's own docstring) — this faithfully reproduces
    the real poll-and-upsert-until-graded capture pattern, not a new
    scheduled-lock design.

    This docstring used to say the work had been "moved from inside every
    live snapshot request". **That was false for six days.** adapter.ts
    kept all four of its write calls (logGolfTournamentPredictions ~661,
    logGolfModelPredictions ~675, void ingestGolfHistory ~689, void
    gradeAllGolfPredictions ~696) and kept running them on every golf page
    load, alongside this job, into the same six tables — finding P2 H1,
    which resolved an earlier phase's open question about what was writing
    golf_model_predictions while the worker was hung. The answer was
    adapter.ts. pg_stat_user_tables showed 5,243 updates against 4 inserts
    while every worker job's last run was hours stale.

    The TS calls were deleted in task 2.4 (2026-08-28), so this job is now
    the sole writer of all six golf tables in fact and not only on paper.
    Verified by observation, not by reading this file: golfPredictionsJob's
    own run breadcrumb at 22:51:07Z that day reported
    hole_round_predictions_logged=556, tournament_predictions_logged=30,
    predictions_ok=true, immediately before the deletion — the point being
    that a comment claiming a migration happened is worth nothing without
    the observation showing the remaining writer works."""
    return await _run_timed("golfPredictionsJob", _golf_predictions_inner())


async def _golf_predictions_inner() -> dict:
    from predict import golf_candidates, golf_grading, golf_history
    from predict.golf_espn import fetch_golf_event
    from predict.golf_venues import venue_coords
    from predict.weather import get_weather

    async with httpx.AsyncClient() as client:
        event = await fetch_golf_event(client)
        if event is None:
            return {"event": None, "reason": "ESPN golf feed unavailable"}

        wind_mph = temp_f = precip_prob = None
        coords = venue_coords(event.course.name if event.course else None)
        if coords:
            weather = await get_weather(client, coords[0], coords[1], False)
            if weather:
                wind_mph, temp_f, precip_prob = weather.wind_mph, weather.temp_f, weather.rain_pct

        try:
            prediction_summary = await golf_candidates.compute_and_log_golf_predictions(client, event, wind_mph)
            predictions_ok = True
            hole_round_logged = prediction_summary.hole_round_predictions_logged
            tournament_logged = prediction_summary.tournament_predictions_logged
        except Exception as err:  # noqa: BLE001 — a model failure must never break history/grading below
            await db.log_system_event("error", "golf/predictions", "Failed to compute golf prediction models for this poll", str(err))
            predictions_ok = False
            hole_round_logged = tournament_logged = 0

        await golf_history.ingest_golf_history(event, wind_mph, temp_f, precip_prob)
        graded = await golf_grading.grade_all_golf_predictions()

    return {
        "event": event.id,
        "event_name": event.name,
        "golfers": len(event.golfers),
        "predictions_ok": predictions_ok,
        "hole_round_predictions_logged": hole_round_logged,
        "tournament_predictions_logged": tournament_logged,
        "graded": graded,
    }


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


async def job_grade_generic_props(yield_fn=None) -> dict:
    """Phase 7 of docs/daily-picks-full-model-build-2026-08-27.md — real
    grading for the six sports Phase 4/5 produce pick_history candidates
    for. See predict/generic_prop_grading.py's own docstring for the real
    gap this closes: no generic prop-grading path existed anywhere in
    this codebase before this job (MLB's own grading.ts is the only
    prior writer, and it's MLB-specific end to end)."""
    return await _run_timed("gradeGenericPropsJob", _grade_generic_props_inner())


async def _grade_generic_props_inner() -> dict:
    from predict.generic_prop_grading import grade_all_sports

    results = await grade_all_sports()
    return {"per_sport": results}


def _make_generic_prop_production_job(sport_key: str, job_name: str):
    """One job function per sport, not one shared job looping all six —
    same reasoning refreshNflJob/refreshCfbJob/etc are already separate
    registry entries: a single slow sport (CFB's ~130-team, ~60-game
    Saturday slate is the real worst case) shouldn't risk the queue's
    600s per-job timeout for every other sport too. Real, disclosed risk
    not fully solved here: a genuinely maximal CFB Saturday could still
    exceed 600s and get cancelled mid-run — predict.generic_prop_
    production.run_sport writes db.log_surfaced incrementally (per team,
    not once at the end), so a cancellation loses only the remainder of
    that run, not partial/corrupt rows; the next tick picks up cleanly.
    Chunking a single sport's run across multiple ticks would fix this
    for real but is real, separate follow-on work, not attempted here."""

    async def _inner() -> dict:
        from predict.generic_prop_production import run_sport

        async with httpx.AsyncClient() as client:
            return await run_sport(sport_key, client)

    async def job(yield_fn=None) -> dict:
        return await _run_timed(job_name, _inner())

    job.__name__ = job_name
    return job


job_generic_prop_production_nfl = _make_generic_prop_production_job("nfl", "genericPropProductionNflJob")
job_generic_prop_production_cfb = _make_generic_prop_production_job("cfb", "genericPropProductionCfbJob")
job_generic_prop_production_nba = _make_generic_prop_production_job("nba", "genericPropProductionNbaJob")
job_generic_prop_production_nhl = _make_generic_prop_production_job("nhl", "genericPropProductionNhlJob")
job_generic_prop_production_soccer_epl = _make_generic_prop_production_job("soccer_epl", "genericPropProductionSoccerEplJob")
job_generic_prop_production_soccer_mls = _make_generic_prop_production_job("soccer_mls", "genericPropProductionSoccerMlsJob")


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
        return await statcast_pitches.ingest_recent(client, days=3, yield_fn=yield_fn)


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
        return await nhl_shots.ingest_recent(client, days=3, yield_fn=yield_fn)


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
        return await nba_shots.ingest_recent(client, days=3, yield_fn=yield_fn)


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
        return await nfl_pbp.ingest_recent(client, yield_fn=yield_fn)


JOB_REGISTRY = [
    # Phase 0.2 — the one job whose absence let the database reach 3x the
    # Free tier ceiling. Daily is the right cadence: every rule's window is
    # measured in days, so running it more often deletes the same zero rows,
    # while running it less often lets one stuck day's mlb:full-raw blobs
    # (~70 MB each) accumulate. health_check.py picks this up with no edit of
    # its own, per CLAUDE.md's job architecture — a claim the Phase 0 gate
    # tests rather than assumes.
    ("retentionJob", job_retention, 24 * 60 * 60),
    # Task 4.5 — CLV only moves when games finish and their closing prices are
    # logged, and the backtest walks every captured pick per run, so hourly is
    # the right cadence. health_check.py picks this up with no edit of its own.
    ("clvSummaryJob", job_clv_summary, 60 * 60),
    ("refreshTier1", job_tier1, 2.5 * 60),
    ("refreshSportsGameOddsJob", job_sportsgameodds, 90 * 60),
    ("refreshNflJob", job_nfl, 20 * 60),
    ("refreshCfbJob", job_cfb, 20 * 60),
    ("refreshNbaJob", job_nba, 20 * 60),
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
    ("computeMlbPropPredictionsJob", job_compute_mlb_prop_predictions, 5 * 60),
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
    ("maintainMlbHrMatchupJob", job_maintain_mlb_hr_matchup, 6 * 60 * 60),
    # Moved from "inside every live golf page request" (adapter.ts) to a
    # schedule — 5min matches the MLB props job's own "first-surfaced-
    # wins" cadence; golf's capture pattern is the same idea (poll-and-
    # upsert-until-graded), just simpler (no lock windows).
    ("golfPredictionsJob", job_golf_predictions, 5 * 60),
    # Matches mlbOddsLinesCycleJob's own 5min cadence and reasoning — see
    # job_generic_capture's own docstring.
    ("genericCaptureJob", job_generic_capture, 5 * 60),
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
    # NOTE: the six genericPropProduction*Job entries that used to sit here
    # are in DISABLED_JOBS below — see that list for why.
    # Not time-critical (a graded prop doesn't need to land within
    # seconds), matches gradeFinishedGenericPicksJob's own 15min
    # reasoning — real per-tick cost is cheap (a handful of ESPN
    # scoreboard calls plus DB reads for whatever's still ungraded).
    ("gradeGenericPropsJob", job_grade_generic_props, 15 * 60),
    ("gradeMlbPropsJob", job_grade_mlb_props, 15 * 60),
    # Re-enabled by Phase 2.2 (2026-08-28) after finding P3 H4's leakage was
    # fixed — see the note above DISABLED_JOBS. Back on their original
    # 60-minute cadence: the interval was never the bug, the missing
    # start-time check was, and a shorter interval would only have made a
    # leaked first-tick land sooner.
    ("genericPropProductionNflJob", job_generic_prop_production_nfl, 60 * 60),
    ("genericPropProductionCfbJob", job_generic_prop_production_cfb, 60 * 60),
    ("genericPropProductionNbaJob", job_generic_prop_production_nba, 60 * 60),
    ("genericPropProductionNhlJob", job_generic_prop_production_nhl, 60 * 60),
    ("genericPropProductionSoccerEplJob", job_generic_prop_production_soccer_epl, 60 * 60),
    ("genericPropProductionSoccerMlsJob", job_generic_prop_production_soccer_mls, 60 * 60),
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
# ---------------------------------------------------------------------------
# 2026-08-28 — Phase 2.2 re-enabled the six genericPropProduction*Job entries
# that lived here. Finding P3 H4 (docs/audit-phase-3.md:1183) is fixed, not
# merely worked around, by two guards in predict/generic_prop_production.py:
#
#   1. run_sport now drops any game whose commence_time has passed
#      (_has_not_started, which fails CLOSED on a missing or unparseable
#      time — an unknown start skips the game rather than predicting it).
#   2. _without_game strips the game being predicted out of every player's
#      own history before a candidate is built, so a prediction cannot
#      contain its own outcome even if guard 1 is bypassed or removed.
#
# pick_history.commence_time (migration 20260828120000) makes every row this
# job writes from now on auditable for leakage, which no row was before.
#
# Empty on purpose. If something is added here it needs a date, a reason,
# and the phase that re-enables it — rule G6 of docs/audit-remediation-plan.md.
DISABLED_JOBS: list = []
