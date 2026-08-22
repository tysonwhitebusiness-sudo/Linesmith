"""Direct port of lib/sports/mlb/savant.ts — not a reimplementation.
Baseball Savant / Statcast client — pitcher/batter quality metrics
(whiff%, barrel%, exit velocity, hard-hit%) that MLB StatsAPI doesn't carry.

The `statcast_search/csv` endpoint is the same public, keyless endpoint
Savant's own "Download CSV" button hits — no auth headers, no request
signing. It caps a single query at roughly 25,000 rows, so this never asks
for more than a season in one shot: it fetches in ~6-day chunks (safely
under the cap) and folds each chunk into a running per-player aggregate
rather than re-requesting the season from scratch.

Three disclosed adaptations, none a behavior change a caller could observe:
- Every function takes `client: httpx.AsyncClient` as an explicit first
  argument, matching statsapi.py's convention rather than TS's implicit
  global `fetch`.
- CSV parsing uses Python's stdlib `csv` module (RFC 4180 quote handling)
  in place of the TS source's hand-rolled quote-aware line splitter — same
  behavior for well-formed CSV, and `text.splitlines()` (not `.split('\n')`)
  strips a trailing `\r` per line that the TS source's own split leaves in
  the last column on a CRLF response; JS's `Number()` silently trims that
  whitespace on numeric fields but a string-compared field (e.g.
  `description`) would not, so this is a small correctness improvement,
  not a divergence from the intended behavior.
- The cache key (`mlb:statcast-agg:{season}:v2`) is IDENTICAL to the TS
  source's own — deliberate, not a collision: Python becomes the writer,
  and the TS app's readers of the same `snapshot_cache` row keep working
  unmodified, same "Python writes, TS reads" cutover already used for
  player props (see jobs.py's own module docstring).

Everything else — batching by date range, bounded chunk concurrency,
barrel/hard-hit/whiff thresholds — is preserved verbatim.
"""
import asyncio
import csv
import json
from dataclasses import dataclass, field

import httpx

import db
from predict.statsapi import eastern_date, shift_date

SAVANT_BASE = "https://baseballsavant.mlb.com/statcast_search/csv"

# ---------------------------------------------------------------------------
# Ingest: one Savant CSV query -> folded into per-pitcher/per-batter aggregates
# ---------------------------------------------------------------------------


def _is_barrel(exit_velo: float, launch_angle: float) -> bool:
    """Simplified barrel definition — the real MLB formula widens the
    qualifying launch-angle range as exit velocity climbs past 98 mph. This
    fixed 26-30 degree band at 98+ mph captures the core of it without
    porting the full lookup table — a v1 approximation, same as the TS
    source."""
    return exit_velo >= 98 and 26 <= launch_angle <= 30


HARD_HIT_EXIT_VELO = 95

SWING_DESCRIPTIONS = {
    "hit_into_play",
    "foul",
    "foul_tip",
    "foul_bunt",
    "swinging_strike",
    "swinging_strike_blocked",
    "missed_bunt",
}
WHIFF_DESCRIPTIONS = {"swinging_strike", "swinging_strike_blocked", "missed_bunt"}


@dataclass
class PitcherStatcastAgg:
    """Identical bookkeeping whichever side of the pitch it's keyed by —
    `by_pitcher` counts what a pitcher allowed, `by_batter` counts what a
    hitter produced off the same rows."""

    person_id: int
    full_name: str
    pitches: int = 0
    swings: int = 0
    whiffs: int = 0
    batted_balls: int = 0
    sum_exit_velo: float = 0.0
    barrels: int = 0
    hard_hit_balls: int = 0


