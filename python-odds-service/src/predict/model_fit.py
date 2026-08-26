"""Direct port of lib/sports/mlb/modelFit.ts — not a reimplementation.

Walks seasons chronologically (same no-lookahead discipline as
elo_model.py's backfill), builds a training feature vector per game from
signals honestly available across the full historical window, fits a
small stacking logistic regression on top of them, and only activates the
result if it actually beats the current hand-coded formula on a holdout
slice (whole seasons, never trained on) it never trained on.

Elo here is a SEPARATE, self-contained walk from elo_model.py's own
DB-persisted backfill — same math (season-reversion via regress_to_mean,
update_elo per game), but recomputed locally across the full season list
in one pass so it stays correct regardless of what's currently in
team_elo_history. Seasons must be walked in ascending order in a single
call for this to carry forward correctly.

Market probability comes from historical_odds, populated by TS's
historicalOddsIngest.ts from real de-vigged sportsbook closing lines
(2010-2020 SBR spreadsheets, 2021-2025 multi-book CSV) — not ported here,
stays a TS-side one-time ingestion script; this module only needs read
access via db.get_historical_odds. Coverage isn't 100% — missing rows get
a neutral 0 (no signal) for the moneyline feature rather than being
dropped; build_training_set reports the real found/missing counts.

Still NOT a feature, a disclosed scoping gap rather than an oversight:
starter ERA blending. raw_log5 here is the team-only Pythagorean number,
not the starter-blended one the live model uses.
"""
from dataclasses import dataclass, field
from datetime import datetime

import httpx

import db
from predict import elo_model, statsapi
from predict.game_model import TeamRecordSplit, log5, poisson_over_probability, pythagorean_win_pct, split_edge
from predict.logistic_regression import brier_score, fit_logistic_regression, predict_prob
from predict.sim_game import simulate_team_matchup
from predict.sim_rates import compute_league_outcome_rates, compute_team_batting_vector, compute_team_pitching_vector

WARMUP_GAMES = 15
HOME_FIELD_EDGE = 0.04  # game_model.py's own constant, used here only for the baseline's holdout Brier comparison
MIN_SPLIT_SAMPLE = 8
MIN_RECENT_SAMPLE = 6
MAX_SPLIT_EDGE = 0.08
MAX_RECENT_EDGE = 0.1
RECENT_FORM_WEIGHT = 0.4

MONEYLINE_FEATURE_NAMES: tuple[str, ...] = ("rawLog5", "venueDiff", "formDiff", "parkFactorCentered", "eloProb", "marketProbCentered", "simWinProb")

# Total (O/U) market's own feature set — deliberately not a 1:1 copy of
# moneyline's. venueDiff is dropped: a team's home/away split is a
# win-rate signal, not a scoring-pace one. rawPoissonOverProb plays
# rawLog5's role as the dominant raw signal.
TOTAL_FEATURE_NAMES: tuple[str, ...] = ("rawPoissonOverProb", "formDiff", "parkFactorCentered", "eloProb", "marketProbCentered", "lineMovement", "bullpenEraCentered", "simOverProb")

# Sim-engine training pass — cheap N (not the live daily 10,000): the
# regression only needs the feature to be informative, not noise-free.
SIM_TRAINING_N = 300

# Round reference point for bullpen ERA, same role as game_model.py's
# NEUTRAL_TEMP_F — a reasonable modern-era center, not a precisely
# computed per-season league average.
NEUTRAL_BULLPEN_ERA = 4.3


def _parse_game_date(iso_str: str) -> datetime:
    s = iso_str[:-1] + "+00:00" if iso_str.endswith("Z") else iso_str
    return datetime.fromisoformat(s)


@dataclass
class TeamState:
    runs_for: float = 0.0
    runs_against: float = 0.0
    games: int = 0
    season: TeamRecordSplit = field(default_factory=lambda: TeamRecordSplit(wins=0, losses=0))
    home: TeamRecordSplit = field(default_factory=lambda: TeamRecordSplit(wins=0, losses=0))
    away: TeamRecordSplit = field(default_factory=lambda: TeamRecordSplit(wins=0, losses=0))
    recent_results: list[int] = field(default_factory=list)  # 1=win, 0=loss, chronological


