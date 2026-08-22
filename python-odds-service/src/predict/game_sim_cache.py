"""Direct port of lib/sports/mlb/gameSimCache.ts — not a reimplementation.

Live per-game simulation cache — simWinProb/simOverProb need today's real
lineups, which is separate work from the historical backfill. This module
is that work: it keeps game_sim_cache fresh, upgrading a projected-lineup
result to a posted-lineup one as real lineups firm up over the day.

Sequential vs. concurrent (gameplan open question 3, resolved here with
real numbers, not carried over from TS's reasoning): benchmarked
(scratch/bench_sim_throughput.py, no DB/network — synthetic vectors, real
hot loop) at ~700-800us per simulated game in pure Python (stdlib `random`,
no numpy), so a full N=4000 simulate_game_for_context call takes ~2.4-3.2s,
and a realistic 15-game MLB slate run sequentially takes ~44s total. That
comfortably fits inside the ~5-minute rebuild cadence this piggybacks on
(see module docstring below) with no concurrency needed — unlike TS, Python
has real multiprocessing options (ProcessPoolExecutor) that COULD run
separate games' simulations on separate cores, but the measured numbers
don't justify that complexity: the sequential loop already finishes in well
under a tenth of the cadence window. Revisit only if a real slate size or
N materially grows past what was measured here.

Scheduling deliberately piggybacks on the MLB snapshot rebuild's own
cadence rather than a new clock-based schedule (same reasoning as TS):
ensure_game_sims is safe to call on every rebuild — it skips any game whose
cached row already reflects the REAL posted lineup, and only (re)simulates
games still on the projected-lineup fallback or with no cache yet.
"""
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

import db

from .sim_game import SimGameContext, simulate_game_for_context

# Live sim count — SE on a ~50% probability is already ~1.1% at N=2,000, so
# 10,000 (simGame.ts's old default, used only for a one-off perf ceiling
# check) bought no real precision. 4,000 is the top of the recommended
# 2,000-4,000 range, kept for a little extra headroom now that real
# throughput (see module docstring) confirms there's plenty to spare.
LIVE_SIM_N = 4000


@dataclass
class GameSimInput:
    game_pk: int
    season: int
    status: str  # 'pre' | 'live' | 'done' | 'unknown'
    home_lineup: list[int]
    away_lineup: list[int]
    home_lineup_projected: bool
    away_lineup_projected: bool
    home_team_id: int
    away_team_id: int
    home_starter_id: int | None = None
    away_starter_id: int | None = None
    venue_id: int | None = None


async def load_game_sim(game_pk) -> db.GameSimCacheRow | None:
    """Cheap read for the live prediction path — never runs a simulation
    itself. None (not a thrown error) whenever nothing's cached yet, so
    callers fall back to their existing neutral impute."""
    return await db.read_game_sim_cache("mlb", str(game_pk))


async def ensure_game_sims(client: httpx.AsyncClient, inputs: list[GameSimInput]) -> None:
    """Ensures every pre-game matchup with a resolvable lineup and starter
    on both sides has a live simulation cached. Games already live/done, or
    missing a full lineup/starter on either side, are left alone — the
    caller's neutral impute covers those, same as before this cache existed."""
    for g in inputs:
        if g.status != "pre":
            continue
        if len(g.home_lineup) < 9 or len(g.away_lineup) < 9 or not g.home_starter_id or not g.away_starter_id:
            continue

        lineup_source = "projected" if (g.home_lineup_projected or g.away_lineup_projected) else "posted"
        existing = await load_game_sim(g.game_pk)
        # Nothing left to improve once we have a posted-lineup row. And a
        # projected row is never worth replacing with ANOTHER projected row
        # — the projected lineup/starter don't change between rebuilds, so
        # re-simulating would just burn ~4,000 sims for fresh Monte Carlo
        # noise on identical inputs. Only re-simulate on a genuine upgrade:
        # no cache yet, or existing is projected and we can now do posted.
        if existing and (existing.lineup_source == "posted" or lineup_source == "projected"):
            continue

        try:
            context = SimGameContext(
                season=g.season,
                home_lineup_ids=g.home_lineup[:9],
                away_lineup_ids=g.away_lineup[:9],
                home_starter_id=g.home_starter_id,
                away_starter_id=g.away_starter_id,
                home_team_id=g.home_team_id,
                away_team_id=g.away_team_id,
                venue_id=g.venue_id,
            )
            result = await simulate_game_for_context(client, context, LIVE_SIM_N)
            await db.write_game_sim_cache(
                db.GameSimCacheRow(
                    sport="mlb",
                    game_id=str(g.game_pk),
                    home_win_prob=result.home_win_prob,
                    expected_total=result.expected_total,
                    n=LIVE_SIM_N,
                    lineup_source=lineup_source,
                    computed_at=datetime.now(timezone.utc).isoformat(),
                )
            )
        except Exception as e:
            print(f"[game_sim_cache] simulation failed for game {g.game_pk}: {type(e).__name__}: {e}", flush=True)
