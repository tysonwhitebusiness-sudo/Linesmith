"""Direct port of app/api/odds/lines/route.ts's MLB path — not a
reimplementation. This is Phase G of the prediction-engine port: the
orchestrating job tying earlier phases together into a real, always-on
capture cycle for the Linesmith Pick lock system.

Originally (Phase G) this read the MLB snapshot's already-computed
gameModel/Elo fields from the shared snapshot_cache table instead of
recomputing them independently — a deliberate, disclosed scope decision at
the time (cutting adapter.ts's own live-compute over to a Postgres read
was real surgery on a 2321-line file serving live production pages).
Phases K-O later built exactly that independent Postgres-backed path
(mlb_game_model_cache, populated by computeMlbGameModelJob) for adapter.ts
itself to read cache-first. This module was NOT updated to use it at the
time — verification after Phase P's real-world deploy caught the actual
cost: mlbOddsLinesCycleJob (the ONLY writer of game_picks after Phase P)
still depended on TS's snapshot_cache['mlb:snapshot'] staying fresh, which
it doesn't do reliably right at an eastern-date rollover (verified live:
73 minutes stale, still holding the prior day's finished slate, with zero
games available to capture against in the gap). `read_games_from_snapshot`
now reads from statsapi.get_slate + mlb_game_model_cache directly — the
same Postgres-native source adapter.ts's own Phase O fallback uses — so
this job no longer depends on TS staying fresh at all, closing that gap
for real rather than hoping the next page load or scheduler tick arrives
in time.

This cycle runs on a genuine SequentialQueue interval regardless of
whether anyone loads the TS page near 6am/3-hours-before, which is the
"genuine correctness upgrade" Phase E's own module docstring promised.
Safe to run alongside TS's own route.ts (when still live) for the same
reason Phase E's grading job is: both write through
capture_moneyline_pick/capture_total_pick's `_captured_at IS NULL` guard,
so a race is a harmless no-op.

mergeLines's OddsHarvester half is skipped entirely — confirmed dead by
the user this session, and with an empty harvester match list mergeLines
reduces to a straight field carry-over from GameLine, which is what
_to_unified below does directly.
"""
import json
from dataclasses import dataclass

import httpx

import db

from .elo_model import MIN_GAMES_FOR_ELO_TRUST, PredictionAdjustments, predict_home_win_prob
from .game_model import (
    FittedMoneylineDiagnostics,
    FittedMoneylineWeights,
    FittedTotalWeights,
    TotalFittedDiagnostics,
    TotalModelInput,
    apply_fitted_moneyline_weights,
    apply_fitted_total_weights,
    compute_moneyline_confidence_interval,
    compute_total_confidence_interval,
    compute_total_model,
    poisson_over_probability,
)
from .game_pick_lock import (
    MoneylineDiagnostics,
    MoneylineLockInput,
    TotalLockInput,
    run_moneyline_lock_cycle,
    run_total_lock_cycle,
)
from .game_sim_cache import load_game_sim
from .mlb_game_lines import GameLine, get_mlb_game_lines
from .odds_math import american_to_decimal, decimal_to_american, devig_two_way
from . import statsapi
from .statsapi import eastern_date, get_team_bullpen_era


def _status_for(abstract_state: str | None) -> str:
    """Same mapping as game_model_cache.py's own status_for — duplicated
    as a one-line dict lookup rather than imported, since game_model_cache
    already imports SnapshotElo/SnapshotGameModel FROM this module and
    importing back would be circular."""
    return {"Live": "live", "Preview": "pre", "Final": "done"}.get(abstract_state or "", "unknown")


def _team_key(name: str) -> str:
    """Matches TS's teamKey/normalizeTeam exactly — ASCII a-z only."""
    return "".join(c for c in name.lower() if "a" <= c <= "z")


# ---------------------------------------------------------------------------
# Reading the shared snapshot
# ---------------------------------------------------------------------------


@dataclass
class SnapshotGameModel:
    home_expected_runs: float
    away_expected_runs: float
    home_win_prob: float
    away_win_prob: float
    diagnostics: MoneylineDiagnostics


