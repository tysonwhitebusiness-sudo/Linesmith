"""Direct port of lib/sports/mlb/parkFactors.ts — not a reimplementation.

Park factors — how much a specific venue inflates or deflates run scoring
relative to league average, computed straight from this season's own
completed games. No external park-factor dataset needed: the same
schedule data already used elsewhere has everything required. Persisted
(via db.write_park_factors) since a park's character doesn't change
mid-season and recomputing it from the full schedule on every request
would be wasteful.
"""
from dataclasses import dataclass

import httpx

from predict.statsapi import eastern_date, get_schedule_range

# Below this many games at a venue this season, the sample's too thin to
# trust — neutral 1.0 instead of extrapolating from a handful of games.
MIN_GAMES_FOR_PARK_FACTOR = 15
# Same "don't let one adjustment dominate" discipline as this codebase's
# other models — bounds the factor to [0.75, 1.25].
MAX_PARK_FACTOR_DEVIATION = 0.25


@dataclass
class ParkFactorResult:
    venue_id: int
    venue_name: str
    factor: float
    games: int


async def compute_park_factors(client: httpx.AsyncClient, season: int) -> list[ParkFactorResult]:
    """Walks this season's completed games and computes each venue's
    combined-runs average against the league average. Pure computation —
    callers decide whether/when to persist it."""
    today = eastern_date()
    games = await get_schedule_range(client, f"{season}-03-01", today)
    finals = [
        g
        for g in games
        if g.abstract_state == "Final"
        and g.venue is not None
        and g.venue.get("id") is not None
        and (g.teams.get("home") or {}).get("score") is not None
        and (g.teams.get("away") or {}).get("score") is not None
    ]

    by_venue: dict[int, dict] = {}
    league_total_runs = 0.0
    league_games = 0

    for g in finals:
        runs = g.teams["home"]["score"] + g.teams["away"]["score"]
        league_total_runs += runs
        league_games += 1
        venue_id = g.venue["id"]
        entry = by_venue.get(venue_id)
        if entry is None:
            entry = {"name": g.venue.get("name"), "total_runs": 0.0, "games": 0}
            by_venue[venue_id] = entry
        entry["total_runs"] += runs
        entry["games"] += 1

    if league_games == 0:
        return []
    league_avg = league_total_runs / league_games

    results: list[ParkFactorResult] = []
    for venue_id, entry in by_venue.items():
        if entry["games"] < MIN_GAMES_FOR_PARK_FACTOR:
            results.append(ParkFactorResult(venue_id=venue_id, venue_name=entry["name"], factor=1.0, games=entry["games"]))
            continue
        venue_avg = entry["total_runs"] / entry["games"]
        raw_factor = venue_avg / league_avg
        factor = min(1 + MAX_PARK_FACTOR_DEVIATION, max(1 - MAX_PARK_FACTOR_DEVIATION, raw_factor))
        results.append(ParkFactorResult(venue_id=venue_id, venue_name=entry["name"], factor=factor, games=entry["games"]))
    return results
