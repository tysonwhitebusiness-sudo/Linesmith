"""Direct port of lib/sports/mlb/batterRankings.ts — not a
reimplementation.

Position-aware batter rankings — every batter ranked against the whole
qualified pool (overall_rank) and against just their position group
(position_rank), plus a composite 0-100 score blending the four Statcast
quality-of-contact metrics. Diagnostics-only, same scope note as
pitcher_rankings.py — not part of the live matchup/candidate pipeline.

Cache shape matches TS's BatterRankings/RankedBatter interfaces field-
for-field (camelCase JSON keys), same cache-sharing intent as
pitcher_rankings.py/savant.py.
"""
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

import db
from predict import savant, statsapi

# LF/CF/RF pool together — any one outfield spot alone is too small a
# pool to rank meaningfully against. Anything not listed here falls back
# to its own raw code rather than being silently dropped.
POSITION_GROUP: dict[str, str] = {
    "C": "C",
    "1B": "1B",
    "2B": "2B",
    "3B": "3B",
    "SS": "SS",
    "LF": "OF",
    "CF": "OF",
    "RF": "OF",
    "OF": "OF",
    "DH": "DH",
}


def _position_group_for(raw: str) -> str:
    return POSITION_GROUP.get(raw, raw)


# Traditional season rates/counts — a separate, simpler ranker from the
# Statcast composite: no gating thresholds, no position split, all six
# higher-is-better.
BATTER_TRADITIONAL_RANK_KEYS: list[tuple[str, str, int]] = [
    ("avg", "AVG", 3),
    ("obp", "OBP", 3),
    ("slg", "SLG", 3),
    ("ops", "OPS", 3),
    ("homeRuns", "HR", 0),
    ("rbi", "RBI", 0),
]

_TRADITIONAL_ATTR = {"avg": "avg", "obp": "obp", "slg": "slg", "ops": "ops", "homeRuns": "home_runs", "rbi": "rbi"}


def _rank_batters_traditional(rows: list[statsapi.RawBatterSeasonLine]) -> dict[int, dict[str, int]]:
    """1 = best, among every batter in `rows` that has a value for that stat."""
    ranks: dict[int, dict[str, int]] = {r.person_id: {} for r in rows}
    for key, _label, _decimals in BATTER_TRADITIONAL_RANK_KEYS:
        attr = _TRADITIONAL_ATTR[key]
        with_value = [r for r in rows if getattr(r, attr) is not None]
        with_value.sort(key=lambda r: getattr(r, attr), reverse=True)
        for i, r in enumerate(with_value):
            ranks[r.person_id][key] = i + 1
    return ranks


# Hand-set v1 weights — barrel%/hard-hit% (batted-ball authority) carry
# the most weight since they're the most direct read on contact quality;
# exit velo overlaps with both so gets less independent weight; whiff%
# (contact skill, not quality-of-contact) rounds it out.
#
# Keys are savant.py's own rank-dict keys (snake_case — its
# rank_batter_statcast output, built in an earlier phase of this port,
# uses barrel_pct/exit_velo/hard_hit_pct/whiff_pct, not TS's camelCase
# BatterStatcastKey spelling). The JSON cache serialization below
# translates to camelCase at the boundary so the on-disk shape still
# matches TS's BatterStatcastKey exactly.
COMPOSITE_WEIGHTS: dict[str, float] = {"barrel_pct": 0.3, "hard_hit_pct": 0.3, "exit_velo": 0.2, "whiff_pct": 0.2}


def _composite_score(ranks: dict[str, int], pool_size: int) -> float | None:
    if pool_size <= 1:
        return None
    # barrel_pct/exit_velo/hard_hit_pct are gated together by the same
    # battedBalls threshold (savant.py) — a batter has all three or none.
    # whiff_pct alone is too thin a profile to stand in for "quality of
    # contact" — requiring at least one of the batted-ball trio keeps a
    # composite from being computed on that alone.
    if ranks.get("barrel_pct") is None and ranks.get("exit_velo") is None and ranks.get("hard_hit_pct") is None:
        return None
    weighted_sum = 0.0
    weight_used = 0.0
    for key, weight in COMPOSITE_WEIGHTS.items():
        rank = ranks.get(key)
        if rank is None:
            continue
        percentile = 100 * (1 - (rank - 1) / (pool_size - 1))
        weighted_sum += percentile * weight
        weight_used += weight
    if weight_used == 0:
        return None
    return weighted_sum / weight_used


