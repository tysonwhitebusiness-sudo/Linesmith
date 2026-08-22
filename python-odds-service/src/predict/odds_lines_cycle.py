"""Direct port of app/api/odds/lines/route.ts's MLB path — not a
reimplementation. This is Phase G of the prediction-engine port: the
orchestrating job tying Phases A-F together into a real, always-on capture
cycle for the Linesmith Pick lock system.

Scope, deliberately bounded (see docs/mlb-prediction-engine-python-port-
gameplan-2026-08-21.md's Phase G audit): this reads the MLB snapshot's
already-computed gameModel/Elo fields from the shared snapshot_cache table
(TS's adapter.ts still computes and publishes them every ~5 minutes) rather
than recomputing them independently in Python. Cutting adapter.ts's own
live-compute over to a Postgres read is real surgery on a 2321-line file
that serves live production pages — CLAUDE.md's own "hard to reverse,
affects shared systems" bar — and was deliberately NOT attempted in this
pass. What Phase G *does* deliver is real: this cycle runs on a genuine
SequentialQueue interval regardless of whether anyone loads the TS page
near 6am/3-hours-before, which is the actual "genuine correctness upgrade"
Phase E's own module docstring promised and could not yet deliver without
this phase's data. Safe to run alongside TS's own route.ts (still live,
unchanged) for the same reason Phase E's grading job is safe: both write
through capture_moneyline_pick/capture_total_pick's `_captured_at IS NULL`
guard, so a race is a harmless no-op.

Also deliberately NOT ported here (secondary/polish, not core to "the pick
gets captured on time"): logGameOddsHistory (history logging — TS's still-
live route.ts keeps writing this table, and Python only READS from it via
get_earliest_observed_total_point), logTotalPredictionsFromLines
(calibration logging), attachPricesFromLines (best-effort reference-price
attachment to an already-locked pick, never changes which side is picked).
mergeLines's OddsHarvester half is skipped entirely — confirmed dead by the
user this session, and with an empty harvester match list mergeLines
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
from .odds_math import american_to_decimal, devig_two_way
from .statsapi import eastern_date, get_team_bullpen_era


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


def _parse_snapshot_game(g: dict) -> SnapshotGame:
    gm = g.get("gameModel")
    elo = g.get("elo")
    return SnapshotGame(
        game_pk=str(g.get("gamePk")),
        home_team_id=g.get("homeTeamId"),
        away_team_id=g.get("awayTeamId"),
        away_team_name=g.get("awayTeamName"),
        home_team_name=g.get("homeTeamName"),
        matchup=g.get("matchup"),
        first_pitch=g.get("firstPitch"),
        status=g.get("status"),
        game_model=(
            SnapshotGameModel(
                home_expected_runs=gm.get("homeExpectedRuns"),
                away_expected_runs=gm.get("awayExpectedRuns"),
                home_win_prob=gm.get("homeWinProb"),
                away_win_prob=gm.get("awayWinProb"),
                diagnostics=_parse_diagnostics(gm.get("diagnostics") or {}),
            )
            if gm
            else None
        ),
        elo=(
            SnapshotElo(
                home_elo=elo["home"]["elo"],
                home_games_played=elo["home"]["gamesPlayed"],
                away_elo=elo["away"]["elo"],
                away_games_played=elo["away"]["gamesPlayed"],
                home_rest_days=elo.get("homeRestDays"),
                away_rest_days=elo.get("awayRestDays"),
                home_travel_miles=elo.get("homeTravelMiles"),
                away_travel_miles=elo.get("awayTravelMiles"),
                home_pitcher_adj=elo.get("homePitcherAdj"),
                away_pitcher_adj=elo.get("awayPitcherAdj"),
            )
            if elo
            else None
        ),
    )


async def read_games_from_snapshot() -> list[SnapshotGame]:
    """Reads and parses snapshot_cache['mlb:snapshot'] once — [] on a
    missing cache or a parse failure, matching the TS source's own
    graceful-empty convention (every caller already treats an empty list as
    its own no-op)."""
    payload = await db.read_snapshot("mlb:snapshot")
    if not payload:
        return []
    try:
        snapshot = json.loads(payload)
        games = ((snapshot.get("context") or {}).get("other") or {}).get("games") or []
        return [_parse_snapshot_game(g) for g in games]
    except (ValueError, KeyError, TypeError):
        return []


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

    for line in lines:
        if line.total is None or line.total.point is None:
            continue
        game = next((g for g in games if g.away_team_name and g.home_team_name and _team_key(g.away_team_name) == _team_key(line.away_team) and _team_key(g.home_team_name) == _team_key(line.home_team)), None)
        if game is None or game.game_model is None:
            continue

        model = compute_total_model(TotalModelInput(home_expected_runs=game.game_model.home_expected_runs, away_expected_runs=game.game_model.away_expected_runs, line=line.total.point))

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
# Orchestrator
# ---------------------------------------------------------------------------


async def run_mlb_odds_lines_cycle(client: httpx.AsyncClient, now=None) -> dict:
    """The full MLB path of app/api/odds/lines/route.ts's GET handler,
    minus the secondary/polish pieces documented in this module's
    docstring. Fetches market lines, reads the shared snapshot, and runs
    both lock cycles."""
    result = await get_mlb_game_lines(client)
    games = await read_games_from_snapshot()

    await run_total_lock_from_lines(client, result.lines, games, now)
    await run_moneyline_lock_from_snapshot(result.lines, games, now)

    return {"lines": len(result.lines), "games": len(games), "from_cache": result.from_cache, "warnings": result.warnings}