@dataclass
class SnapshotElo:
    home_elo: float
    home_games_played: int
    away_elo: float
    away_games_played: int
    home_rest_days: float
    away_rest_days: float
    home_travel_miles: float
    away_travel_miles: float
    home_pitcher_adj: float
    away_pitcher_adj: float


@dataclass
class SnapshotGame:
    game_pk: str
    home_team_id: int
    away_team_id: int
    away_team_name: str | None
    home_team_name: str | None
    matchup: str
    first_pitch: str | None
    status: str  # 'pre' | 'live' | 'done'
    game_model: SnapshotGameModel | None
    elo: SnapshotElo | None


def _parse_diagnostics(d: dict) -> MoneylineDiagnostics:
    return MoneylineDiagnostics(
        raw_log5_home_win_prob=d.get("rawLog5HomeWinProb"),
        home_venue_edge=d.get("homeVenueEdge"),
        away_venue_edge=d.get("awayVenueEdge"),
        home_recent_edge=d.get("homeRecentEdge"),
        away_recent_edge=d.get("awayRecentEdge"),
        raw_home_recent_edge=d.get("rawHomeRecentEdge"),
        raw_away_recent_edge=d.get("rawAwayRecentEdge"),
        park_factor=d.get("parkFactor"),
    )


async def read_games_from_snapshot(client: httpx.AsyncClient) -> list[SnapshotGame]:
    """Today's real games with real gameModel/Elo — sourced entirely from
    Python's own state (statsapi.get_slate + mlb_game_model_cache), never
    from TS's snapshot_cache['mlb:snapshot'].

    This used to read that TS-owned cache directly (see this module's
    original header comment, preserved above for history), which was a
    deliberate, disclosed scope decision at the time. Verification after
    Phase P's real-world deploy caught the actual cost of that decision:
    the moment the eastern date rolls over, mlb:snapshot keeps serving
    YESTERDAY's finished slate until something else (a real page load, or
    TS's own proactive scheduler) happens to rebuild it — verified live,
    73 minutes stale, still holding a `done` game from the prior day —
    which meant mlbOddsLinesCycleJob (the ONLY writer of game_picks after
    Phase P) silently had zero games to capture against for the entire gap.
    mlb_game_model_cache has no such dependency: computeMlbGameModelJob
    populates it directly from the live Stats API on its own schedule, so
    reading from it here removes the TS-freshness dependency entirely.
    `[]` on a missing/incomplete slate, matching the prior function's own
    graceful-empty convention (every caller already treats an empty list
    as its own no-op).
    """
    today = eastern_date()
    slate = await statsapi.get_slate(client, today)
    games: list[SnapshotGame] = []
    for g in slate:
        teams = g.teams or {}
        home_team = ((teams.get("home") or {}).get("team")) or {}
        away_team = ((teams.get("away") or {}).get("team")) or {}
        home_name = home_team.get("name")
        away_name = away_team.get("name")
        home_id = home_team.get("id")
        away_id = away_team.get("id")
        if home_id is None or away_id is None:
            continue

        cache_row = await db.read_game_model_cache("mlb", str(g.game_pk))
        game_model = None
        elo = None
        if cache_row is not None:
            diag = _parse_diagnostics(json.loads(cache_row.diagnostics_json))
            game_model = SnapshotGameModel(
                home_expected_runs=cache_row.home_expected_runs,
                away_expected_runs=cache_row.away_expected_runs,
                home_win_prob=cache_row.home_win_prob,
                away_win_prob=cache_row.away_win_prob,
                diagnostics=diag,
            )
            elo = SnapshotElo(
                home_elo=cache_row.home_elo,
                home_games_played=cache_row.home_games_played,
                away_elo=cache_row.away_elo,
                away_games_played=cache_row.away_games_played,
                home_rest_days=cache_row.home_rest_days,
                away_rest_days=cache_row.away_rest_days,
                home_travel_miles=cache_row.home_travel_miles,
                away_travel_miles=cache_row.away_travel_miles,
                home_pitcher_adj=cache_row.home_pitcher_adj,
                away_pitcher_adj=cache_row.away_pitcher_adj,
            )

        games.append(
            SnapshotGame(
                game_pk=str(g.game_pk),
                home_team_id=home_id,
                away_team_id=away_id,
                away_team_name=away_name,
                home_team_name=home_name,
                matchup=f"{away_name} @ {home_name}" if away_name and home_name else "",
                first_pitch=g.game_date,
                status=_status_for(g.abstract_state),
                game_model=game_model,
                elo=elo,
            )
        )
    return games