def _last10(results: list[int]) -> TeamRecordSplit:
    last = results[-10:]
    wins = sum(last)
    return TeamRecordSplit(wins=wins, losses=len(last) - wins)


@dataclass
class TrainingRow:
    features: list[float]
    actual: int
    date: str
    season: int
    baseline_prob: float


@dataclass
class MarketCoverage:
    found: int = 0
    missing: int = 0


@dataclass
class LineCoverage:
    found: int = 0
    missing_or_push: int = 0


@dataclass
class TrainingSetResult:
    moneyline_rows: list[TrainingRow]
    market_coverage: MarketCoverage
    total_rows: list[TrainingRow]
    total_market_coverage: MarketCoverage
    total_line_coverage: LineCoverage
    line_movement_coverage: MarketCoverage
    bullpen_coverage: MarketCoverage


# In-process memo cache keyed by the exact seasons tuple requested — added
# after a real, measured cost problem, not a preemptive optimization: the
# cross-sport prediction framework's walk-forward CV (predict/walkforward.py)
# and multi-model benchmarking harness (predict/model_benchmark.py) mean
# several independent candidates (predict/mlb_model_candidates.py's
# formula/catboost/xgboost/lightgbm/mlp, plus predict/mlb_stacking.py's own
# sub-calls) now each request build_training_set for the SAME season lists
# repeatedly within one benchmark run — confirmed live: building a single
# season's training set (real per-team stats + a 300-iteration Monte Carlo
# sim PER GAME) measured ~15 real minutes; test_mlb_tree_models.py's three
# separate build_training_set calls (2023 train, 2022 score, one more inside
# the tree_fit_fn adapter check) took 33 minutes total before this cache
# existed. Safe to cache unconditionally: for any season fully in the past
# (every season this framework's walk-forward folds ever use, 2010-2025),
# build_training_set(seasons) is a pure function of `seasons` — the
# underlying finalized game/stat data doesn't change. NOT safe (and never
# hit by this cache) for a season still in progress, since range_end is
# statsapi.eastern_date() in that case — the cache key doesn't distinguish
# "today" from "yesterday" for an in-progress season, so a caller building
# a training set for the CURRENT season should bypass this cache; nothing
# in this framework does that today (walk-forward folds only ever use
# fully-completed past seasons).
_training_set_cache: dict[tuple[int, ...], "TrainingSetResult"] = {}


async def build_training_set(client: httpx.AsyncClient, seasons: list[int]) -> TrainingSetResult:
    """Walks every season in `seasons` in order, in one continuous pass, so
    Elo carries forward across season boundaries (with regression-to-mean
    applied at each team's own first game of a new season). Team win/loss/
    form state and park factors reset each season (standings genuinely do
    reset); Elo does not. `seasons` must already be sorted ascending.

    Memoized by the exact seasons tuple — see _training_set_cache's own
    comment above for why this is safe and why it was added."""
    cache_key = tuple(seasons)
    cached = _training_set_cache.get(cache_key)
    if cached is not None:
        return cached
    result = await _build_training_set_uncached(client, seasons)
    _training_set_cache[cache_key] = result
    return result


