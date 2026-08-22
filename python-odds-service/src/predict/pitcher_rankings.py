"""Direct port of lib/sports/mlb/pitcherRankings.ts — not a
reimplementation.

Role-aware pitcher rankings — starters, closers, and relievers each
ranked within their own pool, on traditional stats, FIP/K-BB%, and
Statcast quality metrics together. Diagnostics-only: not part of the live
matchup/candidate pipeline (predict/prop_candidates.py) — that reads its
own, unrelated team-level DVP ranks directly from statsapi.py.

Cache shape matches TS's PitcherRoleRankings/RankedPitcher interfaces
field-for-field (camelCase JSON keys) — same "Python writes, TS reads"
cache-sharing intent as savant.py's cache key, so a future TS-side
cache-first cutover for the diagnostics routes costs nothing extra.
"""
from dataclasses import dataclass

import httpx

import db
from predict import savant, statsapi

# Hand-set v1 weights — same "principled, not yet fit against real
# outcomes" posture as edge_model.py's own hyperparameters. Traditional/
# FIP/K-BB% carry more weight than Statcast: Statcast rates need bigger
# samples to stabilize and are already gated by their own per-pitcher
# minimums (savant.py).
COMPOSITE_WEIGHTS: dict[str, float] = {
    "era": 0.2,
    "fip": 0.2,
    "kbbPct": 0.15,
    "whip": 0.1,
    "hardHitPct": 0.1,
    "barrelPct": 0.1,
    "exitVelo": 0.075,
    "whiffPct": 0.075,
}


def _composite_score(ranks: dict[str, int], pool_size: int) -> float | None:
    if pool_size <= 1:
        return None
    weighted_sum = 0.0
    weight_used = 0.0
    for key, weight in COMPOSITE_WEIGHTS.items():
        rank = ranks.get(key)
        if rank is None:
            continue
        # rank 1 (best) -> 100th percentile; rank pool_size (worst) -> 0th.
        percentile = 100 * (1 - (rank - 1) / (pool_size - 1))
        weighted_sum += percentile * weight
        weight_used += weight
    if weight_used == 0:
        return None
    return weighted_sum / weight_used


@dataclass
class RankedPitcher:
    person_id: int
    full_name: str
    role: str
    values: dict
    ranks: dict
    pool_size: int
    composite: float | None
    overall_rank: int | None
    raw: statsapi.RawPitcherSeasonLine


def _build_pool(role: str, rows: list[statsapi.LeaguePitcherSeasonRow], statcast: dict[int, savant.StatcastRates]) -> list[RankedPitcher]:
    merged: list[tuple[statsapi.RawPitcherSeasonLine, statsapi.PitcherStatLine]] = []
    for r in rows:
        sc = statcast.get(r.raw.person_id)
        values = dict(r.stat.values)
        if sc:
            values.update({"whiffPct": sc.whiff_pct, "barrelPct": sc.barrel_pct, "exitVelo": sc.exit_velo, "hardHitPct": sc.hard_hit_pct})
        stat = statsapi.PitcherStatLine(person_id=r.stat.person_id, full_name=r.stat.full_name, games_started=r.stat.games_started, values=values)
        merged.append((r.raw, stat))

    ranks = statsapi.rank_pitchers([stat for _, stat in merged])
    pool_size = len(merged)

    scored: list[RankedPitcher] = []
    for raw, stat in merged:
        pitcher_ranks = ranks.get(raw.person_id, {})
        scored.append(
            RankedPitcher(
                person_id=raw.person_id,
                full_name=raw.full_name,
                role=role,
                values=stat.values,
                ranks=pitcher_ranks,
                pool_size=pool_size,
                composite=_composite_score(pitcher_ranks, pool_size),
                overall_rank=None,
                raw=raw,
            )
        )

    # Composite ties are common — several pitchers landing on the exact
    # same ordinal rank for most of their component stats. Breaking ties
    # on innings pitched means the more established arm edges out a
    # small-sample pitcher sitting at an identical score.
    scored.sort(key=lambda p: (-(p.composite if p.composite is not None else -1), -p.raw.innings_pitched))
    for i, p in enumerate(scored):
        p.overall_rank = i + 1 if p.composite is not None else None

    return scored


@dataclass
class PitcherRoleRankings:
    season: int
    computed_at: str
    starters: list[RankedPitcher]
    closers: list[RankedPitcher]
    relievers: list[RankedPitcher]


CACHE_TTL_MS = 24 * 60 * 60_000


