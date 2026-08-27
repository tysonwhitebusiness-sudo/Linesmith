"""Generic, sport-parameterized Elo rating + prediction — the baseline
moneyline model for every team sport that doesn't yet have a dedicated,
fitted model the way MLB does (predict/elo_model.py's own 4-model
ensemble, or golf's). Explicit, deliberate scope decision (2026-08-27,
user's own call after being shown the tradeoffs): ship something real in
the app now for every sport rather than wait for a validated,
per-sport-tuned build the way MLB got — this is a real, working baseline,
NOT a port of MLB's full sophistication (no starting-pitcher-equivalent
adjustment, no rest/travel — those are real refinements for later, not
required for a baseline to be honest and functional).

Reuses the same core Elo math elo_model.py already proved out for MLB
(logistic expected-score formula, log-scaled margin-of-victory multiplier
dampened by how big a favorite the winner already was, season-boundary
regression toward the mean) — that math has no baseball-specific content
at all, confirmed by reading it before writing this rather than assumed.

Real, disclosed limitation carried from the same 2026-08-27 decision:
this has NOT been CLV-validated for any sport yet, MLB included (see
docs/mlb-market-centric-model-gameplan-2026-08-27.md) — a real, working
baseline, not a proven edge. K-factor and home-advantage values below are
reasonable, standard sports-Elo starting points (same order of magnitude
publicly-documented Elo implementations use per sport), explicitly NOT
fit against this app's own real outcomes yet — same "hand-set placeholder,
not yet fit" honesty predict/probability_blend.py already discloses for
its own weights. Real per-sport fitting is real future work, not done here.
"""
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

import db
from .odds_math import american_to_decimal, devig_two_way, is_plausible_decimal_odds
from .probability_blend import MARKET_BLEND_WEIGHT, blend_probability

ELO_SCALE = 400
STARTING_ELO = 1500
SEASON_REGRESSION_FACTOR = 1 / 3
MIN_GAMES_FOR_ELO_TRUST = 10

_ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports"


@dataclass
class SportEloConfig:
    sport_key: str  # team_elo_history.sport value
    espn_sport: str  # ESPN's URL path segment, e.g. 'football'
    espn_league: str  # ESPN's URL path segment, e.g. 'nfl'
    k_factor: float
    home_bonus: float
    allow_draw: bool  # soccer only — a tied final score is a real result, not a data gap


# Reasonable, standard sports-Elo starting points — NOT precisely sourced
# citations the way MLB's HOME_ELO_BONUS=24 is (that one matches
# FiveThirtyEight's own published value exactly, disclosed as such in
# elo_model.py). These are round-number, order-of-magnitude-correct
# defaults: NBA's home-court edge is well-documented as the strongest of
# the major team sports, NHL/soccer more modest, CFB's home-crowd effect
# larger than the NFL's. K=20 is a common, conservative starting value
# used broadly across public sports-Elo implementations. Real fitting
# against this app's own graded outcomes is the honest next step, not
# done here — see this module's own docstring.
SPORT_CONFIGS: dict[str, SportEloConfig] = {
    "nfl": SportEloConfig("nfl", "football", "nfl", k_factor=20, home_bonus=48, allow_draw=False),
    "cfb": SportEloConfig("cfb", "football", "college-football", k_factor=20, home_bonus=65, allow_draw=False),
    "nba": SportEloConfig("nba", "basketball", "nba", k_factor=20, home_bonus=100, allow_draw=False),
    "nhl": SportEloConfig("nhl", "hockey", "nhl", k_factor=6, home_bonus=35, allow_draw=False),
    "soccer_epl": SportEloConfig("soccer_epl", "soccer", "eng.1", k_factor=20, home_bonus=60, allow_draw=True),
    "soccer_mls": SportEloConfig("soccer_mls", "soccer", "usa.1", k_factor=20, home_bonus=60, allow_draw=True),
}


def regress_to_mean(prior_rating: float, factor: float = SEASON_REGRESSION_FACTOR) -> float:
    return STARTING_ELO + factor * (prior_rating - STARTING_ELO)


def elo_expected_home_win_prob(home_elo: float, away_elo: float, home_bonus: float) -> float:
    return 1 / (1 + 10 ** (-(home_elo - away_elo + home_bonus) / ELO_SCALE))


def mov_multiplier(margin: float, winner_pre_game_elo_diff: float) -> float:
    """Same shape predict/elo_model.py's own mov_multiplier uses — a
    blowout moves the rating more than a 1-point win, log-scaled so a
    10-point margin doesn't move it 10x as much as a 1-point margin,
    dampened by how big a favorite the winner already was. Generic across
    sports: only the margin's UNIT changes (runs, points, goals), not the
    shape of the adjustment."""
    m = max(1, abs(margin))
    dampener = 2.2 / (abs(winner_pre_game_elo_diff) * 0.001 + 2.2)
    return math.log(m + 1) * dampener