def _finite(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


async def _ingest_date_range(
    client: httpx.AsyncClient,
    start_date: str,
    end_date: str,
    into_pitcher: dict[int, PitcherStatcastAgg],
    into_batter: dict[int, PitcherStatcastAgg],
) -> None:
    """One request, one date range (inclusive both ends), folded into
    `into_pitcher` (pitcher-perspective) and `into_batter` (batter-
    perspective) in place — same rows, two keys, one query and one parse
    pass. `player_type: pitcher` only affects which side `player_name`
    names; the `batter`/`pitcher` id columns are always present regardless,
    so a batter row's name is left blank (nothing downstream reads it)."""
    params = {
        "all": "true",
        "hfGT": "R|PO|S|=",
        "player_type": "pitcher",
        "type": "details",
        "group_by": "name",
        "sort_col": "pitches",
        "player_event_sort": "h_launch_speed",
        "sort_order": "desc",
        "min_pitches": "0",
        "min_results": "0",
        "min_abs": "0",
        "game_date_gt": start_date,
        "game_date_lt": end_date,
    }
    res = await client.get(SAVANT_BASE, params=params, timeout=httpx.Timeout(60.0))
    res.raise_for_status()
    text = res.text.lstrip("﻿")

    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return
    rows = list(csv.reader(lines))
    header = rows[0]

    def idx(name: str) -> int:
        return header.index(name) if name in header else -1

    pitcher_idx = idx("pitcher")
    batter_idx = idx("batter")
    name_idx = idx("player_name")
    type_idx = idx("type")
    desc_idx = idx("description")
    ls_idx = idx("launch_speed")
    la_idx = idx("launch_angle")
    # header shape changed / empty result — skip rather than mis-parse
    if pitcher_idx < 0 or type_idx < 0 or desc_idx < 0:
        return

    def fold(
        m: dict[int, PitcherStatcastAgg],
        person_id: int,
        name: str,
        description: str,
        is_batted_ball: bool,
        exit_velo: float | None,
        launch_angle: float | None,
    ) -> None:
        agg = m.get(person_id)
        if agg is None:
            agg = PitcherStatcastAgg(person_id=person_id, full_name=name)
            m[person_id] = agg

        agg.pitches += 1
        if description in SWING_DESCRIPTIONS:
            agg.swings += 1
            if description in WHIFF_DESCRIPTIONS:
                agg.whiffs += 1

        if is_batted_ball and exit_velo is not None:
            agg.batted_balls += 1
            agg.sum_exit_velo += exit_velo
            if exit_velo >= HARD_HIT_EXIT_VELO:
                agg.hard_hit_balls += 1
            if launch_angle is not None and _is_barrel(exit_velo, launch_angle):
                agg.barrels += 1

    for cols in rows[1:]:
        if not cols:
            continue
        pitcher_id = _finite(cols[pitcher_idx]) if pitcher_idx < len(cols) else None
        description = cols[desc_idx] if desc_idx < len(cols) else ""
        is_batted_ball = (cols[type_idx] if type_idx < len(cols) else "") == "X"
        exit_velo = _finite(cols[ls_idx]) if 0 <= ls_idx < len(cols) else None
        launch_angle = _finite(cols[la_idx]) if 0 <= la_idx < len(cols) else None

        if pitcher_id is not None:
            name = cols[name_idx] if 0 <= name_idx < len(cols) else ""
            fold(into_pitcher, int(pitcher_id), name, description, is_batted_ball, exit_velo, launch_angle)

        if 0 <= batter_idx < len(cols):
            batter_id = _finite(cols[batter_idx])
            if batter_id is not None:
                fold(into_batter, int(batter_id), "", description, is_batted_ball, exit_velo, launch_angle)


# ---------------------------------------------------------------------------
# Season aggregate store — TTL-free, cursor-based incremental backfill
# ---------------------------------------------------------------------------


@dataclass
class StatcastAggregateStore:
    season: int
    # Last calendar date (US Eastern) whose pitches are already folded into
    # by_pitcher/by_batter — the next refresh only needs everything after
    # this. Both maps are derived from the identical date-range pull, so
    # one cursor covers both.
    last_ingested_date: str | None
    by_pitcher: dict[int, PitcherStatcastAgg] = field(default_factory=dict)
    by_batter: dict[int, PitcherStatcastAgg] = field(default_factory=dict)


def _cache_key(season: int) -> str:
    return f"mlb:statcast-agg:{season}:v2"


def _agg_to_json(agg: PitcherStatcastAgg) -> dict:
    return {
        "personId": agg.person_id,
        "fullName": agg.full_name,
        "pitches": agg.pitches,
        "swings": agg.swings,
        "whiffs": agg.whiffs,
        "battedBalls": agg.batted_balls,
        "sumExitVelo": agg.sum_exit_velo,
        "barrels": agg.barrels,
        "hardHitBalls": agg.hard_hit_balls,
    }


def _agg_from_json(d: dict) -> PitcherStatcastAgg:
    return PitcherStatcastAgg(
        person_id=d.get("personId"),
        full_name=d.get("fullName") or "",
        pitches=d.get("pitches") or 0,
        swings=d.get("swings") or 0,
        whiffs=d.get("whiffs") or 0,
        batted_balls=d.get("battedBalls") or 0,
        sum_exit_velo=d.get("sumExitVelo") or 0.0,
        barrels=d.get("barrels") or 0,
        hard_hit_balls=d.get("hardHitBalls") or 0,
    )


async def _load_store(season: int) -> StatcastAggregateStore:
    cached = await db.read_snapshot(_cache_key(season))
    if cached:
        try:
            parsed = json.loads(cached)
            if parsed.get("season") == season and parsed.get("byPitcher") is not None:
                return StatcastAggregateStore(
                    season=season,
                    last_ingested_date=parsed.get("lastIngestedDate"),
                    by_pitcher={int(k): _agg_from_json(v) for k, v in (parsed.get("byPitcher") or {}).items()},
                    by_batter={int(k): _agg_from_json(v) for k, v in (parsed.get("byBatter") or {}).items()},
                )
        except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
            pass  # fall through to a fresh store
    return StatcastAggregateStore(season=season, last_ingested_date=None, by_pitcher={}, by_batter={})


async def _save_store(store: StatcastAggregateStore) -> None:
    payload = json.dumps(
        {
            "season": store.season,
            "lastIngestedDate": store.last_ingested_date,
            "byPitcher": {str(pid): _agg_to_json(agg) for pid, agg in store.by_pitcher.items()},
            "byBatter": {str(pid): _agg_to_json(agg) for pid, agg in store.by_batter.items()},
        }
    )
    await db.write_snapshot(_cache_key(store.season), payload)


CHUNK_DAYS = 6  # ~3,000 rows/day * 6 ~= 18,000, safely under Savant's ~25,000-row cap per request
# A season-long backfill is dozens of chunks — a handful concurrently is
# still a polite request rate, not a hammering one.
CONCURRENT_CHUNK_FETCHES = 5


async def _map_limit(items: list, limit: int, fn) -> None:
    """Bounded-concurrency map — same reasoning as statsapi.py's
    `_map_limit`: no lock needed around `next_index` since Python asyncio
    is single-threaded cooperative concurrency and there's no `await`
    between reading and incrementing it."""
    next_index = 0

    async def worker():
        nonlocal next_index
        while next_index < len(items):
            i = next_index
            next_index += 1
            await fn(items[i])

    await asyncio.gather(*(worker() for _ in range(min(limit, len(items)))))


# De-duped per season via `_in_flight`: a caller that wants both pitcher and
# batter rates on a cold cache would otherwise kick off two independent full
# backfills in parallel — doubling the Savant request volume for no reason,
# since both read the same underlying store. A concurrent second call just
# awaits the first call's task instead.
_in_flight: dict[int, "asyncio.Task[StatcastAggregateStore]"] = {}


def _ensure_fresh(client: httpx.AsyncClient, season: int) -> "asyncio.Task[StatcastAggregateStore]":
    existing = _in_flight.get(season)
    if existing is not None:
        return existing

    async def run() -> StatcastAggregateStore:
        try:
            return await _ensure_fresh_uncached(client, season)
        finally:
            _in_flight.pop(season, None)

    task = asyncio.create_task(run())
    _in_flight[season] = task
    return task


async def _ensure_fresh_uncached(client: httpx.AsyncClient, season: int) -> StatcastAggregateStore:
    """Brings the season's Statcast aggregate up to date through yesterday
    (US Eastern) — today's games aren't finished, so they're deliberately
    excluded rather than ingested half-complete. A fresh season starts from
    March 1 (a safe pre-Opening-Day floor)."""
    store = await _load_store(season)
    through_date = shift_date(eastern_date(), -1)
    season_floor = f"{season}-03-01"
    cursor = shift_date(store.last_ingested_date, 1) if store.last_ingested_date else season_floor
    if cursor > through_date:
        return store  # already fresh through yesterday

    by_pitcher = dict(store.by_pitcher)
    by_batter = dict(store.by_batter)

    chunks: list[tuple[str, str]] = []
    chunk_start = cursor
    while chunk_start <= through_date:
        candidate_end = shift_date(chunk_start, CHUNK_DAYS - 1)
        chunk_end = through_date if candidate_end > through_date else candidate_end
        chunks.append((chunk_start, chunk_end))
        chunk_start = shift_date(chunk_end, 1)

    # Savant's own gt/lt params are exclusive, so each request widens by one
    # day on each side to make the fetched range inclusive of [start, end].
    async def fetch_chunk(bounds: tuple[str, str]) -> None:
        start, end = bounds
        await _ingest_date_range(client, shift_date(start, -1), shift_date(end, 1), by_pitcher, by_batter)

    await _map_limit(chunks, CONCURRENT_CHUNK_FETCHES, fetch_chunk)

    updated = StatcastAggregateStore(season=season, last_ingested_date=through_date, by_pitcher=by_pitcher, by_batter=by_batter)
    await _save_store(updated)
    return updated


# ---------------------------------------------------------------------------
# Rates
# ---------------------------------------------------------------------------


@dataclass
class StatcastRates:
    whiff_pct: float | None
    barrel_pct: float | None
    exit_velo: float | None
    hard_hit_pct: float | None
    # Pitches sampled — small samples are why a composite scorer should
    # down-weight this bucket per-player, same idea as the props model's
    # dampenForSample.
    pitch_sample_size: int


MIN_SWINGS_FOR_WHIFF_RATE = 20
MIN_BATTED_BALLS_FOR_QUALITY_RATE = 15


def _rates_from_aggs(aggs: dict[int, PitcherStatcastAgg]) -> dict[int, StatcastRates]:
    out: dict[int, StatcastRates] = {}
    for agg in aggs.values():
        out[agg.person_id] = StatcastRates(
            whiff_pct=(agg.whiffs / agg.swings) * 100 if agg.swings >= MIN_SWINGS_FOR_WHIFF_RATE else None,
            barrel_pct=(agg.barrels / agg.batted_balls) * 100 if agg.batted_balls >= MIN_BATTED_BALLS_FOR_QUALITY_RATE else None,
            exit_velo=agg.sum_exit_velo / agg.batted_balls if agg.batted_balls >= MIN_BATTED_BALLS_FOR_QUALITY_RATE else None,
            hard_hit_pct=(agg.hard_hit_balls / agg.batted_balls) * 100 if agg.batted_balls >= MIN_BATTED_BALLS_FOR_QUALITY_RATE else None,
            pitch_sample_size=agg.pitches,
        )
    return out


async def get_season_statcast_pitcher_rates(client: httpx.AsyncClient, season: int) -> dict[int, StatcastRates]:
    """Season-to-date Statcast rate stats per pitcher, refreshing the
    underlying aggregate first if it's stale. For the diagnostics-triggered
    refresh path — see `get_cached_statcast_pitcher_rates` for the version
    safe to call from a live request."""
    store = await _ensure_fresh(client, season)
    return _rates_from_aggs(store.by_pitcher)


async def get_cached_statcast_pitcher_rates(season: int) -> dict[int, StatcastRates]:
    """Same rates, but never triggers a live Savant fetch — reads only
    whatever's already cached, even if stale. If nothing has ever been
    cached for this season yet, returns an empty dict — callers should
    treat that as "no Statcast data available yet", not an error."""
    store = await _load_store(season)
    return _rates_from_aggs(store.by_pitcher)


async def get_season_statcast_batter_rates(client: httpx.AsyncClient, season: int) -> dict[int, StatcastRates]:
    store = await _ensure_fresh(client, season)
    return _rates_from_aggs(store.by_batter)


async def get_cached_statcast_batter_rates(season: int) -> dict[int, StatcastRates]:
    store = await _load_store(season)
    return _rates_from_aggs(store.by_batter)


# ---------------------------------------------------------------------------
# League-wide batter ranking on Statcast quality metrics alone
# ---------------------------------------------------------------------------

BATTER_STATCAST_RANK_KEYS: list[tuple[str, str, int]] = [
    ("barrel_pct", "barrel%", 1),
    ("exit_velo", "avg exit velocity", 1),
    ("hard_hit_pct", "hard-hit%", 1),
    ("whiff_pct", "whiff%", 1),
]

# For a batter, high barrel%/exit velo/hard-hit% is good — they're squaring
# the ball up — and low whiff% is good — they're making contact.
BATTER_STATCAST_LOWER_IS_BETTER = {"whiff_pct"}


def rank_batter_statcast(rates: dict[int, StatcastRates]) -> dict[int, dict[str, int]]:
    """Rank every batter with a qualifying rate this season against each
    other, 1 = best."""
    ranks: dict[int, dict[str, int]] = {pid: {} for pid in rates.keys()}

    for key, _label, _decimals in BATTER_STATCAST_RANK_KEYS:
        lower_is_better = key in BATTER_STATCAST_LOWER_IS_BETTER
        with_value = [(pid, getattr(r, key)) for pid, r in rates.items() if getattr(r, key) is not None]
        with_value.sort(key=lambda t: t[1], reverse=not lower_is_better)
        for index, (pid, _v) in enumerate(with_value):
            ranks[pid][key] = index + 1

    return ranks
