"""Direct port of lib/sports/mlb/eloModel.ts — not a reimplementation.

Elo-style dynamic team rating — updates once per completed game rather than
only reflecting a season-to-date average, so a real hot or cold streak shows
up immediately instead of being diluted across 60+ games.

Mirrors FiveThirtyEight's own MLB approach in one specific way that
matters: the STORED rating stays simple — only wins, losses, and margin of
victory move it. Home-field, rest, travel, and starting pitcher never touch
the stored number; they're applied only at PREDICTION time via
predict_home_win_prob. Keeping these decoupled means a day-of adjustment
can never permanently corrupt a team's long-run rating trajectory.
"""
import math
from dataclasses import dataclass
from datetime import datetime

import httpx

import db
from db import get_current_elo as db_get_current_elo
from db import get_latest_elo_before_season

from . import statsapi

ELO_SCALE = 400  # standard logistic Elo scale (chess convention, widely reused in sports Elo)
DEFAULT_K = 5  # MLB's game-to-game randomness calls for a much gentler K than chess's 32
HOME_ELO_BONUS = 24  # matches FiveThirtyEight's own published home-field value exactly
STARTING_ELO = 1500
# Below this many rated games this season, a team's Elo is mostly still its
# (possibly regressed) season-opening value — too little in-season signal
# to blend into a live pick.
MIN_GAMES_FOR_ELO_TRUST = 10

# How far a team's rating regresses toward the mean between seasons — a
# fraction of the gap between last season's ending rating and 1500. 1/3 is a
# standard sports-Elo convention (not FiveThirtyEight's exact undisclosed value).
SEASON_REGRESSION_FACTOR = 1 / 3


def regress_to_mean(prior_rating: float, factor: float = SEASON_REGRESSION_FACTOR) -> float:
    return STARTING_ELO + factor * (prior_rating - STARTING_ELO)


# ---------------------------------------------------------------------------
# Rest (item 2)
# ---------------------------------------------------------------------------

# FiveThirtyEight's published value: each day of rest is worth roughly 2.3
# rating points, capped at 3 days.
REST_POINTS_PER_DAY = 2.3
MAX_REST_DAYS = 3


def _parse_epoch_ms(iso_str: str) -> float:
    s = iso_str[:-1] + "+00:00" if iso_str.endswith("Z") else iso_str
    dt = datetime.fromisoformat(s)
    return dt.timestamp() * 1000


def days_of_rest(last_game_date: str | None, this_game_date: str) -> int:
    """Days between a team's last game and this one, minus the game day
    itself — back-to-back games are 0 days of rest. No prior game on record
    (season/history start) is treated as fully rested."""
    if not last_game_date:
        return MAX_REST_DAYS
    diff_days = round((_parse_epoch_ms(this_game_date) - _parse_epoch_ms(last_game_date)) / 86_400_000)
    return max(0, diff_days - 1)


def rest_bonus(days: float) -> float:
    return min(MAX_REST_DAYS, max(0, days)) * REST_POINTS_PER_DAY


# ---------------------------------------------------------------------------
# Travel (item 3)
# ---------------------------------------------------------------------------

