"""Tennis's simple game model — wiring the rating engine that was never plugged in.

`predict/tennis_elo.py` has existed since Phase 2.2 as a complete, FITTED,
surface-weighted engine with its own tests, and nothing ever called it. So
tennis was the one sport in season that could not predict a match at all
(operator, 2026-09-20: every sport should manage that much).

HOW IT WORKS, and why each piece is the way it is:

* **History comes from `game_result`** — 57,155 matches back to 2015, 98% of
  them carrying a surface. That is the same source `fit_tennis_elo.py` fitted
  on, so serving and fitting cannot drift apart. A full replay costs about 2.4
  seconds, which is why this rebuilds ratings rather than storing them: a stored
  rating would be a second copy to keep in step for no gain.

* **Players are addressed by name**, because the engine is keyed on (tour,
  name) — Phase 2.1 found eight cross-tour collisions and keying on the tour
  resolves them. Today's schedule gives full names in the same form the history
  uses ("Peyton Stearns"), so the two sides join directly.

* **An unknown surface is left unknown.** Live-captured results carry no
  surface, and the schedule does not announce one. The engine already answers
  this correctly: with no surface weight it uses the player's overall rating,
  which is the only defensible number for a court we have not calibrated on.
  Guessing the surface from the tournament would be a fabricated input.

* **It blends toward the market**, exactly as the other sports' baseline does
  and with the same weight, so "the simple model" means one thing across the
  app. Where no price exists, the Elo number stands alone.

A drawn match is impossible here, so nothing in this file deals with one.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime, timezone

import db
import game_context as gc

from . import tennis_elo as te
from .probability_blend import MARKET_BLEND_WEIGHT, blend_probability

# Ratings are rebuilt from history rather than stored; six hours is a slate's
# worth of staleness at most, and a rebuild is seconds.
_ENGINE_TTL_S = 6 * 60 * 60
_engine_cache: tuple[te.TennisElo, float] | None = None

TOURS = ("tennis_atp", "tennis_wta")


@dataclass
class MatchPrediction:
    game_id: str
    sport: str
    home_id: str
    away_id: str
    home_name: str
    away_name: str
    elo_home_prob: float
    market_home_prob: float | None
    blended_home_prob: float
    surface: str
    start: str | None = None


async def _load_matches(conn) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT sport, game_date, COALESCE(surface, '') AS surface,
               home_team_raw AS home, away_team_raw AS away, home_score, away_score
          FROM game_result
         WHERE sport LIKE 'tennis%'
           AND home_score IS NOT NULL AND away_score IS NOT NULL
           AND home_score <> away_score
           AND home_team_raw IS NOT NULL AND away_team_raw IS NOT NULL
         ORDER BY game_date
        """
    )
    return [{"sport": r["sport"], "played": r["game_date"], "surface": r["surface"],
             "home": r["home"], "away": r["away"], "home_won": r["home_score"] > r["away_score"]}
            for r in rows]


async def engine(force: bool = False) -> te.TennisElo:
    global _engine_cache
    if _engine_cache and not force and time.monotonic() < _engine_cache[1]:
        return _engine_cache[0]
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        matches = await _load_matches(conn)
    _, eng = te.replay(matches)
    _engine_cache = (eng, time.monotonic() + _ENGINE_TTL_S)
    return eng


async def _market_home_prob(sport: str, game_id: str) -> float | None:
    """The book's own two-way number, de-vigged — the same input the other
    sports' baseline blends toward."""
    rows = await db.read_game_odds_book_lines_for_game("tennis", game_id)
    home, away = [], []
    for r in rows:
        if getattr(r, "market", None) != "moneyline":
            continue
        p = _implied(getattr(r, "american_odds", None))
        if p is None:
            continue
        (home if getattr(r, "side", "") == "home" else away).append(p)
    if not home or not away:
        return None
    h, a = sum(home) / len(home), sum(away) / len(away)
    total = h + a
    return h / total if total > 0 else None


def _implied(american) -> float | None:
    if american is None:
        return None
    a = float(american)
    if a == 0:
        return None
    return -a / (-a + 100) if a < 0 else 100 / (a + 100)


