"""Direct port of lib/sports/mlb/simGame.ts — not a reimplementation.

The real-game orchestrator: takes an actual matchup (lineups, starters,
teams, venue) and runs N full simulated games, composing every piece built
in Phases A-C of this port. Data-fetching half of sim_engine.py's pure/fetch
split.

Randomness: TS uses unseeded Math.random() at every real call site — there
is no existing seeded behavior to preserve bit-for-bit (confirmed in the
gameplan's own open-question audit). `random.random` is the direct Python
equivalent (uniform [0,1), no new dependency); numpy's generator was the
documented alternative but isn't warranted unless throughput measurement
says otherwise.
"""
import asyncio
import random
from dataclasses import dataclass

import httpx

import db

from .sim_engine import (
    OutcomeVector,
    Rng,
    apply_park_factor,
    blend_batter_pitcher_vector,
    make_lineup_vs_pitching_stream,
    precompute_lineup_vs_pitching,
)
from .sim_engine import simulate_game as simulate_played_game
from .sim_engine import simulate_games
from .sim_rates import (
    compute_bullpen_outcome_vector,
    compute_league_outcome_rates,
    compute_lineup_outcome_vectors,
    compute_pitcher_outcome_vectors,
    get_starter_innings_per_start,
)


@dataclass
class SimGameContext:
    season: int
    # Real personIds, batting order 1-9.
    home_lineup_ids: list[int]
    away_lineup_ids: list[int]
    home_starter_id: int
    away_starter_id: int
    home_team_id: int
    away_team_id: int
    # None when the venue is unknown — apply_park_factor treats a
    # missing/neutral factor as 1 (no adjustment).
    venue_id: int | None


@dataclass
class SimGameResult:
    n: int
    home_win_prob: float
    away_win_prob: float
    home_expected_runs: float
    away_expected_runs: float
    expected_total: float


def default_rng() -> float:
    return random.random()


async def simulate_game_for_context(client: httpx.AsyncClient, context: SimGameContext, n: int = 4000, rng: Rng = default_rng) -> SimGameResult:
    """Runs `n` full simulated games for a real matchup and aggregates the
    game-level markets this engine is scoped to (win probability, expected
    total). Every expensive data pull (league rates, both lineups, both
    pitchers, both bullpens, park factors) happens once, concurrently,
    before any simulation runs — the N game replays themselves are pure
    in-memory math."""
    league = await compute_league_outcome_rates(client, context.season)
    league_rates = league.vector

    (
        home_lineup,
        away_lineup,
        pitcher_vectors,
        home_bullpen,
        away_bullpen,
        home_innings_per_start,
        away_innings_per_start,
        park_factor_rows,
    ) = await asyncio.gather(
        compute_lineup_outcome_vectors(client, context.home_lineup_ids, context.season, league_rates),
        compute_lineup_outcome_vectors(client, context.away_lineup_ids, context.season, league_rates),
        compute_pitcher_outcome_vectors(client, [context.home_starter_id, context.away_starter_id], context.season, league_rates),
        compute_bullpen_outcome_vector(client, context.home_team_id, context.season, league_rates),
        compute_bullpen_outcome_vector(client, context.away_team_id, context.season, league_rates),
        get_starter_innings_per_start(client, context.home_starter_id, context.season),
        get_starter_innings_per_start(client, context.away_starter_id, context.season),
        db.read_park_factors(context.season),
    )

    park_factor = 1.0
    if context.venue_id is not None:
        match = next((r for r in park_factor_rows if r.venue_id == context.venue_id), None)
        park_factor = match.factor if match else 1.0

    home_starter_vector = pitcher_vectors[context.home_starter_id]
    away_starter_vector = pitcher_vectors[context.away_starter_id]

    home_lineup_vectors = [home_lineup.by_batter[id_] for id_ in context.home_lineup_ids]
    away_lineup_vectors = [away_lineup.by_batter[id_] for id_ in context.away_lineup_ids]

    # Home batters face the AWAY team's starter/bullpen; away batters face
    # HOME pitching. Precomputed ONCE for this matchup, reused across all n
    # games — only the lightweight per-game stream gets recreated in the loop below.
    home_precomputed = precompute_lineup_vs_pitching(home_lineup_vectors, away_starter_vector, away_bullpen, league_rates, away_innings_per_start, park_factor)
    away_precomputed = precompute_lineup_vs_pitching(away_lineup_vectors, home_starter_vector, home_bullpen, league_rates, home_innings_per_start, park_factor)

    home_wins = 0
    total_home_runs = 0
    total_away_runs = 0
    for _ in range(n):
        home_stream = make_lineup_vs_pitching_stream(home_precomputed, len(home_lineup_vectors))
        away_stream = make_lineup_vs_pitching_stream(away_precomputed, len(away_lineup_vectors))
        result = simulate_played_game(home_stream, away_stream, rng)
        if result.home_runs > result.away_runs:
            home_wins += 1
        total_home_runs += result.home_runs
        total_away_runs += result.away_runs

    home_win_prob = home_wins / n
    return SimGameResult(
        n=n,
        home_win_prob=home_win_prob,
        away_win_prob=1 - home_win_prob,
        home_expected_runs=total_home_runs / n,
        away_expected_runs=total_away_runs / n,
        expected_total=(total_home_runs + total_away_runs) / n,
    )


@dataclass
class TeamMatchupResult:
    home_win_prob: float
    expected_total: float


def simulate_team_matchup(
    home_batting: OutcomeVector,
    home_pitching: OutcomeVector,
    away_batting: OutcomeVector,
    away_pitching: OutcomeVector,
    league_rates: OutcomeVector,
    park_factor: float,
    n: int,
    rng: Rng = default_rng,
) -> TeamMatchupResult:
    """Team-vs-team only — no per-batter lineup, no starter/bullpen
    handoff. The historical-backfill counterpart to
    simulate_game_for_context above: real per-game historical
    lineups/starters aren't cheaply available at scale, so the backfill
    uses each team's whole-roster season-aggregate batting vs. the
    opponent's whole-roster season-aggregate pitching instead."""
    home_vector = apply_park_factor(blend_batter_pitcher_vector(home_batting, away_pitching, league_rates), park_factor)
    away_vector = apply_park_factor(blend_batter_pitcher_vector(away_batting, home_pitching, league_rates), park_factor)
    results = simulate_games(home_vector, away_vector, n, rng)
    home_wins = sum(1 for r in results if r.home_runs > r.away_runs)
    total_runs = sum(r.home_runs + r.away_runs for r in results)
    return TeamMatchupResult(home_win_prob=home_wins / n, expected_total=total_runs / n)