# Each team's home-city coordinates — used as a stand-in for exact venue
# geocoding. MLB team IDs as used throughout this app; the Athletics use
# their current Sacramento home (Sutter Health Park), not the historical
# Oakland location.
TEAM_HOME_COORDS: dict[int, tuple[float, float]] = {
    108: (33.8, -117.88),  # LAA — Anaheim
    109: (33.45, -112.07),  # ARI — Phoenix
    110: (39.29, -76.61),  # BAL — Baltimore
    111: (42.36, -71.06),  # BOS — Boston
    112: (41.88, -87.63),  # CHC — Chicago
    113: (39.1, -84.51),  # CIN — Cincinnati
    114: (41.5, -81.69),  # CLE — Cleveland
    115: (39.74, -104.99),  # COL — Denver
    116: (42.33, -83.05),  # DET — Detroit
    117: (29.76, -95.37),  # HOU — Houston
    118: (39.1, -94.58),  # KC — Kansas City
    119: (34.05, -118.24),  # LAD — Los Angeles
    120: (38.91, -77.01),  # WSH — Washington
    121: (40.75, -73.85),  # NYM — Queens
    133: (38.58, -121.49),  # ATH — Sacramento (current)
    134: (40.44, -80.0),  # PIT — Pittsburgh
    135: (32.72, -117.16),  # SD — San Diego
    136: (47.61, -122.33),  # SEA — Seattle
    137: (37.77, -122.42),  # SF — San Francisco
    138: (38.63, -90.2),  # STL — St. Louis
    139: (27.77, -82.65),  # TB — St. Petersburg
    140: (32.75, -97.08),  # TEX — Arlington
    141: (43.65, -79.38),  # TOR — Toronto
    142: (44.98, -93.27),  # MIN — Minneapolis
    143: (39.95, -75.17),  # PHI — Philadelphia
    144: (33.89, -84.47),  # ATL — Cumberland/Truist Park
    145: (41.83, -87.63),  # CWS — Chicago
    146: (25.76, -80.19),  # MIA — Miami
    147: (40.83, -73.93),  # NYY — Bronx
    158: (43.04, -87.91),  # MIL — Milwaukee
}


def _haversine_miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 3958.8  # Earth radius, miles
    to_rad = lambda d: d * math.pi / 180
    d_lat = to_rad(b[0] - a[0])
    d_lon = to_rad(b[1] - a[1])
    h = math.sin(d_lat / 2) ** 2 + math.cos(to_rad(a[0])) * math.cos(to_rad(b[0])) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.asin(math.sqrt(h))


# 538 discloses a max of ~4 points but not the curve shape — linear up to a
# cross-country-flight-scale distance is a reasonable, disclosed approximation.
MAX_TRAVEL_PENALTY = 4
MILES_FOR_MAX_TRAVEL_PENALTY = 2500


def travel_penalty(miles: float) -> float:
    return min(MAX_TRAVEL_PENALTY, (max(0, miles) / MILES_FOR_MAX_TRAVEL_PENALTY) * MAX_TRAVEL_PENALTY)


def travel_miles(last_location_team_id: int | None, today_location_team_id: int) -> float:
    """Distance between where a team last played and where they're playing
    today (today's home team's city, for both sides)."""
    if last_location_team_id is None:
        return 0
    from_coords = TEAM_HOME_COORDS.get(last_location_team_id)
    to_coords = TEAM_HOME_COORDS.get(today_location_team_id)
    if not from_coords or not to_coords:
        return 0
    return _haversine_miles(from_coords, to_coords)


# ---------------------------------------------------------------------------
# Starting pitcher adjustment (item 4)
# ---------------------------------------------------------------------------


@dataclass
class PitcherLineForGameScore:
    outs: int
    hits: int
    earned_runs: int
    unearned_runs: int
    walks: int
    strikeouts: int


def compute_game_score(line: PitcherLineForGameScore) -> float:
    """Bill James' original Game Score — a single-start quality number,
    computed from the box score alone. Standard, published formula: start
    at 50; +1 per out recorded, +1 more for outs beyond the 4th inning; -2
    per hit, -4 per earned run, -2 per unearned run, -1 per walk, +1 per
    strikeout."""
    outs_beyond_4th = max(0, line.outs - 12)
    return 50 + line.outs + 2 * outs_beyond_4th - 2 * line.hits - 4 * line.earned_runs - 2 * line.unearned_runs - line.walks + line.strikeouts


def _js_number(s) -> float:
    try:
        n = float(s)
    except (TypeError, ValueError):
        return 0.0
    return n if n == n else 0.0


def innings_pitched_to_outs(innings_pitched) -> int:
    """"6.1" (6 innings, 1 out) -> 19 outs. MLB's innings-pitched notation
    is not decimal — .1/.2 mean 1 or 2 extra outs, never a fraction."""
    parts = str(innings_pitched).split(".", 1)
    whole = _js_number(parts[0]) or 0
    partial = _js_number(parts[1]) if len(parts) > 1 else 0
    return int(whole * 3 + partial)


