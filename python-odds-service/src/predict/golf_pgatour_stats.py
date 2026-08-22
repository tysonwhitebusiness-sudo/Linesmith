"""Partial port of lib/sports/golf/pgatourStats.ts — not a
reimplementation of the parts it covers. Scoped to the season Strokes-
Gained scrape (`get_season_strokes_gained`) the prediction models
actually need; the "Advanced stats" 19-page board (`getGolferAdvancedStats`)
is a PlayerDetail display feature, not used by any of holeScoreModel/
roundScoreModel/tournamentWinModel, and isn't ported here.

PGA Tour's own season strokes-gained stats — free, official, no public
API: PGA Tour's stats pages are Next.js pages that embed their full data
payload as JSON in a `__NEXT_DATA__` script tag (react-query's dehydrated
cache) — this parses that same payload rather than the rendered HTML
table. Not a sanctioned/documented API — no contract; if PGA Tour changes
their frontend framework this extraction breaks, and there's no fallback
beyond returning an empty result and letting the caller degrade honestly.

PGA Tour's own player ids are a third id namespace, different from ESPN's
— resolved to the canonical ESPN athlete id via golf_player_matching.py.
"""
import json
import re
from dataclasses import dataclass

import httpx

import db
from predict.golf_player_matching import build_golf_roster_index, resolve_golfer

# SG:Total's own stat-detail page carries Total/Tee-to-Green/Putting
# together in one row.
_SG_TOTAL_STAT_ID = "02675"

_NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)</script>')


@dataclass
class _PgaTourStatRow:
    player_id: str
    player_name: str
    rank: int
    stats: list[dict]  # [{statName, statValue}]


@dataclass
class GolferStrokesGained:
    espn_id: str | None  # None when this golfer couldn't be matched to today's field
    pga_tour_player_id: str
    player_name: str
    rank: int
    avg_per_round: float | None  # SG:Total per round, this season
    total_season: float | None  # SG:Total, full season
    tee_to_green_season: float | None
    putting_season: float | None
    measured_rounds: float | None
    pool_size: int


def _stat_value(row: _PgaTourStatRow, label: str) -> float | None:
    entry = next((s for s in row.stats if s.get("statName") == label), None)
    if entry is None:
        return None
    try:
        n = float(entry.get("statValue"))
    except (TypeError, ValueError):
        return None
    return n if n == n else None


async def _fetch_stat_detail_rows(client: httpx.AsyncClient, stat_id: str, year: int) -> list[_PgaTourStatRow] | None:
    try:
        res = await client.get(f"https://www.pgatour.com/stats/detail/{stat_id}", headers={"User-Agent": "Mozilla/5.0 (compatible; Linesmith/1.0)"}, timeout=httpx.Timeout(30.0))
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None

    match = _NEXT_DATA_RE.search(res.text)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None

    queries = (((payload.get("props") or {}).get("pageProps") or {}).get("dehydratedState") or {}).get("queries") or []
    query = next((q for q in queries if (q.get("queryKey") or [None])[0] == "statDetails" and ((q.get("queryKey") or [None, {}])[1] or {}).get("year") == year and ((q.get("queryKey") or [None, {}])[1] or {}).get("eventQuery") is None), None)
    rows = ((query or {}).get("state") or {}).get("data", {}).get("rows") if query else None
    if not isinstance(rows, list):
        return None
    return [_PgaTourStatRow(player_id=r.get("playerId"), player_name=r.get("playerName"), rank=r.get("rank"), stats=r.get("stats") or []) for r in rows]


_CACHE_KEY_PREFIX = "golf:pgatour-sg:"
# Season-aggregate data that moves slowly — refetching more than daily
# buys nothing and just hammers a site with no formal API contract.
_TTL_MS = 24 * 60 * 60 * 1000


def _rows_to_json(rows: list[_PgaTourStatRow]) -> list[dict]:
    return [{"playerId": r.player_id, "playerName": r.player_name, "rank": r.rank, "stats": r.stats} for r in rows]


def _rows_from_json(data: list[dict]) -> list[_PgaTourStatRow]:
    return [_PgaTourStatRow(player_id=r["playerId"], player_name=r["playerName"], rank=r["rank"], stats=r.get("stats") or []) for r in data]


async def _load_season_rows(client: httpx.AsyncClient, year: int) -> list[_PgaTourStatRow]:
    cache_key = f"{_CACHE_KEY_PREFIX}{year}"
    cached = await db.read_snapshot_with_age(cache_key)
    if cached is not None:
        payload, age_seconds = cached
        if age_seconds * 1000 < _TTL_MS:
            return _rows_from_json(json.loads(payload))

    rows = await _fetch_stat_detail_rows(client, _SG_TOTAL_STAT_ID, year)
    if rows is None:
        if cached is not None:
            return _rows_from_json(json.loads(cached[0]))
        return []

    await db.write_snapshot(cache_key, json.dumps(_rows_to_json(rows)))
    return rows


async def get_season_strokes_gained(client: httpx.AsyncClient, subjects: list[tuple[str, str]], year: int) -> list[GolferStrokesGained]:
    """Season strokes-gained for the whole tour, matched against today's
    ESPN field. `subjects` is a list of (espn_id, name) pairs."""
    rows = await _load_season_rows(client, year)
    roster_index = build_golf_roster_index(subjects)

    golfers: list[GolferStrokesGained] = []
    for row in rows:
        matched = resolve_golfer(row.player_name, roster_index)
        golfers.append(
            GolferStrokesGained(
                espn_id=matched.espn_id if matched else None,
                pga_tour_player_id=row.player_id,
                player_name=row.player_name,
                rank=row.rank,
                avg_per_round=_stat_value(row, "Avg"),
                total_season=_stat_value(row, "Total SG:T"),
                tee_to_green_season=_stat_value(row, "Total SG:T2G"),
                putting_season=_stat_value(row, "Total SG:P"),
                measured_rounds=_stat_value(row, "Measured Rounds"),
                pool_size=len(rows),
            )
        )
    return golfers