# ---------------------------------------------------------------------------
# Odds history logging (Track A1 of docs/full-prediction-engine-python-
# port-gameplan-2026-08-22.md) — direct port of lib/odds/gameOddsLog.ts's
# logGameOddsHistory. This is the only writer game_odds_history needs;
# get_earliest_observed_total_point (used by run_total_lock_from_lines
# below) already reads from this table, so this closes the loop that used
# to depend on route.ts still running to keep it fresh.
# ---------------------------------------------------------------------------


def _game_odds_history_rows(lines: list[GameLine]) -> list[db.GameOddsHistoryInput]:
    """Real bug caught during verification, fixed here rather than carried
    over: the "best available" price (line.moneyline/line.total, whose
    `book` field names whichever bookmaker happened to have the best price
    for that side) and that SAME bookmaker's own entry in `bookmakers[]`
    can legitimately disagree — they're populated from different parts of
    the-odds-api's response. Appending both as separate rows (what a naive
    port of the TS loop does) means a single poll can hand
    write_game_odds_history two different "current" prices for the
    identical (event, market, side, bookmaker) key — and since nothing
    about that discrepancy resolves itself between polls, every future
    call re-detects both as "changed" from whatever the other one last
    set, forever, verified live as unbounded row growth. Deduping to one
    row per key — keeping whichever was written LAST below, i.e. the
    bookmaker's own `bookmakers[]` entry when one exists, since that's the
    more specific, book-attributed source — makes "did the price change"
    well-defined again.
    """
    rows: dict[tuple[str, str, str, str], db.GameOddsHistoryInput] = {}

    def add(event_id: str, market: str, side: str, bookmaker: str, american_odds: int, point: float | None) -> None:
        rows[(event_id, market, side, bookmaker)] = db.GameOddsHistoryInput(event_id, market, side, bookmaker, american_odds, point)

    for line in lines:
        if line.moneyline and line.moneyline.home is not None and line.moneyline.book:
            add(line.event_id, "moneyline", "home", line.moneyline.book, int(line.moneyline.home), None)
        if line.moneyline and line.moneyline.away is not None and line.moneyline.book:
            add(line.event_id, "moneyline", "away", line.moneyline.book, int(line.moneyline.away), None)
        if line.total and line.total.over_price is not None and line.total.point is not None and line.total.book:
            add(line.event_id, "total", "over", line.total.book, int(line.total.over_price), line.total.point)
        if line.total and line.total.under_price is not None and line.total.point is not None and line.total.book:
            add(line.event_id, "total", "under", line.total.book, int(line.total.under_price), line.total.point)

        for book in line.bookmakers:
            home_american = decimal_to_american(book.home_odds)
            away_american = decimal_to_american(book.away_odds)
            if home_american is not None:
                add(line.event_id, "moneyline", "home", book.bookmaker, home_american, None)
            if away_american is not None:
                add(line.event_id, "moneyline", "away", book.bookmaker, away_american, None)

            over_american = decimal_to_american(book.over_price)
            under_american = decimal_to_american(book.under_price)
            if over_american is not None and book.point is not None:
                add(line.event_id, "total", "over", book.bookmaker, over_american, book.point)
            if under_american is not None and book.point is not None:
                add(line.event_id, "total", "under", book.bookmaker, under_american, book.point)
    return list(rows.values())


# ---------------------------------------------------------------------------
# Total (O/U) lock
# ---------------------------------------------------------------------------


