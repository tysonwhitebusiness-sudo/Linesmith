"""Gameday-proximity-aware throttling for the paid-provider fetch inside
NFL/CFB/Soccer's jobs — 2026-08-20, direct response to a real, computed
finding: the flat 3h/60min cadences (job_registry) spend the SAME 1
credit/cycle whether the nearest game is 6 minutes or 6 days away (ParlayAPI
bills per whole-board fetch, not per matched game), while most of a week has
zero real games for these sports. See docs/api-capability-audit-2026-08-20.md.

This does NOT gate the free ESPN schedule fetch (game_context.py) — that
always runs every cycle regardless of tier, since it's free and is what
tells us which tier we're even in. It only gates the PAID provider fetch
(ParlayAPI/SportsGameOdds) inside a job.

Three tiers, computed from real game kickoff times already loaded this
cycle (no separate lookup):
  - hot:  any non-final game within [-HOT_AFTER_HOURS, +HOT_BEFORE_HOURS]
          of now. Every job cycle fetches for real — "refresh hardest right
          before the game."
  - warm: any non-final game within +WARM_BEFORE_HOURS of now, not hot.
          Fetches for real only every WARM_THROTTLE_SECONDS (a persisted
          last-fetch timestamp, not every cycle) — "a few times the night
          before," not a full hot-tier cadence.
  - cold: no non-final game within the warm window. No real fetch at all —
          the free schedule check alone is enough to notice when a game
          enters the warm window next cycle.
"""
import time
from datetime import datetime, timezone

import db

HOT_BEFORE_HOURS = 6.0   # start refreshing hard 6h before kickoff
HOT_AFTER_HOURS = 4.0    # stay hot through a real game's rough duration + settling
WARM_BEFORE_HOURS = 24.0  # "the night before" a next-day game
WARM_THROTTLE_SECONDS = 4 * 3600.0  # "a few times" over a ~24h warm window, not every cycle


def _parse_game_time(raw: str) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _hours_until(game_date: str, now: datetime) -> float | None:
    game_time = _parse_game_time(game_date)
    if game_time is None:
        return None
    return (game_time - now).total_seconds() / 3600.0


def compute_tier(games: list, now: datetime | None = None) -> str:
    """cold | warm | hot — see module docstring. `games` are whatever
    game_context.Game objects the caller already loaded this cycle."""
    now = now or datetime.now(timezone.utc)
    best = None  # smallest |hours until kickoff|-ish proximity seen, tracked as (in_hot, in_warm)
    in_hot = False
    in_warm = False
    for g in games:
        if getattr(g, "is_final", False):
            continue
        delta = _hours_until(g.game_date, now)
        if delta is None:
            continue
        if -HOT_AFTER_HOURS <= delta <= HOT_BEFORE_HOURS:
            in_hot = True
        if -HOT_AFTER_HOURS <= delta <= WARM_BEFORE_HOURS:
            in_warm = True
    if in_hot:
        return "hot"
    if in_warm:
        return "warm"
    return "cold"


async def should_fetch_paid_providers(sport: str, games: list) -> tuple[str, bool]:
    """Returns (tier, should_fetch). Only warm tier needs the persisted
    throttle read/write — hot always fetches, cold never does, so those two
    never touch the DB for this decision."""
    tier = compute_tier(games)
    if tier == "hot":
        return tier, True
    if tier == "cold":
        return tier, False

    cache_key = f"gameday-tier:{sport}:last-warm-fetch"
    cached = await db.read_snapshot_with_age(cache_key)
    if cached is not None and cached[1] < WARM_THROTTLE_SECONDS:
        return tier, False
    await db.write_snapshot(cache_key, str(time.time()))
    return tier, True


def skip_summary(games: list, tier: str) -> dict:
    """Same summary shape every job's _run_timed wrapper expects, for a
    cycle that skipped the paid fetch entirely — zero real cost, not an
    error."""
    return {
        "games": len(games),
        "rows_matched": 0,
        "rows_written": 0,
        "unresolved": 0,
        "requests": 0,
        "objects": 0,
        "warnings": [f"skipped paid providers — {tier} tier, no game within the hot/warm window"],
    }