@dataclass
class RankedBatter:
    person_id: int
    full_name: str
    team_id: int | None
    position: str
    values: dict = field(default_factory=dict)
    overall_ranks: dict = field(default_factory=dict)
    position_ranks: dict = field(default_factory=dict)
    pool_size: int = 0
    position_pool_size: int = 0
    composite: float | None = None
    overall_rank: int | None = None
    position_composite: float | None = None
    position_rank: int | None = None
    traditional_values: dict = field(default_factory=dict)
    traditional_ranks: dict = field(default_factory=dict)
    traditional_pool_size: int = 0


def _build_pool(rows: list[statsapi.RawBatterSeasonLine], rates: dict[int, savant.StatcastRates]) -> tuple[list[RankedBatter], dict[int, dict[str, int]], int]:
    scoped_rates = {row.person_id: rates[row.person_id] for row in rows if row.person_id in rates}
    ranks = savant.rank_batter_statcast(scoped_rates)
    pool_size = len(scoped_rates)

    ranked: list[RankedBatter] = []
    for row in rows:
        if row.person_id not in scoped_rates:
            continue
        values = scoped_rates[row.person_id]
        person_ranks = ranks.get(row.person_id, {})
        composite = _composite_score(person_ranks, pool_size)
        ranked.append(
            RankedBatter(
                person_id=row.person_id,
                full_name=row.full_name,
                team_id=row.team_id,
                position=_position_group_for(row.position),
                values={"barrelPct": values.barrel_pct, "exitVelo": values.exit_velo, "hardHitPct": values.hard_hit_pct, "whiffPct": values.whiff_pct},
                overall_ranks=person_ranks,
                pool_size=pool_size,
                composite=composite,
            )
        )
    return ranked, ranks, pool_size


@dataclass
class BatterRankings:
    season: int
    computed_at: str
    batters: list[RankedBatter]


CACHE_TTL_MS = 24 * 60 * 60_000


def _cache_key(season: int) -> str:
    return f"mlb:batter-rankings:{season}"


async def get_batter_rankings(client: httpx.AsyncClient, season: int, force_refresh: bool = False) -> BatterRankings:
    """Position-and-overall-ranked, composite-scored batter pool — 24h
    cached so a normal page load never pays for a Statcast/StatsAPI
    refresh. `force_refresh` bypasses the cache."""
    if not force_refresh:
        cached = await db.read_snapshot_with_age(_cache_key(season))
        if cached is not None:
            payload, age_seconds = cached
            if age_seconds * 1000 < CACHE_TTL_MS:
                return _rankings_from_json(json.loads(payload))

    rows = await statsapi.get_league_batter_season_rows(client, season)
    rates = await savant.get_season_statcast_batter_rates(client, season)

    # Overall pool first — every qualified batter, whatever their position.
    overall_ranked, _overall_ranks, _overall_pool_size = _build_pool(rows, rates)
    overall_by_person_id = {b.person_id: b for b in overall_ranked}

    # Traditional AVG/OBP/SLG/OPS/HR/RBI — ranked against every batter
    # with a season row (not gated to the Statcast-qualified pool above).
    traditional_pool_size = len(rows)
    traditional_ranks_by_person_id = _rank_batters_traditional(rows)
    for row in rows:
        batter = overall_by_person_id.get(row.person_id)
        if batter is None:
            continue
        batter.traditional_values = {"avg": row.avg, "obp": row.obp, "slg": row.slg, "ops": row.ops, "homeRuns": row.home_runs, "rbi": row.rbi}
        batter.traditional_ranks = traditional_ranks_by_person_id.get(row.person_id, {})
        batter.traditional_pool_size = traditional_pool_size

    # Composite ties break on pitches seen, the closest proxy for playing
    # time this pipeline has — same "bigger, more trustworthy sample wins
    # an identical score" reasoning as pitcher_rankings.py's IP tiebreak.
    def sample_size_of(person_id: int) -> float:
        r = rates.get(person_id)
        return r.pitch_sample_size if r else 0

    overall_ranked.sort(key=lambda b: (-(b.composite if b.composite is not None else -1), -sample_size_of(b.person_id)))
    for i, b in enumerate(overall_ranked):
        b.overall_rank = i + 1 if b.composite is not None else None

    # Position pools — same rows/rates, grouped and re-ranked within each group.
    rows_by_position: dict[str, list[statsapi.RawBatterSeasonLine]] = {}
    for row in rows:
        group = _position_group_for(row.position)
        rows_by_position.setdefault(group, []).append(row)

    for position_rows in rows_by_position.values():
        position_ranked, _pos_ranks, position_pool_size = _build_pool(position_rows, rates)
        position_ranked.sort(key=lambda b: (-(b.composite if b.composite is not None else -1), -sample_size_of(b.person_id)))
        for i, pos_batter in enumerate(position_ranked):
            overall_batter = overall_by_person_id.get(pos_batter.person_id)
            if overall_batter is None:
                continue
            overall_batter.position_ranks = pos_batter.overall_ranks
            overall_batter.position_pool_size = position_pool_size
            overall_batter.position_composite = pos_batter.composite
            overall_batter.position_rank = i + 1 if pos_batter.composite is not None else None

    result = BatterRankings(season=season, computed_at=datetime.now(timezone.utc).isoformat(), batters=overall_ranked)
    await db.write_snapshot(_cache_key(season), json.dumps(_rankings_to_json(result)))
    return result


