"""Golf's simple rating — Elo over finishing positions.

Golf is the awkward one. There is no head-to-head game to predict: a tournament
is 150 players against each other at once, so "who wins this game" has no
meaning and the two-team Elo the other sports use does not apply. What DOES
carry over is the idea behind it — beat people ranked above you and your rating
rises.

SO EACH EVENT IS TREATED AS ITS FIELD PLAYING EACH OTHER. A player's result in
an event is the fraction of the field he finished ahead of; his expectation is
what his rating says that fraction should have been. The difference moves his
rating. One event, one update, everyone at once.

WHAT MADE THIS POSSIBLE. Golf held 149 result rows across 3 events, which is why
it had no model at all — a rating needs a field and a history to rate it
against. ESPN's season view carries every completed leaderboard, so
`backfill_golf_results.py` filled 235 events (2022-2026, 28,206 rows) in one
pass.

WHAT IT DOES NOT DO. It does not publish a probability that a golfer wins a
tournament. Turning ratings into win probabilities needs a scale nobody has
fitted, and inventing one would be exactly the fabricated number this codebase
keeps refusing. It ranks the field, and says that is what it is.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import db

STARTING_ELO = 1500.0
# A per-event K. One update per player per event, against the whole field, so it
# is larger than a per-game K would be; 24 is the same order of magnitude the
# generic team Elo uses and is a starting point, not a fitted value.
K_FACTOR = 24.0
# Ratings regress toward the mean between seasons, like every other rating in
# this codebase: form carries over, but not entirely.
SEASON_REGRESSION = 0.75
_ELO_SCALE = 400.0

_cache: tuple[dict[str, "GolferRating"], float] | None = None
_CACHE_TTL_S = 6 * 60 * 60


@dataclass
class GolferRating:
    espn_id: str
    rating: float = STARTING_ELO
    events: int = 0
    last_event: str | None = None
    recent_finishes: list[int] = field(default_factory=list)

    @property
    def avg_finish_last5(self) -> float | None:
        recent = self.recent_finishes[-5:]
        return round(sum(recent) / len(recent), 1) if recent else None


def expected_score(rating: float, field_ratings: list[float]) -> float:
    """The share of this field the rating says he should finish ahead of."""
    others = [r for r in field_ratings]
    if not others:
        return 0.5
    return sum(1.0 / (1.0 + 10 ** ((r - rating) / _ELO_SCALE)) for r in others) / len(others)


def actual_score(position: int, positions: list[int]) -> float:
    """The share he actually finished ahead of. A tie counts as half, the same
    convention Elo uses for a drawn game."""
    # `positions` is the WHOLE field, this player included, so the denominator
    # is everyone else. Counting himself made every score too small by a factor
    # of (n-1)/n — caught by test_golf_elo.py, which is why it states the
    # arithmetic (3rd of 10 beats 7 of the other 9) rather than the code's own
    # answer.
    n_others = len(positions) - 1
    if n_others <= 0:
        return 0.5
    beaten = sum(1 for p in positions if p > position)
    tied = sum(1 for p in positions if p == position) - 1  # himself
    return (beaten + 0.5 * max(tied, 0)) / n_others


async def _load_events(conn) -> list[tuple[str, int, list[tuple[str, int]]]]:
    """[(event_id, season, [(espn_id, position)…])…], oldest first."""
    rows = await conn.fetch(
        """
        SELECT event_id, espn_id, position, finished_at
          FROM golf_tournament_results
         WHERE position IS NOT NULL AND position <> ''
         ORDER BY finished_at, event_id
        """
    )
    events: dict[str, list[tuple[str, int]]] = {}
    season_of: dict[str, int] = {}
    order: list[str] = []
    for r in rows:
        pos = _position_number(r["position"])
        if pos is None:
            continue
        eid = r["event_id"]
        if eid not in events:
            events[eid] = []
            order.append(eid)
            season_of[eid] = r["finished_at"].year if r["finished_at"] else 0
        events[eid].append((str(r["espn_id"]), pos))
    return [(eid, season_of[eid], events[eid]) for eid in order]


def _position_number(raw: str) -> int | None:
    """'T7' and '7' both mean seventh."""
    s = str(raw).strip().upper().lstrip("T")
    try:
        return int(s)
    except ValueError:
        return None


async def ratings(force: bool = False) -> dict[str, GolferRating]:
    """Current ratings, replayed from every stored event in order."""
    global _cache
    if _cache and not force and time.monotonic() < _cache[1]:
        return _cache[0]

    pool = await db.get_pool()
    async with pool.acquire() as conn:
        events = await _load_events(conn)

    table: dict[str, GolferRating] = {}
    last_season: int | None = None
    for event_id, season, results in events:
        if last_season is not None and season != last_season:
            for g in table.values():
                g.rating = STARTING_ELO + SEASON_REGRESSION * (g.rating - STARTING_ELO)
        last_season = season

        if len(results) < 2:
            continue
        current = [table.get(pid) or GolferRating(pid) for pid, _ in results]
        for g in current:
            table.setdefault(g.espn_id, g)
        rating_list = [g.rating for g in current]
        positions = [pos for _, pos in results]

        updates: list[float] = []
        for i, (pid, pos) in enumerate(results):
            others_ratings = rating_list[:i] + rating_list[i + 1:]
            exp = expected_score(rating_list[i], others_ratings)
            act = actual_score(pos, positions)
            updates.append(K_FACTOR * (act - exp))
        for g, delta, (_, pos) in zip(current, updates, results):
            g.rating += delta
            g.events += 1
            g.last_event = event_id
            g.recent_finishes.append(pos)

    _cache = (table, time.monotonic() + _CACHE_TTL_S)
    return table


async def rank_field(espn_ids: list[str], min_events: int = 5) -> list[dict]:
    """The field, strongest first.

    A golfer under `min_events` is returned with his rating but flagged, because
    a rating built on one or two events is mostly the starting value showing
    through — the same reasoning the prop models' sample floors use.
    """
    table = await ratings()
    out = []
    for pid in espn_ids:
        g = table.get(str(pid))
        if g is None:
            out.append({"espn_id": str(pid), "rating": None, "events": 0,
                        "avg_finish_last5": None, "thin": True})
            continue
        out.append({"espn_id": g.espn_id, "rating": round(g.rating, 1), "events": g.events,
                    "avg_finish_last5": g.avg_finish_last5, "thin": g.events < min_events})
    out.sort(key=lambda r: (-(r["rating"] or 0)))
    return out
