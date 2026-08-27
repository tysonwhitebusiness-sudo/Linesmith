"""Captures generic_team_elo.py's baseline predictions into game_picks,
per real scheduled game, per sport — the missing half of the loop the
user asked for directly (2026-08-27): market price data for these sports
was already accumulating on its own via the existing odds jobs, but
nothing was recording what OUR OWN model actually predicted, at what
price, when. Without that, there's no dataset to ever run a CLV backtest
against later, no matter how long the market side accumulates alone.

Mirrors predict/game_pick_lock.py's real, proven shape for MLB
(ensure_game_pick_row -> capture_moneyline_pick/capture_total_pick) —
those db.py functions were already fully sport-generic before this file
existed (confirmed by reading them, not assumed), so this is real reuse,
not a parallel system. The initial/final capture-window split below is a
deliberately simpler analog of game_pick_lock.py's own MLB-specific
design (a real 6am-CT initial window, a real 3-hours-before-first-pitch
final lock) — initial here is "first time this job sees the game," final
is "within FINAL_LOCK_HOURS_BEFORE of kickoff," not tied to any specific
per-sport time-of-day convention the way MLB's is. A real, disclosed
simplification, not a claim of parity with MLB's own tuned windows.

Wired into JOB_REGISTRY (jobs.py) as genericCaptureJob, one shared job
across every sport this covers — same "one runner, declared list" shape
CLAUDE.md's own job-runner-architecture section already establishes for
provider jobs, applied here to capture instead.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

import db
from . import generic_team_elo as gte

# How close to kickoff a 'final' capture is attempted — mirrors
# game_pick_lock.py's own FINAL_LOCK_HOURS_BEFORE=3 for MLB; reused as a
# reasonable default here rather than re-deriving a per-sport value with
# no real evidence yet to justify a different one.
FINAL_LOCK_HOURS_BEFORE = 3


@dataclass
class ScheduledGame:
    game_id: str
    commence_time: str  # ISO, from ESPN's own `date` field
    home_team_id: int
    away_team_id: int
    home_team_name: str
    away_team_name: str


async def fetch_scheduled_games(client: httpx.AsyncClient, config: "gte.SportEloConfig", date: str) -> list[ScheduledGame]:
    """date: 'YYYYMMDD'. Same ESPN scoreboard endpoint generic_team_elo.py's
    own fetch_finished_games already proved out live — this variant keeps
    every real game regardless of status (scheduled, in-progress, final),
    since a capture run might reasonably catch a game at any of those."""
    url = f"{gte._ESPN_BASE}/{config.espn_sport}/{config.espn_league}/scoreboard"
    res = await client.get(url, params={"dates": date, "limit": 1000}, timeout=httpx.Timeout(15.0))
    if res.status_code != 200:
        return []
    data = res.json()
    games: list[ScheduledGame] = []
    for ev in data.get("events") or []:
        comp = (ev.get("competitions") or [{}])[0]
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        home_team, away_team = home.get("team") or {}, away.get("team") or {}
        if home_team.get("id") is None or away_team.get("id") is None:
            continue
        games.append(
            ScheduledGame(
                game_id=str(ev.get("id")),
                commence_time=ev.get("date") or "",
                home_team_id=int(home_team["id"]),
                away_team_id=int(away_team["id"]),
                home_team_name=home_team.get("displayName") or "",
                away_team_name=away_team.get("displayName") or "",
            )
        )
    return games


def _is_final_capture_due(commence_time: str, now: datetime) -> bool:
    if not commence_time:
        return False
    try:
        commence = datetime.fromisoformat(commence_time[:-1] + "+00:00" if commence_time.endswith("Z") else commence_time)
    except ValueError:
        return False
    return now >= commence - timedelta(hours=FINAL_LOCK_HOURS_BEFORE)


async def _capture_slot(sport_key: str, app_sport: str, g: ScheduledGame, season: int, slot: str) -> tuple[bool, bool]:
    """Attempts one slot ('initial' or 'final') for one game — both
    capture_moneyline_pick/capture_total_pick are idempotent on their own
    (`{col}_captured_at IS NULL` guard), so calling this for a slot
    that's already captured is a safe no-op, not a double-write. Returns
    (moneyline_captured, total_captured) for this call."""
    ml_captured = total_captured = False
    ml = await gte.predict_moneyline(sport_key, app_sport, g.home_team_id, g.away_team_id, season, g.game_id)
    if ml.blended_home_prob is not None:
        side = "home" if ml.blended_home_prob >= 0.5 else "away"
        prob = ml.blended_home_prob if side == "home" else 1 - ml.blended_home_prob
        await db.capture_moneyline_pick(db.MoneylinePickCapture(sport=app_sport, game_id=g.game_id, slot=slot, side=side, prob=prob, late=False))
        ml_captured = True

    total = await gte.predict_total_market_only(app_sport, g.game_id)
    if total.over_prob is not None and total.point is not None:
        side = "over" if total.over_prob >= total.under_prob else "under"
        prob = total.over_prob if side == "over" else total.under_prob
        await db.capture_total_pick(db.TotalPickCapture(sport=app_sport, game_id=g.game_id, slot=slot, side=side, prob=prob, line=total.point, late=False))
        total_captured = True
    return ml_captured, total_captured


async def capture_today_for_sport(client: httpx.AsyncClient, sport_key: str, app_sport: str, date: str, now: datetime | None = None) -> dict:
    """Real capture pass: for every real game ESPN's scoreboard reports
    for `date`, ensures an identity row exists, always attempts an
    'initial' capture (a no-op if one already exists for this game), and
    additionally attempts a 'final' capture once within
    FINAL_LOCK_HOURS_BEFORE of the real kickoff time. Idempotent by
    construction — safe to run repeatedly (e.g. on a recurring job) for
    the same date without double-capturing or overwriting an existing
    slot."""
    now = now or datetime.now(timezone.utc)
    config = gte.SPORT_CONFIGS[sport_key]
    games = await fetch_scheduled_games(client, config, date)
    season = gte._season_for_date(f"{date[:4]}-{date[4:6]}-{date[6:8]}", config)

    captured_ml, captured_total, final_ml, final_total, skipped = 0, 0, 0, 0, 0
    for g in games:
        await db.ensure_game_pick_row(
            db.GamePickIdentity(
                sport=app_sport,
                game_id=g.game_id,
                home_team_id=g.home_team_id,
                away_team_id=g.away_team_id,
                home_team_name=g.home_team_name,
                away_team_name=g.away_team_name,
                matchup=f"{g.away_team_name} @ {g.home_team_name}",
                commence_time=g.commence_time,
            )
        )

        ml_ok, total_ok = await _capture_slot(sport_key, app_sport, g, season, "initial")
        captured_ml += 1 if ml_ok else 0
        captured_total += 1 if total_ok else 0
        if not ml_ok:
            skipped += 1

        if _is_final_capture_due(g.commence_time, now):
            ml_ok, total_ok = await _capture_slot(sport_key, app_sport, g, season, "final")
            final_ml += 1 if ml_ok else 0
            final_total += 1 if total_ok else 0

    return {
        "sport": sport_key,
        "games": len(games),
        "moneyline_captured": captured_ml,
        "total_captured": captured_total,
        "final_moneyline_captured": final_ml,
        "final_total_captured": final_total,
        "skipped_no_prediction": skipped,
    }


# app_sport differs from sport_key only for soccer — game_odds_book_lines
# uses one generic 'soccer' key for both EPL and MLS (confirmed in
# db.py's read_game_odds_book_lines_for_sport docstring), while
# team_elo_history needs the two rating pools kept separate.
_APP_SPORT_BY_KEY = {"nfl": "nfl", "cfb": "cfb", "nba": "nba", "nhl": "nhl", "soccer_epl": "soccer", "soccer_mls": "soccer"}


async def capture_all_sports_today(client: httpx.AsyncClient) -> list[dict]:
    """Real orchestration: runs capture_today_for_sport for every sport
    generic_team_elo.py covers, for today's real UTC date. Called on a
    recurring schedule (see jobs.py's genericCaptureJob) — each tick only
    processes today, and the periodic cadence itself is what catches a
    game's 'final' window becoming due later the same day, same
    reasoning MLB's own mlbOddsLinesCycleJob relies on."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    results = []
    for sport_key, app_sport in _APP_SPORT_BY_KEY.items():
        results.append(await capture_today_for_sport(client, sport_key, app_sport, today))
    return results
