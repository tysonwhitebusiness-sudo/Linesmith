"""Direct port of lib/sports/mlb/homeRunModelFit.ts — not a
reimplementation. Historical training-row builder + walk-forward fit,
mirroring model_fit.py's shape (build_training_set -> fit_*_weights) but
for the `home-run` market instead of moneyline/total.

Unlike model_fit.py's team-level rows, this walks individual BATTER game
logs — one row per (batter, real past game), features + whether that
batter hit >=1 HR that game. All data comes from statsapi.py functions
already used elsewhere — no new endpoints.

Two disclosed simplifications, both the same "train broad(er), predict
specific" shape model_fit.py already accepts for raw_log5 (team-only in
training vs. starter-blended live) and get_team_bullpen_era
(season-total, not point-in-time):

1. League HR rate and each opponent's HR-rate-allowed are season
   aggregates, not walked point-in-time across the season. A true
   as-of-this-date rate would need every qualified batter's ENTIRE game
   log pre-sorted into one global date-ordered stream — a real v2
   upgrade, not required to validate whether these features carry signal
   at all.
2. The opponent (pitcher-matchup) signal here is team-level — rate of
   batter-games where a batter went deep against this team's pitching
   staff — not the specific starting pitcher faced that day. Live
   prediction (predict/prop_candidates.py's home-run blend) CAN use the
   actual probable starter's own rate live, since that's known live —
   same definitional gap already disclosed for starter ERA blending.
"""
from dataclasses import dataclass, field

import httpx

import db
from predict import statsapi
from predict.edge_model import ModelProbabilityInput, compute_model_probability
from predict.home_run_model import (
    HOME_RUN_FEATURE_NAMES,
    NEUTRAL_EXPECTED_PA,
    expected_pa_centered_from_trailing_average,
    park_hr_factor_centered,
    pitcher_matchup_signal,
)
from predict.logistic_regression import PredictionRecord, brier_score, fit_logistic_regression, predict_prob


def _num(v) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return f if f == f else 0.0


@dataclass
class HomeRunTrainingRow:
    """Same shape as model_fit.py's TrainingRow — features already in
    HOME_RUN_FEATURE_NAMES order, plus what's needed for the walk-forward
    split and holdout comparison."""

    features: list[float]
    actual: int
    date: str
    season: int
    # The current live baseline's own prediction (beta_binomial_hr_prob
    # alone) on this row — what the fitted model has to beat on holdout.
    baseline_prob: float
    batter_id: int


async def _build_game_pk_venue_map(client: httpx.AsyncClient, season: int) -> dict[int, int]:
    """gamePk -> venueId for one season, built from the same schedule
    endpoint model_fit.py already uses for this exact purpose."""
    games = await statsapi.get_schedule_range(client, f"{season}-03-01", f"{season}-11-30")
    out: dict[int, int] = {}
    for g in games:
        venue = g.venue or {}
        if venue.get("id") is not None:
            out[g.game_pk] = venue["id"]
    return out


@dataclass
class LeagueAndTeamHrRates:
    league_hr_rate: float
    # team_id -> games faced / games with an opponent HR, both real counts
    # (not just the rate) so a caller can see sample size before trusting
    # a thin one.
    team_games_faced: dict[int, int] = field(default_factory=dict)
    team_games_with_hr_allowed: dict[int, int] = field(default_factory=dict)

    def team_hr_rate_allowed(self, team_id: int | None) -> float:
        if team_id is None:
            return self.league_hr_rate
        faced = self.team_games_faced.get(team_id, 0)
        if faced < 10:  # thin sample against one team this season — neutral rather than noisy
            return self.league_hr_rate
        return self.team_games_with_hr_allowed.get(team_id, 0) / faced