async def run_total_lock_from_lines(client: httpx.AsyncClient, lines: list[GameLine], games: list[SnapshotGame], now=None) -> None:
    if not lines:
        return

    fitted_row = await db.get_active_model_weights("mlb", "total")
    fitted = FittedTotalWeights(weights=fitted_row.weights, intercept=fitted_row.intercept, covariance=fitted_row.covariance) if fitted_row else None

    season = int(eastern_date()[:4])
    inputs: list[TotalLockInput] = []
    # Track A2 of docs/full-prediction-engine-python-port-gameplan-2026-08-22.md
    # — direct port of route.ts's logTotalPredictionsFromLines. Logs the
    # RAW (un-fitted) model.over_prob computed below, same as the TS
    # original's own separate computeTotalModel call — calibration data,
    # deliberately not the fitted/blended over_prob used for the lock cycle.
    predictions: list[db.GameTotalPrediction] = []

    for line in lines:
        if line.total is None or line.total.point is None:
            continue
        game = next((g for g in games if g.away_team_name and g.home_team_name and _team_key(g.away_team_name) == _team_key(line.away_team) and _team_key(g.home_team_name) == _team_key(line.home_team)), None)
        if game is None or game.game_model is None:
            continue

        model = compute_total_model(TotalModelInput(home_expected_runs=game.game_model.home_expected_runs, away_expected_runs=game.game_model.away_expected_runs, line=line.total.point))
        predictions.append(db.GameTotalPrediction(game_pk=game.game_pk, total_line=line.total.point, over_prob=model.over_prob))

        market_over_prob = None
        if line.total.over_price is not None and line.total.under_price is not None:
            devigged = devig_two_way(american_to_decimal(line.total.over_price), american_to_decimal(line.total.under_price))
            market_over_prob = devigged[0] if devigged else None

        elo_raw_prob = _elo_prob_for_game(game.elo)

        over_prob = model.over_prob
        market_over_prob_for_blend = market_over_prob
        prob_lower_over = None
        prob_upper_over = None

        if fitted is not None:
            elo_for_fit = elo_raw_prob if elo_raw_prob is not None else 0.5
            market_for_fit = market_over_prob if market_over_prob is not None else 0.5
            opening_point = await db.get_earliest_observed_total_point(line.event_id)
            line_movement = (line.total.point - opening_point) if opening_point is not None else 0

            home_bullpen_era = await get_team_bullpen_era(client, game.home_team_id, season)
            away_bullpen_era = await get_team_bullpen_era(client, game.away_team_id, season)

            sim_cache = await load_game_sim(game.game_pk)
            sim_over_prob_for_fit = poisson_over_probability(sim_cache.expected_total, line.total.point) if sim_cache else model.over_prob

            total_diag = TotalFittedDiagnostics(
                raw_home_recent_edge=game.game_model.diagnostics.raw_home_recent_edge,
                raw_away_recent_edge=game.game_model.diagnostics.raw_away_recent_edge,
                park_factor=game.game_model.diagnostics.park_factor,
            )
            over_prob = apply_fitted_total_weights(model.over_prob, total_diag, elo_for_fit, market_for_fit, line_movement, home_bullpen_era, away_bullpen_era, sim_over_prob_for_fit, fitted)
            market_over_prob_for_blend = None  # already folded into over_prob above

            interval = compute_total_confidence_interval(model.over_prob, total_diag, elo_for_fit, market_for_fit, line_movement, home_bullpen_era, away_bullpen_era, sim_over_prob_for_fit, fitted)
            if interval:
                prob_lower_over = interval.lower_over
                prob_upper_over = interval.upper_over

        inputs.append(
            TotalLockInput(
                game_id=game.game_pk,
                home_team_id=game.home_team_id,
                away_team_id=game.away_team_id,
                home_team_name=game.home_team_name or line.home_team,
                away_team_name=game.away_team_name or line.away_team,
                matchup=game.matchup,
                commence_time=game.first_pitch,
                is_pre_game=game.status == "pre",
                line=line.total.point,
                over_prob=over_prob,
                market_over_prob=market_over_prob_for_blend,
                prob_lower_over=prob_lower_over,
                prob_upper_over=prob_upper_over,
            )
        )

    if predictions:
        await db.log_game_total_predictions("mlb", predictions)
    if inputs:
        await run_total_lock_cycle("mlb", inputs, now)


