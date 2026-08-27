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
not a parallel system. Deliberately simpler than game_pick_lock.py's own
two-capture-window design (a real 6am-CT-initial / 3hr-before-final-lock
schedule) — this writes one 'initial' capture whenever it's run, with a
'final' capture as a real, disclosed next step once this is wired into a
recurring schedule (JOB_REGISTRY) rather than run manually. A single
manual run tonight is a real first data point, not a finished pipeline.
"""
from dataclasses import dataclass

import httpx

import db
from . import generic_team_elo as gte


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


async def capture_today_for_sport(client: httpx.AsyncClient, sport_key: str, app_sport: str, date: str) -> dict:
    """Real capture pass: for every real game ESPN's scoreboard reports
    for `date`, ensures an identity row exists, computes the real
    Elo+market-blended moneyline prediction and the market-only total
    baseline, and writes an 'initial' capture for whichever side/prob
    each prediction actually produced. Idempotent by construction
    (capture_moneyline_pick/capture_total_pick only write when the slot
    hasn't been captured yet) — safe to run more than once for the same
    date without double-capturing."""
    config = gte.SPORT_CONFIGS[sport_key]
    games = await fetch_scheduled_games(client, config, date)
    season = gte._season_for_date(f"{date[:4]}-{date[4:6]}-{date[6:8]}", config)

    captured_ml, captured_total, skipped = 0, 0, 0
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

        ml = await gte.predict_moneyline(sport_key, app_sport, g.home_team_id, g.away_team_id, season, g.game_id)
        if ml.blended_home_prob is not None:
            side = "home" if ml.blended_home_prob >= 0.5 else "away"
            prob = ml.blended_home_prob if side == "home" else 1 - ml.blended_home_prob
            await db.capture_moneyline_pick(
                db.MoneylinePickCapture(sport=app_sport, game_id=g.game_id, slot="initial", side=side, prob=prob, late=False)
            )
            captured_ml += 1
        else:
            skipped += 1

        total = await gte.predict_total_market_only(app_sport, g.game_id)
        if total.over_prob is not None and total.point is not None:
            side = "over" if total.over_prob >= total.under_prob else "under"
            prob = total.over_prob if side == "over" else total.under_prob
            await db.capture_total_pick(
                db.TotalPickCapture(sport=app_sport, game_id=g.game_id, slot="initial", side=side, prob=prob, line=total.point, late=False)
            )
            captured_total += 1

    return {"sport": sport_key, "games": len(games), "moneyline_captured": captured_ml, "total_captured": captured_total, "skipped_no_prediction": skipped}