async def _build_training_set_uncached(client: httpx.AsyncClient, seasons: list[int]) -> TrainingSetResult:
    rows: list[TrainingRow] = []
    total_rows: list[TrainingRow] = []
    elo_rating: dict[int, float] = {}
    elo_games: dict[int, int] = {}
    elo_last_season: dict[int, int] = {}
    market_coverage = MarketCoverage()
    total_market_coverage = MarketCoverage()
    total_line_coverage = LineCoverage()
    line_movement_coverage = MarketCoverage()
    bullpen_coverage = MarketCoverage()

    # One fetch per (team, season) no matter how many of that team's games
    # get walked.
    bullpen_era_cache: dict[tuple[int, int], float | None] = {}

    async def bullpen_era_for(team_id: int, season: int) -> float | None:
        key = (team_id, season)
        if key in bullpen_era_cache:
            return bullpen_era_cache[key]
        era = await statsapi.get_team_bullpen_era(client, team_id, season)
        bullpen_era_cache[key] = era
        return era

    # Same one-fetch-per-(team,season) shape as bullpen_era_for, for the
    # team-level batting/pitching vectors simulate_team_matchup needs.
    league_rates_cache: dict[int, dict] = {}

    async def league_rates_for(season: int) -> dict:
        cached = league_rates_cache.get(season)
        if cached is not None:
            return cached
        result = await compute_league_outcome_rates(client, season)
        league_rates_cache[season] = result.vector
        return result.vector

    team_vector_cache: dict[tuple[int, int], tuple[dict, dict]] = {}

    async def team_vectors_for(team_id: int, season: int) -> tuple[dict, dict]:
        key = (team_id, season)
        cached = team_vector_cache.get(key)
        if cached is not None:
            return cached
        league_rates = await league_rates_for(season)
        batting = await compute_team_batting_vector(client, team_id, season, league_rates)
        pitching = await compute_team_pitching_vector(client, team_id, season, league_rates)
        team_vector_cache[key] = (batting, pitching)
        return batting, pitching

    current_season = int(statsapi.eastern_date()[:4])

    for season in seasons:
        range_end = statsapi.eastern_date() if season >= current_season else f"{season}-11-30"
        games = await statsapi.get_schedule_range(client, f"{season}-03-01", range_end)
        finals = sorted(
            (g for g in games if g.abstract_state == "Final" and (g.teams.get("home") or {}).get("score") is not None and (g.teams.get("away") or {}).get("score") is not None),
            key=lambda g: g.game_date,
        )

        park_factor_by_venue = {r.venue_id: r.factor for r in await db.read_park_factors(season)}
        team_state: dict[int, TeamState] = {}  # reset per season — standings reset

        for g in finals:
            home_id = g.teams["home"]["team"]["id"]
            away_id = g.teams["away"]["team"]["id"]
            home_runs = g.teams["home"]["score"]
            away_runs = g.teams["away"]["score"]
            home = team_state.get(home_id)
            away = team_state.get(away_id)

            for team_id in (home_id, away_id):
                last_season = elo_last_season.get(team_id)
                if last_season is not None and last_season != season:
                    elo_rating[team_id] = elo_model.regress_to_mean(elo_rating.get(team_id, elo_model.STARTING_ELO))
                elo_last_season[team_id] = season

            home_elo = elo_rating.get(home_id, elo_model.STARTING_ELO)
            away_elo = elo_rating.get(away_id, elo_model.STARTING_ELO)
            home_elo_games = elo_games.get(home_id, 0)
            away_elo_games = elo_games.get(away_id, 0)
            home_won = 1 if home_runs > away_runs else 0

            if home is not None and away is not None and home.games >= WARMUP_GAMES and away.games >= WARMUP_GAMES:
                h_rs = home.runs_for / home.games
                h_ra = home.runs_against / home.games
                a_rs = away.runs_for / away.games
                a_ra = away.runs_against / away.games
                raw_log5 = log5(pythagorean_win_pct(h_rs, h_ra), pythagorean_win_pct(a_rs, a_ra))

                home_venue_edge = split_edge(home.season, home.home, MIN_SPLIT_SAMPLE, MAX_SPLIT_EDGE)
                away_venue_edge = split_edge(away.season, away.away, MIN_SPLIT_SAMPLE, MAX_SPLIT_EDGE)
                home_form_edge = split_edge(home.season, _last10(home.recent_results), MIN_RECENT_SAMPLE, MAX_RECENT_EDGE)
                away_form_edge = split_edge(away.season, _last10(away.recent_results), MIN_RECENT_SAMPLE, MAX_RECENT_EDGE)

                venue_diff = home_venue_edge - away_venue_edge
                formDiff = home_form_edge - away_form_edge  # raw, unweighted — the regression decides the weight

                venue = g.venue or {}
                pf = park_factor_by_venue.get(venue.get("id"), 1.0) if venue.get("id") is not None else 1.0

                # One team-matchup simulation per game yields both
                # simWinProb (moneyline) and expectedTotal (total)
                # together, so it only needs to run once here.
                home_batting, home_pitching = await team_vectors_for(home_id, season)
                away_batting, away_pitching = await team_vectors_for(away_id, season)
                league_rates_for_season = await league_rates_for(season)
                sim_result = simulate_team_matchup(home_batting, home_pitching, away_batting, away_pitching, league_rates_for_season, pf, SIM_TRAINING_N)

                elo_prob = elo_model.elo_expected_home_win_prob(home_elo, away_elo) if home_elo_games >= elo_model.MIN_GAMES_FOR_ELO_TRUST and away_elo_games >= elo_model.MIN_GAMES_FOR_ELO_TRUST else 0.5

                game_date_eastern = statsapi.eastern_date(_parse_game_date(g.game_date))
                odds = await db.get_historical_odds(season, game_date_eastern, home_id, away_id)
                market_prob_centered = 0.0
                if odds is not None and odds.ml_home_consensus_prob is not None:
                    market_prob_centered = odds.ml_home_consensus_prob - 0.5
                    market_coverage.found += 1
                else:
                    market_coverage.missing += 1

                # The current hand-coded formula, same inputs, for a fair holdout comparison.
                baseline_adj = HOME_FIELD_EDGE + venue_diff + home_form_edge * RECENT_FORM_WEIGHT - away_form_edge * RECENT_FORM_WEIGHT
                baseline_prob = min(0.97, max(0.03, raw_log5 + baseline_adj))

                rows.append(
                    TrainingRow(
                        features=[raw_log5, venue_diff, formDiff, pf - 1, elo_prob, market_prob_centered, sim_result.home_win_prob],
                        actual=home_won,
                        date=game_date_eastern,
                        season=season,
                        baseline_prob=baseline_prob,
                    )
                )

                # Total (O/U) row — unlike moneyline, the training LABEL
                # itself needs a real historical total line, not just a
                # feature, so games with no ingested line, or an exact
                # push, simply can't produce a gradeable row here.
                actual_total = home_runs + away_runs
                if odds is not None and odds.total_line is not None and actual_total != odds.total_line:
                    total_line_coverage.found += 1
                    expected_total_raw = (h_rs + a_rs) * pf
                    raw_poisson_over_prob = poisson_over_probability(expected_total_raw, odds.total_line)
                    total_market_prob_centered = 0.0
                    if odds.total_over_consensus_prob is not None:
                        total_market_prob_centered = odds.total_over_consensus_prob - 0.5
                        total_market_coverage.found += 1
                    else:
                        total_market_coverage.missing += 1

                    line_movement = 0.0
                    if odds.total_open_line is not None:
                        line_movement = odds.total_line - odds.total_open_line
                        line_movement_coverage.found += 1
                    else:
                        line_movement_coverage.missing += 1

                    home_bullpen_era, away_bullpen_era = await bullpen_era_for(home_id, season), await bullpen_era_for(away_id, season)
                    bullpen_era_centered = (home_bullpen_era if home_bullpen_era is not None else NEUTRAL_BULLPEN_ERA) / 2 + (away_bullpen_era if away_bullpen_era is not None else NEUTRAL_BULLPEN_ERA) / 2 - NEUTRAL_BULLPEN_ERA
                    if home_bullpen_era is not None and away_bullpen_era is not None:
                        bullpen_coverage.found += 1
                    else:
                        bullpen_coverage.missing += 1

                    sim_over_prob = poisson_over_probability(sim_result.expected_total, odds.total_line)

                    total_rows.append(
                        TrainingRow(
                            features=[raw_poisson_over_prob, formDiff, pf - 1, elo_prob, total_market_prob_centered, line_movement, bullpen_era_centered, sim_over_prob],
                            actual=1 if actual_total > odds.total_line else 0,
                            date=game_date_eastern,
                            season=season,
                            baseline_prob=raw_poisson_over_prob,
                        )
                    )
                else:
                    total_line_coverage.missing_or_push += 1

            # Update every accumulator AFTER building this game's row — no lookahead.
            home_state = home if home is not None else TeamState()
            home_state.runs_for += home_runs
            home_state.runs_against += away_runs
            home_state.games += 1
            if home_won:
                home_state.season.wins += 1
                home_state.home.wins += 1
            else:
                home_state.season.losses += 1
                home_state.home.losses += 1
            home_state.recent_results.append(home_won)
            team_state[home_id] = home_state

            away_state = away if away is not None else TeamState()
            away_state.runs_for += away_runs
            away_state.runs_against += home_runs
            away_state.games += 1
            if not home_won:
                away_state.season.wins += 1
                away_state.away.wins += 1
            else:
                away_state.season.losses += 1
                away_state.away.losses += 1
            away_state.recent_results.append(0 if home_won else 1)
            team_state[away_id] = away_state

            elo_result = elo_model.update_elo(home_elo, away_elo, home_runs, away_runs)
            elo_rating[home_id] = elo_result.new_home_elo
            elo_rating[away_id] = elo_result.new_away_elo
            elo_games[home_id] = home_elo_games + 1
            elo_games[away_id] = away_elo_games + 1

    return TrainingSetResult(
        moneyline_rows=rows,
        market_coverage=market_coverage,
        total_rows=total_rows,
        total_market_coverage=total_market_coverage,
        total_line_coverage=total_line_coverage,
        line_movement_coverage=line_movement_coverage,
        bullpen_coverage=bullpen_coverage,
    )