# 538's published multiplier: a start's Game Score, compared to the team's
# own rolling baseline, swings that team's effective rating by roughly 4.7x
# the gap.
PITCHER_ADJ_MULTIPLIER = 4.7
# How many of a pitcher's own recent starts the rolling trend averages over.
PITCHER_TREND_STARTS = 5


async def pitcher_adjustment(pitcher_id: int | None, team_id: int, season: int, game_date: str) -> float:
    """0 (neutral, no adjustment) when there isn't enough real signal yet —
    a rookie/call-up with no starts on record, or a team with no baseline
    starts logged this season."""
    if not pitcher_id:
        return 0
    trend = await db.recent_pitcher_game_scores(pitcher_id, PITCHER_TREND_STARTS)
    if not trend:
        return 0
    pitcher_avg = sum(trend) / len(trend)
    baseline = await db.team_baseline_game_score(team_id, season, game_date)
    if baseline is None:
        return 0
    return (pitcher_avg - baseline) * PITCHER_ADJ_MULTIPLIER


async def log_pitcher_game_score(client: httpx.AsyncClient, game_pk: int, season: int, pitcher_id: int, team_id: int, game_date: str) -> None:
    """Computes and logs one start's Game Score from the game's live feed
    box score — called once a start is complete."""
    feed = await statsapi.get_live_feed(client, game_pk)
    boxscore = feed.boxscore if feed else {}
    home_players = ((boxscore.get("teams") or {}).get("home") or {}).get("players") or {}
    away_players = ((boxscore.get("teams") or {}).get("away") or {}).get("players") or {}
    player = home_players.get(f"ID{pitcher_id}") or away_players.get(f"ID{pitcher_id}")
    stats = ((player or {}).get("stats") or {}).get("pitching") if player else None
    if not stats:
        return

    outs = innings_pitched_to_outs(stats.get("inningsPitched") if stats.get("inningsPitched") is not None else "0.0")
    earned_runs = _js_number(stats.get("earnedRuns")) if stats.get("earnedRuns") is not None else 0.0
    total_runs = _js_number(stats.get("runs")) if stats.get("runs") is not None else earned_runs
    line = PitcherLineForGameScore(
        outs=outs,
        hits=int(_js_number(stats.get("hits")) if stats.get("hits") is not None else 0),
        earned_runs=int(earned_runs),
        unearned_runs=int(max(0, total_runs - earned_runs)),
        walks=int(_js_number(stats.get("baseOnBalls")) if stats.get("baseOnBalls") is not None else 0),
        strikeouts=int(_js_number(stats.get("strikeOuts")) if stats.get("strikeOuts") is not None else 0),
    )
    game_score = compute_game_score(line)
    await db.write_pitcher_game_score(
        [db.PitcherGameScoreInput(pitcher_id=pitcher_id, team_id=team_id, season=season, game_pk=game_pk, game_date=game_date, game_score=game_score)]
    )


# ---------------------------------------------------------------------------
# Rating update (stored Elo — unaffected by rest/travel/pitcher, by design)
# ---------------------------------------------------------------------------


def elo_expected_home_win_prob(home_elo: float, away_elo: float, home_bonus: float = HOME_ELO_BONUS) -> float:
    return 1 / (1 + 10 ** (-(home_elo - away_elo + home_bonus) / ELO_SCALE))


def mov_multiplier(run_margin: float, winner_pre_game_elo_diff: float) -> float:
    """Margin-of-victory multiplier: a blowout moves the rating more than a
    1-run win, log-scaled so a 10-run margin doesn't move it 10x as much as
    a 1-run margin. Dampened by how big a favorite the winner already was."""
    margin = max(1, abs(run_margin))
    dampener = 2.2 / (abs(winner_pre_game_elo_diff) * 0.001 + 2.2)
    return math.log(margin + 1) * dampener


@dataclass
class EloUpdateResult:
    new_home_elo: float
    new_away_elo: float
    pre_game_home_win_prob: float


