"""CollegeFootballData.com — CFB's X (matchup-favorability) signal, Phase 3
of docs/daily-picks-full-model-build-2026-08-27.md. Direct port of
lib/sports/cfb/cfbd.ts's real, already-proven-live CFBD calls plus
lib/sports/cfb/teamDefenseAllowed.ts's aggregation logic, reusing the same
CFBD_API_KEY account the TS side already uses (user-confirmed 2026-08-27:
reuse, not a separate key — see config.py's own CFBD_API_KEY docstring and
render.yaml).

Real gotcha ported over from cfbd.ts, not rediscovered: CFBD's
/games/players endpoint requires `year` plus one of `week`/`team`/
`conference` — a bare `gameId` filter (even with `year`) gets a 400. The
real, efficient shape confirmed live on the TS side is `year`+`team`,
which returns a team's ENTIRE season's box scores in one call — one
request per team per season, not one per game.

Position-group buckets here match NFL's own "passing"/"rushing"/
"receiving" stat-category convention (generic_matchup_defense.py's
_nfl_position_group) rather than CFBD's own box-score category names
directly, so a CFB candidate's position_group (from CFB_DIMENSIONS, which
reuses NFL_DIMENSIONS verbatim) resolves against this index the same way
an NFL candidate resolves against build_nfl_team_defense_index's.

Indexed by NORMALIZED CFBD school name (e.g. "alabama"), not an ESPN team
id/abbr — CFBD has no crosswalk to ESPN's own team ids (same real gap
cfbd.ts's own module docstring discloses). fuzzy_lookup_cfb_defense below
is the same normalized-then-substring fallback fuzzyLookupCfbTeamDefenseAllowed
already uses on the TS side, for a caller that only has ESPN's own team
display name for the opponent.
"""
import json
import re
from dataclasses import dataclass

import httpx

import config
from db import read_snapshot_with_age, write_snapshot
from predict.generic_matchup_defense import TeamDefenseAllowed, _rank_of

_BASE = "https://api.collegefootballdata.com"

_SNAPSHOT_TTL_TEAMS_S = 24 * 60 * 60
_SNAPSHOT_TTL_GAMES_S = 6 * 60 * 60
_SNAPSHOT_TTL_BOXSCORES_S = 6 * 60 * 60
_SNAPSHOT_TTL_LEADERBOARD_S = 24 * 60 * 60