def aggregate_league_and_team_hr_rates(logs_by_id: dict[int, statsapi.PersonStats]) -> LeagueAndTeamHrRates:
    """Season-aggregate league HR rate and each team's opponent-batter-
    games HR rate — pure aggregation over already-fetched game logs,
    pulled out as its own function so the training builder below and the
    LIVE lookup (home_run_live_matchup.py) share identical math on their
    own independently-fetched log pools."""
    league_games = 0
    league_games_with_hr = 0
    team_games_faced: dict[int, int] = {}
    team_games_with_hr_allowed: dict[int, int] = {}

    for person in logs_by_id.values():
        for g in person.game_log:
            pa = _num((g.stat or {}).get("plateAppearances"))
            if pa <= 0:
                continue  # no real plate appearance this game — nothing to grade
            had_hr = 1 if _num((g.stat or {}).get("homeRuns")) >= 1 else 0
            league_games += 1
            league_games_with_hr += had_hr
            if g.opponent_id is not None:
                team_games_faced[g.opponent_id] = team_games_faced.get(g.opponent_id, 0) + 1
                if had_hr:
                    team_games_with_hr_allowed[g.opponent_id] = team_games_with_hr_allowed.get(g.opponent_id, 0) + 1

    # Fallback matches home_run_model.py's own neutral-rate spirit — only
    # hit if a season somehow returns zero usable rows.
    league_hr_rate = league_games_with_hr / league_games if league_games > 0 else 0.11
    return LeagueAndTeamHrRates(league_hr_rate=league_hr_rate, team_games_faced=team_games_faced, team_games_with_hr_allowed=team_games_with_hr_allowed)


async def compute_league_and_team_hr_rates(client: httpx.AsyncClient, season: int) -> LeagueAndTeamHrRates:
    """Fetches the current qualified-batter pool and their game logs, then
    aggregates — the standalone entry point for anything that just wants
    this season's rates without also needing full per-batter training
    rows (see home_run_live_matchup.py)."""
    batter_pool = await statsapi.get_league_batter_season_rows(client, season)
    batter_ids = [b.person_id for b in batter_pool]
    logs_by_id = await statsapi.get_people_with_game_logs(client, batter_ids, "hitting", season)
    return aggregate_league_and_team_hr_rates(logs_by_id)


async def build_home_run_season_rows(client: httpx.AsyncClient, season: int) -> list[HomeRunTrainingRow]:
    """Builds one season's training rows. Pass 1 (aggregate_league_and_
    team_hr_rates) computes season-aggregate league/opponent HR rates (the
    disclosed simplification above), pass 2 walks each batter
    chronologically, using ONLY that batter's own prior games for their
    personal Beta-Binomial baseline and trailing-PA figure — the actual
    no-lookahead discipline this needs, even though the league/opponent
    rates it's blended against are season-constant."""
    batter_pool = await statsapi.get_league_batter_season_rows(client, season)
    batter_ids = [b.person_id for b in batter_pool]
    logs_by_id = await statsapi.get_people_with_game_logs(client, batter_ids, "hitting", season)
    venue_by_game = await _build_game_pk_venue_map(client, season)
    park_factor_by_venue = {r.venue_id: r.factor for r in await db.read_park_factors(season)}

    # Pass 1 — same season-aggregate rates the live lookup will later
    # share, computed here from the batter logs this call already fetched
    # for pass 2 rather than re-fetching them a second time.
    rates = aggregate_league_and_team_hr_rates(logs_by_id)
    league_hr_rate = rates.league_hr_rate

    # Pass 2 — per-batter chronological walk, no lookahead on the batter's own state.
    rows: list[HomeRunTrainingRow] = []
    for batter_id, person in logs_by_id.items():
        sorted_log = sorted(person.game_log, key=lambda s: s.date or "")
        prior_games = 0
        prior_games_with_hr = 0
        prior_total_pa = 0.0

        for g in sorted_log:
            pa = _num((g.stat or {}).get("plateAppearances"))
            if pa <= 0:
                continue
            had_hr = 1 if _num((g.stat or {}).get("homeRuns")) >= 1 else 0

            baseline = compute_model_probability(
                ModelProbabilityInput(
                    dimension="home-runs",
                    league_rate=league_hr_rate,
                    over_count=prior_games_with_hr,
                    total_count=prior_games,
                    matchup_favorable=None,  # no historical barrelPct replication here — disclosed, see module header
                )
            )

            venue_id = venue_by_game.get(g.game_pk) if g.game_pk is not None else None
            park_factor = park_factor_by_venue.get(venue_id, 1.0) if venue_id is not None else 1.0
            trailing_avg_pa = prior_total_pa / prior_games if prior_games > 0 else NEUTRAL_EXPECTED_PA

            features = [
                baseline.prob,
                park_hr_factor_centered(park_factor),
                pitcher_matchup_signal(rates.team_hr_rate_allowed(g.opponent_id), league_hr_rate),
                expected_pa_centered_from_trailing_average(trailing_avg_pa),
            ]

            rows.append(
                HomeRunTrainingRow(
                    features=features,
                    actual=had_hr,
                    date=g.date or "",
                    season=season,
                    baseline_prob=baseline.prob,
                    batter_id=batter_id,
                )
            )

            prior_games += 1
            prior_games_with_hr += had_hr
            prior_total_pa += pa

    return rows