@dataclass
class MoneylineFitSummary:
    train_seasons: list[int]
    holdout_seasons: list[int]
    train_games: int
    holdout_games: int
    train_brier: float
    holdout_brier: float
    baseline_holdout_brier: float
    market_coverage: MarketCoverage
    activated: bool
    feature_names: tuple[str, ...]
    weights: list[float]
    intercept: float
    saved_row: db.ModelWeightsRow


async def fit_moneyline_weights(client: httpx.AsyncClient, train_seasons: list[int], holdout_seasons: list[int]) -> MoneylineFitSummary:
    """`holdout_seasons` are held out entirely — never touch the fit, only
    score it — and the guardrail below (activate only if the fit beats the
    hand-coded baseline on that same held-out slice) is what decides
    whether the result actually goes live."""
    all_seasons = sorted({*train_seasons, *holdout_seasons})
    result = await build_training_set(client, all_seasons)
    rows = result.moneyline_rows

    holdout_set = set(holdout_seasons)
    train_rows = [r for r in rows if r.season not in holdout_set]
    holdout_rows = [r for r in rows if r.season in holdout_set]

    x = [r.features for r in train_rows]
    y = [float(r.actual) for r in train_rows]
    fit = fit_logistic_regression(x, y)

    from predict.logistic_regression import PredictionRecord

    train_preds = [PredictionRecord(predict_prob(r.features, fit.weights, fit.intercept), r.actual) for r in train_rows]
    holdout_preds = [PredictionRecord(predict_prob(r.features, fit.weights, fit.intercept), r.actual) for r in holdout_rows]
    holdout_baseline = [PredictionRecord(r.baseline_prob, r.actual) for r in holdout_rows]

    train_brier = brier_score(train_preds)
    holdout_brier = brier_score(holdout_preds)
    baseline_holdout_brier = brier_score(holdout_baseline)

    # The guardrail: a new fit only ever goes live if it actually beats the
    # currently-active formula on data it never trained on.
    activated = holdout_brier < baseline_holdout_brier

    saved_row = await db.write_model_weights(
        db.ModelWeightsInput(
            sport="mlb",
            market="moneyline",
            feature_names=list(MONEYLINE_FEATURE_NAMES),
            weights=fit.weights,
            intercept=fit.intercept,
            train_games=len(train_rows),
            train_brier=train_brier,
            holdout_games=len(holdout_rows),
            holdout_brier=holdout_brier,
            baseline_holdout_brier=baseline_holdout_brier,
            covariance=fit.covariance,
            train_seasons=train_seasons,
            holdout_seasons=holdout_seasons,
        ),
        activated,
    )

    return MoneylineFitSummary(
        train_seasons=train_seasons,
        holdout_seasons=holdout_seasons,
        train_games=len(train_rows),
        holdout_games=len(holdout_rows),
        train_brier=train_brier,
        holdout_brier=holdout_brier,
        baseline_holdout_brier=baseline_holdout_brier,
        market_coverage=result.market_coverage,
        activated=activated,
        feature_names=MONEYLINE_FEATURE_NAMES,
        weights=fit.weights,
        intercept=fit.intercept,
        saved_row=saved_row,
    )