def _cache_key(season: int) -> str:
    return f"mlb:pitcher-role-rankings:{season}"


def _raw_to_json(raw: statsapi.RawPitcherSeasonLine) -> dict:
    return {
        "personId": raw.person_id,
        "fullName": raw.full_name,
        "teamId": raw.team_id,
        "gamesStarted": raw.games_started,
        "gamesPitched": raw.games_pitched,
        "gamesFinished": raw.games_finished,
        "inningsPitched": raw.innings_pitched,
        "saves": raw.saves,
        "saveOpportunities": raw.save_opportunities,
        "holds": raw.holds,
        "blownSaves": raw.blown_saves,
    }


def _raw_from_json(d: dict) -> statsapi.RawPitcherSeasonLine:
    return statsapi.RawPitcherSeasonLine(
        person_id=d["personId"],
        full_name=d["fullName"],
        team_id=d.get("teamId"),
        games_started=d["gamesStarted"],
        games_pitched=d["gamesPitched"],
        games_finished=d["gamesFinished"],
        innings_pitched=d["inningsPitched"],
        saves=d["saves"],
        save_opportunities=d["saveOpportunities"],
        holds=d["holds"],
        blown_saves=d["blownSaves"],
    )


def _pitcher_to_json(p: RankedPitcher) -> dict:
    return {
        "personId": p.person_id,
        "fullName": p.full_name,
        "role": p.role,
        "values": p.values,
        "ranks": p.ranks,
        "poolSize": p.pool_size,
        "composite": p.composite,
        "overallRank": p.overall_rank,
        "raw": _raw_to_json(p.raw),
    }


def _pitcher_from_json(d: dict) -> RankedPitcher:
    return RankedPitcher(
        person_id=d["personId"],
        full_name=d["fullName"],
        role=d["role"],
        values=d.get("values") or {},
        ranks=d.get("ranks") or {},
        pool_size=d["poolSize"],
        composite=d.get("composite"),
        overall_rank=d.get("overallRank"),
        raw=_raw_from_json(d["raw"]),
    )


def _rankings_to_json(r: PitcherRoleRankings) -> dict:
    return {
        "season": r.season,
        "computedAt": r.computed_at,
        "starters": [_pitcher_to_json(p) for p in r.starters],
        "closers": [_pitcher_to_json(p) for p in r.closers],
        "relievers": [_pitcher_to_json(p) for p in r.relievers],
    }


def _rankings_from_json(d: dict) -> PitcherRoleRankings:
    return PitcherRoleRankings(
        season=d["season"],
        computed_at=d["computedAt"],
        starters=[_pitcher_from_json(p) for p in d.get("starters") or []],
        closers=[_pitcher_from_json(p) for p in d.get("closers") or []],
        relievers=[_pitcher_from_json(p) for p in d.get("relievers") or []],
    )


async def get_pitcher_role_rankings(client: httpx.AsyncClient, season: int, force_refresh: bool = False) -> PitcherRoleRankings:
    """Role-classified, ranked, composite-scored pitcher pools — 24h
    cached so a normal page load never pays for a Statcast refresh.
    `force_refresh` bypasses the cache (used by a manual refresh trigger)."""
    import json
    import time

    if not force_refresh:
        cached = await db.read_snapshot_with_age(_cache_key(season))
        if cached is not None:
            payload, age_seconds = cached
            if age_seconds * 1000 < CACHE_TTL_MS:
                return _rankings_from_json(json.loads(payload))

    pools, statcast = await statsapi.get_league_pitcher_role_pools(client, season), await savant.get_season_statcast_pitcher_rates(client, season)

    from datetime import datetime, timezone

    result = PitcherRoleRankings(
        season=season,
        computed_at=datetime.now(timezone.utc).isoformat(),
        starters=_build_pool("starter", pools.starters, statcast),
        closers=_build_pool("closer", pools.closers, statcast),
        relievers=_build_pool("reliever", pools.relievers, statcast),
    )

    await db.write_snapshot(_cache_key(season), json.dumps(_rankings_to_json(result)))
    return result


async def get_cached_pitcher_role_rankings(season: int) -> PitcherRoleRankings | None:
    """Same bundle, but never recomputes — reads whatever's cached,
    however stale, and returns None if nothing's been computed yet this
    season. Safe to call from a live request path."""
    import json

    payload = await db.read_snapshot(_cache_key(season))
    if payload is None:
        return None
    try:
        return _rankings_from_json(json.loads(payload))
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