# ---------------------------------------------------------------------------
# Moneyline lock
# ---------------------------------------------------------------------------


def _elo_prob_for_game(elo: SnapshotElo | None) -> float | None:
    """Elo only gets a say once both teams have enough rated games this
    season to mean something."""
    if elo is None or elo.home_games_played < MIN_GAMES_FOR_ELO_TRUST or elo.away_games_played < MIN_GAMES_FOR_ELO_TRUST:
        return None
    return predict_home_win_prob(
        elo.home_elo,
        elo.away_elo,
        PredictionAdjustments(
            home_rest_days=elo.home_rest_days,
            away_rest_days=elo.away_rest_days,
            home_travel_miles=elo.home_travel_miles,
            away_travel_miles=elo.away_travel_miles,
            home_pitcher_adj=elo.home_pitcher_adj,
            away_pitcher_adj=elo.away_pitcher_adj,
        ),
    )


async def run_moneyline_lock_from_snapshot(lines: list[GameLine], games: list[SnapshotGame], now=None) -> None:
    fitted_row = await db.get_active_model_weights("mlb", "moneyline")
    fitted = FittedMoneylineWeights(weights=fitted_row.weights, intercept=fitted_row.intercept, covariance=fitted_row.covariance) if fitted_row else None

    inputs: list[MoneylineLockInput] = []
    for g in games:
        if g.game_model is None:
            continue
        line = next((l for l in lines if g.away_team_name and g.home_team_name and _team_key(l.away_team) == _team_key(g.away_team_name) and _team_key(l.home_team) == _team_key(g.home_team_name)), None)

        market_home_prob = None
        if line is not None and line.moneyline is not None and line.moneyline.home is not None and line.moneyline.away is not None:
            devigged = devig_two_way(american_to_decimal(line.moneyline.away), american_to_decimal(line.moneyline.home))
            market_home_prob = devigged[1] if devigged else None  # devig_two_way(a=away, b=home) -> b is home

        elo_raw_prob = _elo_prob_for_game(g.elo)

        home_win_prob = g.game_model.home_win_prob
        elo_home_prob = elo_raw_prob
        market_home_prob_for_blend = market_home_prob
        prob_lower_home = None
        prob_upper_home = None

        if fitted is not None:
            elo_for_fit = elo_raw_prob if elo_raw_prob is not None else 0.5
            market_for_fit = market_home_prob if market_home_prob is not None else 0.5
            sim_cache = await load_game_sim(g.game_pk)
            sim_win_prob_for_fit = sim_cache.home_win_prob if sim_cache is not None else 0.5

            fitted_diag = FittedMoneylineDiagnostics(
                raw_log5_home_win_prob=g.game_model.diagnostics.raw_log5_home_win_prob,
                home_venue_edge=g.game_model.diagnostics.home_venue_edge,
                away_venue_edge=g.game_model.diagnostics.away_venue_edge,
                raw_home_recent_edge=g.game_model.diagnostics.raw_home_recent_edge,
                raw_away_recent_edge=g.game_model.diagnostics.raw_away_recent_edge,
                park_factor=g.game_model.diagnostics.park_factor,
            )
            home_win_prob = apply_fitted_moneyline_weights(fitted_diag, elo_for_fit, market_for_fit, sim_win_prob_for_fit, fitted)
            elo_home_prob = None  # already folded into home_win_prob above
            market_home_prob_for_blend = None  # same

            interval = compute_moneyline_confidence_interval(fitted_diag, elo_for_fit, market_for_fit, sim_win_prob_for_fit, fitted)
            if interval:
                prob_lower_home = interval.lower_home
                prob_upper_home = interval.upper_home

        inputs.append(
            MoneylineLockInput(
                game_id=g.game_pk,
                home_team_id=g.home_team_id,
                away_team_id=g.away_team_id,
                home_team_name=g.home_team_name or (line.home_team if line else "") or "",
                away_team_name=g.away_team_name or (line.away_team if line else "") or "",
                matchup=g.matchup,
                commence_time=g.first_pitch,
                is_pre_game=g.status == "pre",
                home_win_prob=home_win_prob,
                away_win_prob=1 - home_win_prob,
                diagnostics=g.game_model.diagnostics,
                market_home_prob=market_home_prob_for_blend,
                elo_home_prob=elo_home_prob,
                prob_lower_home=prob_lower_home,
                prob_upper_home=prob_upper_home,
            )
        )

    if inputs:
        await run_moneyline_lock_cycle("mlb", inputs, now)