def update_elo(home_elo: float, away_elo: float, home_runs: float, away_runs: float, k: float = DEFAULT_K, home_bonus: float = HOME_ELO_BONUS) -> EloUpdateResult:
    pre_game_home_win_prob = elo_expected_home_win_prob(home_elo, away_elo, home_bonus)
    home_won = 1 if home_runs > away_runs else 0
    winner_pre_game_diff = (home_elo - away_elo) if home_won else (away_elo - home_elo)
    mov = mov_multiplier(home_runs - away_runs, winner_pre_game_diff)
    delta = k * mov * (home_won - pre_game_home_win_prob)
    return EloUpdateResult(new_home_elo=home_elo + delta, new_away_elo=away_elo - delta, pre_game_home_win_prob=pre_game_home_win_prob)


# ---------------------------------------------------------------------------
# Prediction (rest + travel + pitcher applied here only, never to the stored rating)
# ---------------------------------------------------------------------------


@dataclass
class PredictionAdjustments:
    home_rest_days: float = 0
    away_rest_days: float = 0
    home_travel_miles: float = 0
    away_travel_miles: float = 0
    home_pitcher_adj: float = 0
    away_pitcher_adj: float = 0


def predict_home_win_prob(home_elo: float, away_elo: float, adj: PredictionAdjustments | None = None) -> float:
    adj = adj if adj is not None else PredictionAdjustments()
    home_effective = home_elo + HOME_ELO_BONUS + rest_bonus(adj.home_rest_days) - travel_penalty(adj.home_travel_miles) + adj.home_pitcher_adj
    away_effective = away_elo + rest_bonus(adj.away_rest_days) - travel_penalty(adj.away_travel_miles) + adj.away_pitcher_adj
    return 1 / (1 + 10 ** (-(home_effective - away_effective) / ELO_SCALE))


# ---------------------------------------------------------------------------
# Backfill (historical, walk-forward, no lookahead)
# ---------------------------------------------------------------------------


async def backfill_elo(client: httpx.AsyncClient, season: int) -> list[db.EloHistoryInput]:
    """Walks the season chronologically once, computing every team's Elo
    trajectory. A team's first game of the walked season starts from their
    regressed prior season rating if one exists in the DB, otherwise the
    flat starting value."""
    import functools

    # Bounding the range end at *today* only makes sense for the season
    # currently in progress — passing a past season through unbounded would
    # silently pull in every later season's games too.
    current_season = int(statsapi.eastern_date()[:4])
    range_end = statsapi.eastern_date() if season >= current_season else f"{season}-11-30"
    games = await statsapi.get_schedule_range(client, f"{season}-03-01", range_end)
    finals = [
        g
        for g in games
        if g.abstract_state == "Final" and (g.teams.get("home") or {}).get("score") is not None and (g.teams.get("away") or {}).get("score") is not None
    ]
    # Matches TS's `.sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1))`
    # exactly, including its non-standard tie behavior (equal dates compare
    # as "a after b", not "equal") — Elo is order-sensitive so this is worth
    # replicating bit-for-bit rather than "fixing" to a normal stable sort.
    finals.sort(key=functools.cmp_to_key(lambda a, b: -1 if a.game_date < b.game_date else 1))

    ratings: dict[int, float] = {}
    games_played: dict[int, int] = {}
    entries: list[db.EloHistoryInput] = []

    async def starting_rating_for(team_id: int) -> float:
        if team_id in ratings:
            return ratings[team_id]
        prior = await get_latest_elo_before_season(team_id, season)
        start = regress_to_mean(prior.elo) if prior else STARTING_ELO
        ratings[team_id] = start
        return start

    for g in finals:
        home_id = g.teams["home"]["team"]["id"]
        away_id = g.teams["away"]["team"]["id"]
        home_runs = g.teams["home"]["score"]
        away_runs = g.teams["away"]["score"]
        home_elo = await starting_rating_for(home_id)
        away_elo = await starting_rating_for(away_id)

        result = update_elo(home_elo, away_elo, home_runs, away_runs)
        ratings[home_id] = result.new_home_elo
        ratings[away_id] = result.new_away_elo
        home_games = games_played.get(home_id, 0) + 1
        away_games = games_played.get(away_id, 0) + 1
        games_played[home_id] = home_games
        games_played[away_id] = away_games

        entries.append(db.EloHistoryInput(team_id=home_id, season=season, game_pk=g.game_pk, game_date=g.game_date, elo=result.new_home_elo, games_played=home_games, opponent_team_id=away_id, was_home=True))
        entries.append(db.EloHistoryInput(team_id=away_id, season=season, game_pk=g.game_pk, game_date=g.game_date, elo=result.new_away_elo, games_played=away_games, opponent_team_id=home_id, was_home=False))

    return entries