@dataclass
class EloUpdateResult:
    new_home_elo: float
    new_away_elo: float
    pre_game_home_win_prob: float


def update_elo(home_elo: float, away_elo: float, home_score: float, away_score: float, k: float, home_bonus: float) -> EloUpdateResult:
    """Draws (soccer) are scored as a genuine 0.5 result for both sides,
    not skipped and not forced into a fake winner — the logistic expected
    formula already handles a non-integer actual outcome correctly."""
    pre_game_home_win_prob = elo_expected_home_win_prob(home_elo, away_elo, home_bonus)
    if home_score == away_score:
        actual = 0.5
        diff_for_mov = 0.0
    else:
        home_won = home_score > away_score
        actual = 1.0 if home_won else 0.0
        diff_for_mov = (home_elo - away_elo) if home_won else (away_elo - home_elo)
    mov = mov_multiplier(home_score - away_score, diff_for_mov)
    delta = k * mov * (actual - pre_game_home_win_prob)
    return EloUpdateResult(new_home_elo=home_elo + delta, new_away_elo=away_elo - delta, pre_game_home_win_prob=pre_game_home_win_prob)


def predict_home_win_prob(home_elo: float, away_elo: float, home_bonus: float) -> float:
    return elo_expected_home_win_prob(home_elo, away_elo, home_bonus)


# ---------------------------------------------------------------------------
# Real historical results, via ESPN's scoreboard — confirmed live 2026-08-27
# to support date-range queries (?dates=YYYYMMDD-YYYYMMDD) with real final
# scores, across football/basketball/hockey/soccer, before writing this.
# ---------------------------------------------------------------------------


@dataclass
class FinishedGame:
    game_id: str
    game_date: str  # ISO date, YYYY-MM-DD
    home_team_id: int
    away_team_id: int
    home_score: float
    away_score: float


async def fetch_finished_games(client: httpx.AsyncClient, config: SportEloConfig, start_date: str, end_date: str) -> list[FinishedGame]:
    """start_date/end_date: 'YYYYMMDD'. ESPN's own range cap is generous
    but not unlimited in practice — callers walk multi-month backfills in
    chunks (see backfill_sport_elo) rather than requesting a whole season
    in one call."""
    url = f"{_ESPN_BASE}/{config.espn_sport}/{config.espn_league}/scoreboard"
    res = await client.get(url, params={"dates": f"{start_date}-{end_date}", "limit": 1000}, timeout=httpx.Timeout(15.0))
    if res.status_code != 200:
        return []
    data = res.json()
    games: list[FinishedGame] = []
    for ev in data.get("events") or []:
        comp = (ev.get("competitions") or [{}])[0]
        status = ((comp.get("status") or {}).get("type") or {}).get("name")
        if status != "STATUS_FINAL" and status != "STATUS_FULL_TIME":
            continue
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        home_id, away_id = (home.get("team") or {}).get("id"), (away.get("team") or {}).get("id")
        home_score, away_score = home.get("score"), away.get("score")
        if home_id is None or away_id is None or home_score is None or away_score is None:
            continue
        try:
            game_date = ev["date"][:10]
        except (KeyError, TypeError):
            continue
        games.append(
            FinishedGame(
                game_id=str(ev.get("id")),
                game_date=game_date,
                home_team_id=int(home_id),
                away_team_id=int(away_id),
                home_score=float(home_score),
                away_score=float(away_score),
            )
        )
    return games


async def fetch_finished_games_range(client: httpx.AsyncClient, config: SportEloConfig, days_back: int) -> list[FinishedGame]:
    """Walks `days_back` days in ~45-day chunks (a conservative, real
    window ESPN's scoreboard endpoint has been confirmed to return full
    results for, not assumed unbounded) up to today, deduped by game_id
    since chunk boundaries can overlap by construction."""
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days_back)
    chunks: list[tuple[str, str]] = []
    cursor = start
    while cursor <= today:
        chunk_end = min(cursor + timedelta(days=45), today)
        chunks.append((cursor.strftime("%Y%m%d"), chunk_end.strftime("%Y%m%d")))
        cursor = chunk_end + timedelta(days=1)

    seen: dict[str, FinishedGame] = {}
    for s, e in chunks:
        for g in await fetch_finished_games(client, config, s, e):
            seen[g.game_id] = g
    return sorted(seen.values(), key=lambda g: g.game_date)


# ---------------------------------------------------------------------------
# Backfill + live prediction
# ---------------------------------------------------------------------------