async def get_cached_batter_rankings(season: int) -> BatterRankings | None:
    """Same bundle, but never recomputes — reads whatever's cached,
    however stale, and returns None if nothing's been computed yet this
    season. Safe to call from a live request path."""
    payload = await db.read_snapshot(_cache_key(season))
    if payload is None:
        return None
    try:
        return _rankings_from_json(json.loads(payload))
    except (json.JSONDecodeError, KeyError, TypeError):
        return None


# savant.py's rank-dict keys (snake_case) -> TS's BatterStatcastKey
# spelling (camelCase) — see COMPOSITE_WEIGHTS's comment above for why
# these differ internally.
_RANK_KEY_TO_CAMEL = {"barrel_pct": "barrelPct", "exit_velo": "exitVelo", "hard_hit_pct": "hardHitPct", "whiff_pct": "whiffPct"}
_RANK_KEY_FROM_CAMEL = {v: k for k, v in _RANK_KEY_TO_CAMEL.items()}


def _ranks_to_json(ranks: dict) -> dict:
    return {_RANK_KEY_TO_CAMEL.get(k, k): v for k, v in ranks.items()}


def _ranks_from_json(d: dict) -> dict:
    return {_RANK_KEY_FROM_CAMEL.get(k, k): v for k, v in d.items()}


def _batter_to_json(b: RankedBatter) -> dict:
    return {
        "personId": b.person_id,
        "fullName": b.full_name,
        "teamId": b.team_id,
        "position": b.position,
        "values": b.values,
        "overallRanks": _ranks_to_json(b.overall_ranks),
        "positionRanks": _ranks_to_json(b.position_ranks),
        "poolSize": b.pool_size,
        "positionPoolSize": b.position_pool_size,
        "composite": b.composite,
        "overallRank": b.overall_rank,
        "positionComposite": b.position_composite,
        "positionRank": b.position_rank,
        "traditionalValues": b.traditional_values,
        "traditionalRanks": b.traditional_ranks,
        "traditionalPoolSize": b.traditional_pool_size,
    }


def _batter_from_json(d: dict) -> RankedBatter:
    return RankedBatter(
        person_id=d["personId"],
        full_name=d["fullName"],
        team_id=d.get("teamId"),
        position=d["position"],
        values=d.get("values") or {},
        overall_ranks=_ranks_from_json(d.get("overallRanks") or {}),
        position_ranks=_ranks_from_json(d.get("positionRanks") or {}),
        pool_size=d.get("poolSize") or 0,
        position_pool_size=d.get("positionPoolSize") or 0,
        composite=d.get("composite"),
        overall_rank=d.get("overallRank"),
        position_composite=d.get("positionComposite"),
        position_rank=d.get("positionRank"),
        traditional_values=d.get("traditionalValues") or {},
        traditional_ranks=d.get("traditionalRanks") or {},
        traditional_pool_size=d.get("traditionalPoolSize") or 0,
    )


def _rankings_to_json(r: BatterRankings) -> dict:
    return {"season": r.season, "computedAt": r.computed_at, "batters": [_batter_to_json(b) for b in r.batters]}


def _rankings_from_json(d: dict) -> BatterRankings:
    return BatterRankings(season=d["season"], computed_at=d["computedAt"], batters=[_batter_from_json(b) for b in d.get("batters") or []])
