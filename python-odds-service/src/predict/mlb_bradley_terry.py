"""MLB's classical-baseline candidate for the model ensemble — a properly-
fit Bradley-Terry paired-comparison model (per-team strength ratings + a
shared home-advantage scalar, fit via maximum likelihood across every
game in the training window jointly). This is MLB's analog to Dixon-Coles
being the classical academic baseline in the reference system audited
this session — Dixon-Coles itself is a football-specific Poisson goal-
scoring model and doesn't transfer to baseball's win/loss structure, so
this is a different model, not a port.

Genuinely new algorithmic work, not a reuse of logistic_regression.py's
fixed-feature-vector fitter: Elo (elo_model.py) is a sequential, single-
game-update APPROXIMATION of the same underlying idea; this fits every
game in the training window jointly via a real MLE objective, the same
iterative-gradient-descent SHAPE as fit_logistic_regression but with one
parameter per team instead of one weight per feature.
"""
import math
from dataclasses import dataclass

import httpx

from predict import statsapi
from predict.walkforward import FitOutput


def _sigmoid(z: float) -> float:
    if z > 35:
        return 1.0
    if z < -35:
        return 0.0
    return 1 / (1 + math.exp(-z))


@dataclass
class BTGameRow:
    home_team_id: int
    away_team_id: int
    home_won: int
    game_date: str
    season: int


@dataclass
class BradleyTerryParams:
    team_ratings: dict[int, float]
    home_advantage: float


async def build_bradley_terry_training_set(client: httpx.AsyncClient, seasons: list[int]) -> list[BTGameRow]:
    """Reuses statsapi.get_schedule_range exactly like model_fit.py's own
    season walk (same Final-games-with-real-scores filter, same
    range_end-caps-at-today-for-the-current-season logic), but needs none
    of build_training_set's team-state/Elo/sim machinery — just
    (home_id, away_id, home_won, date, season) per finished game, sorted
    chronologically across the full seasons list."""
    rows: list[BTGameRow] = []
    current_season = int(statsapi.eastern_date()[:4])

    for season in seasons:
        range_end = statsapi.eastern_date() if season >= current_season else f"{season}-11-30"
        games = await statsapi.get_schedule_range(client, f"{season}-03-01", range_end)
        finals = sorted(
            (g for g in games if g.abstract_state == "Final" and (g.teams.get("home") or {}).get("score") is not None and (g.teams.get("away") or {}).get("score") is not None),
            key=lambda g: g.game_date,
        )
        for g in finals:
            home_id = g.teams["home"]["team"]["id"]
            away_id = g.teams["away"]["team"]["id"]
            home_score = g.teams["home"]["score"]
            away_score = g.teams["away"]["score"]
            if home_score == away_score:
                continue  # MLB games don't end in ties, but guard anyway rather than silently mislabel a data anomaly as a home win
            rows.append(
                BTGameRow(
                    home_team_id=home_id,
                    away_team_id=away_id,
                    home_won=1 if home_score > away_score else 0,
                    game_date=g.game_date,
                    season=season,
                )
            )

    return rows


def fit_bradley_terry(
    games: list[BTGameRow],
    iterations: int = 2000,
    learning_rate: float = 0.05,
    l2: float = 0.001,
    decay_half_life_games: float = 400.0,
) -> BradleyTerryParams:
    """MLE via batch gradient descent, same iterative-refinement shape as
    logistic_regression.fit_logistic_regression (accumulate gradients over
    every training row, apply an L2-regularized update, repeat). games
    must already be chronologically sorted (build_bradley_terry_training_set
    guarantees this) — recency decay is applied by RANK in that order, not
    calendar time, matching this module's own stated design: the most
    recent game gets weight 1.0, and each game `decay_half_life_games`
    games further back gets half that weight. L2 shrinks ratings toward 0
    (replacement level) rather than requiring an explicit sum-to-zero
    identifiability constraint — the standard ridge-regularization fix for
    Bradley-Terry's otherwise-unidentified overall rating scale."""
    if len(games) == 0:
        raise ValueError("fit_bradley_terry: at least one game is required")

    team_ids = sorted({g.home_team_id for g in games} | {g.away_team_id for g in games})
    ratings: dict[int, float] = {t: 0.0 for t in team_ids}
    home_advantage = 0.0

    n = len(games)
    ln2 = math.log(2)
    weights = [math.exp(-ln2 / decay_half_life_games * (n - 1 - i)) for i in range(n)]

    for _ in range(iterations):
        grad_ratings: dict[int, float] = {t: 0.0 for t in team_ids}
        grad_home_advantage = 0.0
        for i, g in enumerate(games):
            z = ratings[g.home_team_id] - ratings[g.away_team_id] + home_advantage
            pred = _sigmoid(z)
            error = pred - g.home_won
            w = weights[i]
            grad_ratings[g.home_team_id] += w * error
            grad_ratings[g.away_team_id] -= w * error
            grad_home_advantage += w * error

        for t in team_ids:
            ratings[t] -= learning_rate * (grad_ratings[t] / n + l2 * ratings[t])
        home_advantage -= learning_rate * (grad_home_advantage / n)

    return BradleyTerryParams(team_ratings=ratings, home_advantage=home_advantage)


def bt_win_prob(rating_home: float, rating_away: float, home_advantage: float) -> float:
    return _sigmoid(rating_home - rating_away + home_advantage)


async def bt_fit_fn(client: httpx.AsyncClient, train_seasons: list[int]) -> FitOutput[BradleyTerryParams]:
    """Adapter to walkforward.py's FitOutput shape — a thin wrapper so
    mlb_model_candidates.py can register this as a ModelCandidate without
    build_bradley_terry_training_set/fit_bradley_terry needing to know
    about the harness at all."""
    games = await build_bradley_terry_training_set(client, train_seasons)
    params = fit_bradley_terry(games)
    return FitOutput(model=params, train_games=len(games))


async def bt_score_fn(client: httpx.AsyncClient, model: BradleyTerryParams, val_season: int) -> list:
    """Scores a frozen, already-fitted BradleyTerryParams against one
    validation season's real games — ratings are NOT updated during
    scoring (no lookahead: the fitted ratings from train_seasons are
    applied as-is to games the model never trained on). A team with no
    rating in `model.team_ratings` (expansion/relocation edge case, not
    expected in MLB's stable 30-team era but guarded anyway) defaults to
    0.0 — replacement level, the same value every rating starts from."""
    from predict.logistic_regression import PredictionRecord

    games = await build_bradley_terry_training_set(client, [val_season])
    predictions = []
    for g in games:
        r_home = model.team_ratings.get(g.home_team_id, 0.0)
        r_away = model.team_ratings.get(g.away_team_id, 0.0)
        prob = bt_win_prob(r_home, r_away, model.home_advantage)
        predictions.append(PredictionRecord(prob=prob, actual=g.home_won))
    return predictions