def _season_for_date(game_date: str, config: SportEloConfig) -> int:
    """A single 'season' bucket per real season a sport's own calendar
    actually uses — most of these span a calendar-year boundary (NFL/NBA/
    NHL run into the following January), so the season label is the year
    it STARTED in, not the literal calendar year of a given game.
    Deliberately simple (month-based cutoff, no per-sport exact schedule
    lookup) — good enough for a baseline's regress-toward-mean boundary,
    not claimed to be exact to the day."""
    year, month = int(game_date[:4]), int(game_date[5:7])
    if config.sport_key in ("nfl", "cfb"):
        return year if month >= 7 else year - 1
    if config.sport_key in ("nba", "nhl"):
        return year if month >= 8 else year - 1
    if config.sport_key == "soccer_epl":
        return year if month >= 6 else year - 1
    return year  # MLS, other calendar-year seasons


async def backfill_sport_elo(client: httpx.AsyncClient, sport_key: str, days_back: int = 400) -> dict:
    """Walks real finished games chronologically, computing every team's
    Elo trajectory the same way elo_model.py's backfill_elo does for
    MLB — no lookahead, one pass, oldest to newest. `days_back` defaults
    to ~13 months so a fresh sport gets one full real season of signal
    (per-sport exact season length varies; this is a real, generous
    default, not a promise of exactly one season for every sport)."""
    config = SPORT_CONFIGS[sport_key]
    games = await fetch_finished_games_range(client, config, days_back)

    ratings: dict[int, float] = {}
    ratings_season: dict[int, int] = {}
    games_played: dict[int, int] = {}
    entries: list[db.EloHistoryInput] = []

    async def starting_rating_for(team_id: int, season: int) -> float:
        if team_id in ratings and ratings_season.get(team_id) == season:
            return ratings[team_id]
        if team_id in ratings and ratings_season.get(team_id) != season:
            # Real season boundary crossed for this team — regress before
            # this season's first game, matching elo_model.py's own
            # cross-season behavior.
            ratings[team_id] = regress_to_mean(ratings[team_id])
            games_played[team_id] = 0
        elif team_id not in ratings:
            prior = await db.get_latest_elo_before_season(team_id, season, sport=sport_key)
            ratings[team_id] = regress_to_mean(prior.elo) if prior else STARTING_ELO
        ratings_season[team_id] = season
        return ratings[team_id]

    for g in games:
        season = _season_for_date(g.game_date, config)
        home_elo = await starting_rating_for(g.home_team_id, season)
        away_elo = await starting_rating_for(g.away_team_id, season)
        result = update_elo(home_elo, away_elo, g.home_score, g.away_score, config.k_factor, config.home_bonus)
        ratings[g.home_team_id], ratings[g.away_team_id] = result.new_home_elo, result.new_away_elo
        games_played[g.home_team_id] = games_played.get(g.home_team_id, 0) + 1
        games_played[g.away_team_id] = games_played.get(g.away_team_id, 0) + 1
        try:
            game_pk = int(g.game_id)
        except ValueError:
            continue
        entries.append(
            db.EloHistoryInput(team_id=g.home_team_id, season=season, game_pk=game_pk, game_date=g.game_date, elo=result.new_home_elo, games_played=games_played[g.home_team_id], opponent_team_id=g.away_team_id, was_home=True, sport=sport_key)
        )
        entries.append(
            db.EloHistoryInput(team_id=g.away_team_id, season=season, game_pk=game_pk, game_date=g.game_date, elo=result.new_away_elo, games_played=games_played[g.away_team_id], opponent_team_id=g.home_team_id, was_home=False, sport=sport_key)
        )

    written = await db.write_elo_history(entries)
    return {"sport": sport_key, "games_walked": len(games), "rows_written": written}


async def predict_game(sport_key: str, home_team_id: int, away_team_id: int, season: int) -> float | None:
    """Real current Elo prediction for an upcoming game — None only when
    neither team has any rating history at all (a genuinely new/unbackfilled
    team), never a fabricated 50/50 guess in that case."""
    config = SPORT_CONFIGS[sport_key]
    home = await db.get_current_elo(home_team_id, season, sport=sport_key) or await db.get_latest_elo_before_season(home_team_id, season + 1, sport=sport_key)
    away = await db.get_current_elo(away_team_id, season, sport=sport_key) or await db.get_latest_elo_before_season(away_team_id, season + 1, sport=sport_key)
    if home is None and away is None:
        return None
    home_elo = regress_to_mean(home.elo) if home and home.game_date[:4] != str(season) else (home.elo if home else STARTING_ELO)
    away_elo = regress_to_mean(away.elo) if away and away.game_date[:4] != str(season) else (away.elo if away else STARTING_ELO)
    return predict_home_win_prob(home_elo, away_elo, config.home_bonus)