# ---------------------------------------------------------------------------
# Reference-price attachment (Track A3 of docs/full-prediction-engine-
# python-port-gameplan-2026-08-22.md) — direct port of route.ts's
# attachPricesFromLines. Best-effort: fills in the reference price shown
# next to an already-locked game_picks row, matched the same way the lock
# cycles themselves match. Never influences which side was picked.
# ---------------------------------------------------------------------------


async def attach_prices_from_lines(lines: list[GameLine], games: list[SnapshotGame]) -> None:
    if not lines:
        return
    for line in lines:
        game = next((g for g in games if g.away_team_name and g.home_team_name and _team_key(g.away_team_name) == _team_key(line.away_team) and _team_key(g.home_team_name) == _team_key(line.home_team)), None)
        if game is None:
            continue
        game_id = game.game_pk
        pick = await db.get_game_pick("mlb", game_id)
        if pick is None:
            continue

        if line.moneyline and line.moneyline.home is not None and pick.ml_initial_side == "home":
            await db.attach_moneyline_price("mlb", game_id, "initial", "home", int(line.moneyline.home))
        if line.moneyline and line.moneyline.away is not None and pick.ml_initial_side == "away":
            await db.attach_moneyline_price("mlb", game_id, "initial", "away", int(line.moneyline.away))
        if line.moneyline and line.moneyline.home is not None and pick.ml_final_side == "home":
            await db.attach_moneyline_price("mlb", game_id, "final", "home", int(line.moneyline.home))
        if line.moneyline and line.moneyline.away is not None and pick.ml_final_side == "away":
            await db.attach_moneyline_price("mlb", game_id, "final", "away", int(line.moneyline.away))

        if line.total and line.total.over_price is not None and pick.total_initial_side == "over":
            await db.attach_total_price("mlb", game_id, "initial", "over", int(line.total.over_price))
        if line.total and line.total.under_price is not None and pick.total_initial_side == "under":
            await db.attach_total_price("mlb", game_id, "initial", "under", int(line.total.under_price))
        if line.total and line.total.over_price is not None and pick.total_final_side == "over":
            await db.attach_total_price("mlb", game_id, "final", "over", int(line.total.over_price))
        if line.total and line.total.under_price is not None and pick.total_final_side == "under":
            await db.attach_total_price("mlb", game_id, "final", "under", int(line.total.under_price))


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def run_mlb_odds_lines_cycle(client: httpx.AsyncClient, now=None) -> dict:
    """The full MLB path of app/api/odds/lines/route.ts's GET handler,
    minus the secondary/polish pieces documented in this module's
    docstring. Fetches market lines, reads the shared snapshot, and runs
    both lock cycles."""
    result = await get_mlb_game_lines(client)
    games = await read_games_from_snapshot(client)

    await db.write_game_odds_history(_game_odds_history_rows(result.lines))
    await run_total_lock_from_lines(client, result.lines, games, now)
    await run_moneyline_lock_from_snapshot(result.lines, games, now)
    await attach_prices_from_lines(result.lines, games)

    return {"lines": len(result.lines), "games": len(games), "from_cache": result.from_cache, "warnings": result.warnings}