async def predict_today(sport: str, slate: date | None = None) -> list[MatchPrediction]:
    """Every scheduled match on this tour today, with its blended probability."""
    eng = await engine()
    as_of = slate or datetime.now(timezone.utc).date()
    out: list[MatchPrediction] = []
    for g in await gc.load_tennis_games(sport):
        if g.is_final or len(g.roster) < 2:
            continue
        home, away = g.roster[0], g.roster[1]
        home_name, away_name = (home.subject_name or "").strip(), (away.subject_name or "").strip()
        if not home_name or not away_name or "TBD" in (home_name, away_name):
            continue
        # Surface is left unknown on purpose; see this module's own note.
        elo_p = eng.predict(sport, home_name, away_name, "", as_of)
        market = await _market_home_prob(sport, g.game_id)
        out.append(MatchPrediction(
            game_id=g.game_id, sport=sport,
            home_id=str(home.subject_id).split(":")[-1], away_id=str(away.subject_id).split(":")[-1],
            home_name=home_name, away_name=away_name,
            elo_home_prob=elo_p, market_home_prob=market,
            blended_home_prob=blend_probability(elo_p, market, MARKET_BLEND_WEIGHT),
            surface="",
            start=g.game_date or None,
        ))
    return out


async def capture_today(sport: str, slate: date | None = None) -> dict:
    """Store today's picks the same way every other sport's baseline does."""
    import json

    preds = await predict_today(sport, slate)
    captured = 0
    for p in preds:
        await db.ensure_game_pick_row(db.GamePickIdentity(
            sport=sport, game_id=p.game_id,
            home_team_id=_int_or_none(p.home_id), away_team_id=_int_or_none(p.away_id),
            home_team_name=p.home_name, away_team_name=p.away_name,
            matchup=f"{p.away_name} vs {p.home_name}", commence_time=p.start,
            source="tennis_elo",
        ))
        side = "home" if p.blended_home_prob >= 0.5 else "away"
        prob = p.blended_home_prob if side == "home" else 1 - p.blended_home_prob
        await db.capture_moneyline_pick(db.MoneylinePickCapture(
            sport=sport, game_id=p.game_id, slot="initial", side=side, prob=prob, late=False,
            features_json=json.dumps({"elo_home_prob": p.elo_home_prob,
                                      "market_home_prob": p.market_home_prob,
                                      "blended_home_prob": p.blended_home_prob,
                                      "market_blend_weight": MARKET_BLEND_WEIGHT,
                                      "surface": p.surface or None}),
        ))
        captured += 1
    return {"sport": sport, "matches": len(preds), "captured": captured}


def _int_or_none(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


async def grade_recent(days: int = 3) -> int:
    """Settle picks from finished matches.

    Tennis is not on the team-sport grading path (`fetch_finished_games` reads
    an ESPN team scoreboard), so it grades from `game_result`, which the
    archival bridge already fills — and which keys a match by the same ESPN id
    the schedule used, so the two join directly.
    """
    from .game_pick_lock import FinishedGameInput, grade_finished_game_picks

    pool = await db.get_pool()
    rows = await pool.fetch(
        """
        SELECT sport, event_ref, home_score, away_score
          FROM game_result
         WHERE sport = ANY($1::text[]) AND game_date >= current_date - $2::int
           AND home_score IS NOT NULL AND away_score IS NOT NULL
        """,
        list(TOURS), days,
    )
    graded = 0
    for tour in TOURS:
        finished = [FinishedGameInput(game_id=str(r["event_ref"]), is_final=True,
                                      home_score=float(r["home_score"]), away_score=float(r["away_score"]))
                    for r in rows if r["sport"] == tour]
        if finished:
            await grade_finished_game_picks(tour, finished)
            graded += len(finished)
    return graded


async def run() -> dict:
    """One pass: capture today's matches on both tours, then settle finished ones."""
    out = {"tours": []}
    for tour in TOURS:
        out["tours"].append(await capture_today(tour))
    out["graded"] = await grade_recent()
    return out