# ---------------------------------------------------------------------------
# Market blend — anchors the Elo-only prediction above to the real market,
# same discipline predict/probability_blend.py already established for MLB
# (MARKET_BLEND_WEIGHT, disclosed as a hand-set placeholder, not yet fit).
# ---------------------------------------------------------------------------


async def best_market_moneyline_prob(app_sport: str, game_id: str) -> tuple[float, float] | None:
    """Devigged (home_prob, away_prob) from the best REAL price across
    every book/source for this game — same plausibility guard
    (is_plausible_decimal_odds) predict/mlb_game_lines.py's
    game_lines_from_book_lines was fixed to use 2026-08-27, applied here
    directly against game_odds_book_lines rather than routing through
    that function's MLB-specific SnapshotGame/GameLine machinery. `None`
    when no plausible two-sided price exists for this game yet — never a
    fabricated 50/50 guess."""
    rows = await db.read_game_odds_book_lines_for_sport(app_sport)
    home_best: float | None = None
    away_best: float | None = None
    for r in rows:
        if r.game_id != game_id or r.market != "moneyline" or r.side not in ("home", "away"):
            continue
        decimal = r.decimal_odds if r.decimal_odds is not None else american_to_decimal(r.american_odds)
        if not is_plausible_decimal_odds(decimal):
            continue
        if r.side == "home" and (home_best is None or decimal > home_best):
            home_best = decimal
        if r.side == "away" and (away_best is None or decimal > away_best):
            away_best = decimal
    if home_best is None or away_best is None:
        return None
    return devig_two_way(home_best, away_best)


@dataclass
class MoneylinePrediction:
    elo_home_prob: float | None
    market_home_prob: float | None
    blended_home_prob: float | None  # the real, final prediction — None only when neither signal is available


async def predict_moneyline(sport_key: str, app_sport: str, home_team_id: int, away_team_id: int, season: int, game_id: str) -> MoneylinePrediction:
    """The real, final baseline prediction: Elo blended toward the market
    at MARKET_BLEND_WEIGHT (same weight MLB's own probability_blend.py
    uses — a real, disclosed placeholder shared across sports until any
    sport's own weight gets fit against real graded outcomes/CLV).
    `app_sport` is the app-facing key game_odds_book_lines uses (e.g.
    'nfl'), separate from `sport_key` (team_elo_history's key, e.g. also
    'nfl' but 'soccer_epl'/'soccer_mls' split from the app's single
    'soccer' key) — kept as two params rather than assumed equal, since
    they're NOT equal for soccer."""
    elo_prob = await predict_game(sport_key, home_team_id, away_team_id, season)
    market = await best_market_moneyline_prob(app_sport, game_id)
    market_home_prob = market[0] if market else None
    if elo_prob is None and market_home_prob is None:
        blended = None
    elif elo_prob is None:
        blended = market_home_prob
    else:
        blended = blend_probability(elo_prob, market_home_prob, MARKET_BLEND_WEIGHT)
    return MoneylinePrediction(elo_home_prob=elo_prob, market_home_prob=market_home_prob, blended_home_prob=blended)


# ---------------------------------------------------------------------------
# Totals — no sport here has a real statistical total model (MLB's own is a
# separate, more involved build). The honest baseline: the market's own
# devigged over/under, not a fabricated model output pretending to be more
# than it is. Real, legitimate given the whole market-centric framing this
# session — the market genuinely is the best available signal absent a
# fitted model of one's own; disclosed as "market consensus," not "this
# app's own edge."
# ---------------------------------------------------------------------------


@dataclass
class TotalPrediction:
    point: float | None
    over_prob: float | None
    under_prob: float | None


async def predict_total_market_only(app_sport: str, game_id: str) -> TotalPrediction:
    rows = await db.read_game_odds_book_lines_for_sport(app_sport)
    over_best: float | None = None
    under_best: float | None = None
    point: float | None = None
    for r in rows:
        if r.game_id != game_id or r.market != "total" or r.side not in ("over", "under"):
            continue
        decimal = r.decimal_odds if r.decimal_odds is not None else american_to_decimal(r.american_odds)
        if not is_plausible_decimal_odds(decimal):
            continue
        if r.side == "over" and (over_best is None or decimal > over_best):
            over_best = decimal
            point = r.point if r.point is not None else point
        if r.side == "under" and (under_best is None or decimal > under_best):
            under_best = decimal
            point = point if point is not None else r.point
    if over_best is None or under_best is None:
        return TotalPrediction(point=point, over_prob=None, under_prob=None)
    devigged = devig_two_way(over_best, under_best)
    if devigged is None:
        return TotalPrediction(point=point, over_prob=None, under_prob=None)
    return TotalPrediction(point=point, over_prob=devigged[0], under_prob=devigged[1])