def current_cfbd_season() -> str:
    """CFB season year is the fall the season starts in — season runs
    Aug-Jan, so Jan-Jun still belongs to the previous fall's season.
    Exact port of cfbd.ts's currentCfbdSeason."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    return str(now.year if now.month >= 7 else now.year - 1)


def _normalize_name(name: str) -> str:
    """Lowercase, strip punctuation/whitespace-runs — same normalization
    weight lib/odds/screenshotImport.ts's normalizeName applies (this file
    doesn't need that module's fuzzy person-name scoring, just its
    school-name-safe normalization)."""
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


async def _fetch_json(path: str, timeout_s: float = 15.0) -> object | None:
    if not config.CFBD_API_KEY:
        return None
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{_BASE}{path}", headers={"Authorization": f"Bearer {config.CFBD_API_KEY}"}, timeout=httpx.Timeout(timeout_s))
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except ValueError:
        return None


async def fetch_fbs_team_names() -> list[str]:
    cache_key = "cfb:cfbd:fbs-teams:py"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_TEAMS_S:
        return json.loads(cached[0])
    data = await _fetch_json(f"/teams/fbs?year={current_cfbd_season()}")
    if not data:
        return json.loads(cached[0]) if cached else []
    names = [t["school"] for t in data if t.get("school")]
    await write_snapshot(cache_key, json.dumps(names))
    return names


async def _fetch_team_games(team: str, season: str) -> list[dict]:
    cache_key = f"cfb:cfbd:games:py:{season}:{team}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_GAMES_S:
        return json.loads(cached[0])
    data = await _fetch_json(f"/games?year={season}&team={team}")
    if not data:
        return json.loads(cached[0]) if cached else []
    await write_snapshot(cache_key, json.dumps(data))
    return data


async def _fetch_team_season_box_scores(team: str, season: str) -> list[dict]:
    cache_key = f"cfb:cfbd:boxscores:py:{season}:{team}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_BOXSCORES_S:
        return json.loads(cached[0])
    data = await _fetch_json(f"/games/players?year={season}&team={team}")
    if not data:
        return json.loads(cached[0]) if cached else []
    await write_snapshot(cache_key, json.dumps(data))
    return data


def _category_total(team_box: dict | None, category: str, stat_type: str) -> float:
    if not team_box:
        return 0.0
    cat = next((c for c in team_box.get("categories") or [] if c.get("name") == category), None)
    if not cat:
        return 0.0
    t = next((ty for ty in cat.get("types") or [] if ty.get("name") == stat_type), None)
    if not t:
        return 0.0
    total = 0.0
    for a in t.get("athletes") or []:
        try:
            total += float(a.get("stat"))
        except (TypeError, ValueError):
            continue
    return total


async def build_cfb_team_defense_index(season: str | None = None, min_games: int = 15, team_names: list[str] | None = None) -> dict[str, TeamDefenseAllowed]:
    """`team_names` override is for testing a small slice without paying
    the full ~130-FBS-team cold-rebuild cost (one /games + one
    /games/players call per team) — omit it for a real leaderboard. Index
    key is the NORMALIZED CFBD school name — see fuzzy_lookup_cfb_defense
    for resolving an ESPN opponent name against it."""
    season = season or current_cfbd_season()
    cache_key = f"cfb:defenseAllowed:leaderboard:py:{season}:{min_games}"
    if team_names is None:
        cached = await read_snapshot_with_age(cache_key)
        if cached and cached[1] < _SNAPSHOT_TTL_LEADERBOARD_S:
            raw = json.loads(cached[0])
            return {abbr: TeamDefenseAllowed(**v) for abbr, v in raw.items()}

    names = team_names if team_names is not None else await fetch_fbs_team_names()
    rows: list[dict] = []
    for team in names:
        all_games = await _fetch_team_games(team, season)
        box_scores = await _fetch_team_season_box_scores(team, season)
        games = [g for g in all_games if g.get("completed")]
        box_by_id = {b["id"]: b for b in box_scores if b.get("id") is not None}
        if len(games) < min_games:
            prior_season = str(int(season) - 1)
            prior_games = await _fetch_team_games(team, prior_season)
            prior_box_scores = await _fetch_team_season_box_scores(team, prior_season)
            games = [g for g in prior_games if g.get("completed")] + games
            for b in prior_box_scores:
                if b.get("id") is not None:
                    box_by_id[b["id"]] = b

        played = 0
        passing_yds = rushing_yds = receiving_yds = 0.0
        for g in games:
            box = box_by_id.get(g.get("id"))
            if not box:
                continue
            opponent_box = next((t for t in box.get("teams") or [] if t.get("team") != team), None)
            if not opponent_box:
                continue
            played += 1
            passing_yds += _category_total(opponent_box, "passing", "YDS")
            rushing_yds += _category_total(opponent_box, "rushing", "YDS")
            receiving_yds += _category_total(opponent_box, "receiving", "YDS")
        if played == 0:
            continue
        rows.append({"abbr": _normalize_name(team), "games_played": played, "passing": passing_yds / played, "rushing": rushing_yds / played, "receiving": receiving_yds / played})

    passing_ranks = _rank_of(rows, "passing")
    rushing_ranks = _rank_of(rows, "rushing")
    receiving_ranks = _rank_of(rows, "receiving")
    index: dict[str, TeamDefenseAllowed] = {}
    for r in rows:
        index[r["abbr"]] = TeamDefenseAllowed(
            abbr=r["abbr"],
            games_played=r["games_played"],
            pool_size=len(rows),
            allowed_per_game={"passing": r["passing"], "rushing": r["rushing"], "receiving": r["receiving"]},
            rank={"passing": passing_ranks[r["abbr"]], "rushing": rushing_ranks[r["abbr"]], "receiving": receiving_ranks[r["abbr"]]},
        )
    if team_names is None:
        await write_snapshot(cache_key, json.dumps({abbr: v.__dict__ for abbr, v in index.items()}))
    return index


def fuzzy_lookup_cfb_defense(index: dict[str, TeamDefenseAllowed], espn_team_name: str) -> TeamDefenseAllowed | None:
    """Exact normalized match first, then substring either-direction —
    same fallback shape fuzzyLookupCfbTeamDefenseAllowed uses on the TS
    side for the identical ESPN-name-vs-CFBD-school-name gap (CFBD has no
    crosswalk to ESPN's own team ids)."""
    normalized_espn = _normalize_name(espn_team_name)
    if not normalized_espn:
        return None
    exact = index.get(normalized_espn)
    if exact:
        return exact
    for key, entry in index.items():
        if key and (normalized_espn in key or key in normalized_espn):
            return entry
    return None