@dataclass
class TotalFitSummary:
    train_seasons: list[int]
    holdout_seasons: list[int]
    train_games: int
    holdout_games: int
    train_brier: float
    holdout_brier: float
    baseline_holdout_brier: float
    market_coverage: MarketCoverage
    line_coverage: LineCoverage
    line_movement_coverage: MarketCoverage
    bullpen_coverage: MarketCoverage
    activated: bool
    feature_names: tuple[str, ...]
    weights: list[float]
    intercept: float
    saved_row: db.ModelWeightsRow


async def fit_total_weights(client: httpx.AsyncClient, train_seasons: list[int], holdout_seasons: list[int]) -> TotalFitSummary:
    """Total-market counterpart to fit_moneyline_weights — same walk-
    forward, same holdout-only guardrail, but the baseline it has to beat
    is the raw Poisson formula's own output. Requires historical_odds to
    actually have total-line coverage for the requested seasons — raises a
    clear error rather than fitting garbage from zero rows if it doesn't."""
    all_seasons = sorted({*train_seasons, *holdout_seasons})
    result = await build_training_set(client, all_seasons)
    rows = result.total_rows

    holdout_set = set(holdout_seasons)
    train_rows = [r for r in rows if r.season not in holdout_set]
    holdout_rows = [r for r in rows if r.season in holdout_set]

    if not train_rows or not holdout_rows:
        raise ValueError(
            f"No historical total-line data for the requested seasons (train={len(train_rows)} rows, holdout={len(holdout_rows)} rows) — "
            "run historical odds ingestion first (see lib/sports/mlb/historicalOddsIngest.ts)."
        )

    x = [r.features for r in train_rows]
    y = [float(r.actual) for r in train_rows]
    fit = fit_logistic_regression(x, y)

    from predict.logistic_regression import PredictionRecord

    train_preds = [PredictionRecord(predict_prob(r.features, fit.weights, fit.intercept), r.actual) for r in train_rows]
    holdout_preds = [PredictionRecord(predict_prob(r.features, fit.weights, fit.intercept), r.actual) for r in holdout_rows]
    holdout_baseline = [PredictionRecord(r.baseline_prob, r.actual) for r in holdout_rows]

    train_brier = brier_score(train_preds)
    holdout_brier = brier_score(holdout_preds)
    baseline_holdout_brier = brier_score(holdout_baseline)

    activated = holdout_brier < baseline_holdout_brier

    saved_row = await db.write_model_weights(
        db.ModelWeightsInput(
            sport="mlb",
            market="total",
            feature_names=list(TOTAL_FEATURE_NAMES),
            weights=fit.weights,
            intercept=fit.intercept,
            train_games=len(train_rows),
            train_brier=train_brier,
            holdout_games=len(holdout_rows),
            holdout_brier=holdout_brier,
            baseline_holdout_brier=baseline_holdout_brier,
            covariance=fit.covariance,
            train_seasons=train_seasons,
            holdout_seasons=holdout_seasons,
        ),
        activated,
    )

    return TotalFitSummary(
        train_seasons=train_seasons,
        holdout_seasons=holdout_seasons,
        train_games=len(train_rows),
        holdout_games=len(holdout_rows),
        train_brier=train_brier,
        holdout_brier=holdout_brier,
        baseline_holdout_brier=baseline_holdout_brier,
        market_coverage=result.total_market_coverage,
        line_coverage=result.total_line_coverage,
        line_movement_coverage=result.line_movement_coverage,
        bullpen_coverage=result.bullpen_coverage,
        activated=activated,
        feature_names=TOTAL_FEATURE_NAMES,
        weights=fit.weights,
        intercept=fit.intercept,
        saved_row=saved_row,
    )