async def refresh_elo_backfill(client: httpx.AsyncClient, season: int) -> dict:
    entries = await backfill_elo(client, season)
    rows_written = await db.write_elo_history(entries)
    return {"games_walked": len(entries) / 2, "rows_written": rows_written}


# ---------------------------------------------------------------------------
# Live path
# ---------------------------------------------------------------------------


@dataclass
class CurrentElo:
    elo: float
    games_played: int
    last_game_date: str | None
    # Team id of wherever they were last (their own, if last game was home;
    # the opponent's, if away) — the travel calculation's starting point.
    last_location_team_id: int | None


async def get_current_elo(team_id: int, season: int) -> CurrentElo:
    """A team's rating right now: this season's most recent row if they've
    played, otherwise their regressed prior-season rating, otherwise the
    flat starting value for a team with no history at all."""
    this_season = await db_get_current_elo(team_id, season)
    if this_season:
        return CurrentElo(
            elo=this_season.elo,
            games_played=this_season.games_played,
            last_game_date=this_season.game_date,
            last_location_team_id=team_id if this_season.was_home else this_season.opponent_team_id,
        )
    prior = await get_latest_elo_before_season(team_id, season)
    if prior:
        return CurrentElo(
            elo=regress_to_mean(prior.elo),
            games_played=0,
            last_game_date=prior.game_date,
            last_location_team_id=team_id if prior.was_home else prior.opponent_team_id,
        )
    return CurrentElo(elo=STARTING_ELO, games_played=0, last_game_date=None, last_location_team_id=None)


async def update_elo_for_finished_game(season: int, game_pk: int, game_date: str, home_team_id: int, away_team_id: int, home_runs: float, away_runs: float) -> None:
    """Updates both teams' STORED (unadjusted) Elo after one specific game
    goes Final — idempotent via write_elo_history's UNIQUE constraint."""
    home = await get_current_elo(home_team_id, season)
    away = await get_current_elo(away_team_id, season)
    result = update_elo(home.elo, away.elo, home_runs, away_runs)
    await db.write_elo_history(
        [
            db.EloHistoryInput(team_id=home_team_id, season=season, game_pk=game_pk, game_date=game_date, elo=result.new_home_elo, games_played=home.games_played + 1, opponent_team_id=away_team_id, was_home=True),
            db.EloHistoryInput(team_id=away_team_id, season=season, game_pk=game_pk, game_date=game_date, elo=result.new_away_elo, games_played=away.games_played + 1, opponent_team_id=home_team_id, was_home=False),
        ]
    )


@dataclass
class RestAndTravel:
    rest_days: float
    miles: float


def rest_and_travel_from_state(state: CurrentElo, game_date: str, today_home_team_id: int) -> RestAndTravel:
    """Rest + travel computed from an already-fetched CurrentElo state — no
    DB call of its own. For a caller building a whole slate, every team's
    state is batch-loaded once up front; this lets that caller reuse the
    pre-loaded state instead of re-querying."""
    return RestAndTravel(rest_days=days_of_rest(state.last_game_date, game_date), miles=travel_miles(state.last_location_team_id, today_home_team_id))


async def rest_and_travel_for(team_id: int, season: int, game_date: str, today_home_team_id: int) -> RestAndTravel:
    """Rest + travel for one team's upcoming game — the live-path
    counterpart, sourced from Elo history so it works whether the team's
    last game was this season or last."""
    return rest_and_travel_from_state(await get_current_elo(team_id, season), game_date, today_home_team_id)