async def build_home_run_training_set(client: httpx.AsyncClient, seasons: list[int]) -> list[HomeRunTrainingRow]:
    """Multi-season convenience wrapper — sequential (not concurrent) so a
    rate-limited/slow season doesn't pile up concurrent multi-hundred-
    batter pulls against MLB's API at once."""
    all_rows: list[HomeRunTrainingRow] = []
    for season in seasons:
        all_rows.extend(await build_home_run_season_rows(client, season))
    return all_rows


@dataclass
class HomeRunFitSummary:
    train_seasons: list[int]
    holdout_seasons: list[int]
    train_rows: int
    holdout_rows: int
    train_brier: float
    holdout_brier: float
    baseline_holdout_brier: float
    activated: bool
    feature_names: tuple[str, ...]
    weights: list[float]
    intercept: float
    saved_row: db.ModelWeightsRow


async def fit_home_run_weights(client: httpx.AsyncClient, train_seasons: list[int], holdout_seasons: list[int]) -> HomeRunFitSummary:
    """Same shape as model_fit.py's fit_moneyline_weights: fit on
    train_seasons, score on holdout_seasons the fit never touched,
    activate only if the fit's holdout Brier beats the existing
    Beta-Binomial baseline's own holdout Brier."""
    all_seasons = sorted({*train_seasons, *holdout_seasons})
    rows: list[HomeRunTrainingRow] = []
    for season in all_seasons:
        rows.extend(await build_home_run_season_rows(client, season))

    holdout_set = set(holdout_seasons)
    train_rows = [r for r in rows if r.season not in holdout_set]
    holdout_rows = [r for r in rows if r.season in holdout_set]

    if not train_rows or not holdout_rows:
        raise ValueError(f"No home-run training data for the requested seasons (train={len(train_rows)} rows, holdout={len(holdout_rows)} rows).")

    x = [r.features for r in train_rows]
    y = [float(r.actual) for r in train_rows]
    fit = fit_logistic_regression(x, y)

    train_preds = [PredictionRecord(predict_prob(r.features, fit.weights, fit.intercept), r.actual) for r in train_rows]
    holdout_preds = [PredictionRecord(predict_prob(r.features, fit.weights, fit.intercept), r.actual) for r in holdout_rows]
    holdout_baseline = [PredictionRecord(r.baseline_prob, r.actual) for r in holdout_rows]

    train_brier = brier_score(train_preds)
    holdout_brier = brier_score(holdout_preds)
    baseline_holdout_brier = brier_score(holdout_baseline)

    # The guardrail: only activates if it beats the current live
    # Beta-Binomial baseline on seasons it never trained on.
    activated = holdout_brier < baseline_holdout_brier

    saved_row = await db.write_model_weights(
        db.ModelWeightsInput(
            sport="mlb",
            market="home-run",
            feature_names=list(HOME_RUN_FEATURE_NAMES),
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

    return HomeRunFitSummary(
        train_seasons=train_seasons,
        holdout_seasons=holdout_seasons,
        train_rows=len(train_rows),
        holdout_rows=len(holdout_rows),
        train_brier=train_brier,
        holdout_brier=holdout_brier,
        baseline_holdout_brier=baseline_holdout_brier,
        activated=activated,
        feature_names=HOME_RUN_FEATURE_NAMES,
        weights=fit.weights,
        intercept=fit.intercept,
        saved_row=saved_row,
    )


def current_season() -> int:
    return int(statsapi.eastern_date()[:4])
