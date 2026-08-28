"""Understat — EPL's X (matchup-favorability) signal, Phase 3 of docs/
daily-picks-full-model-build-2026-08-27.md. Direct port of
lib/sports/soccer/understat.ts's buildUnderstatTeamDefenseIndex — real
team-level goals-against rate, the only real defensive signal Understat's
league-data endpoint actually offers (no per-position breakdown the way
NBA/NHL/NFL's boxscore-derived indexes have).

No cookie-priming needed, confirmed live on the TS side already: a plain
request with X-Requested-With: XMLHttpRequest against the real data
endpoints (not the HTML page) returns real JSON directly.

Understat is big-5-leagues only (EPL, La Liga, Serie A, Bundesliga,
Ligue 1) — EPL only, matching the TS reference. MLS has no Understat
coverage (user-confirmed 2026-08-27: no MLS X-signal for now, same
"absent, not fabricated" behavior every other unwired signal already
uses — see generic_dimension_configs.py's SOCCER_DIMENSIONS, shared by
both leagues, simply never gets a defense_index passed for MLS).

Single bucket, not per-position: because Understat only exposes one real
defensive rate (goals against per game), the index below carries one
key, "attacking", under TeamDefenseAllowed's normal rank/allowed_per_game
shape (so it still works with generic_matchup_defense.matchup_favorable
unchanged). Meaningful for SOCCER_DIMENSIONS's genuinely attacking-output
dimensions (assists/shots/shots-on-target); NOT meaningful for
yellow-cards (a discipline/referee signal, not matchup-favorability) or
saves (a GOALKEEPER's own stat — the relevant "matchup" for a keeper's
save count is the OPPONENT's attack strength, the inverse relationship,
not this team's own defense) — Phase 4's production job should only pass
this index for assists/shots/shots-on-target candidates, leaving the
other two at their existing matchup_favorable=None.
"""
import json
import re
from datetime import datetime, timezone

import httpx

from db import read_snapshot_with_age, write_snapshot
from predict.generic_matchup_defense import TeamDefenseAllowed

_BASE = "https://understat.com"
_HEADERS = {"X-Requested-With": "XMLHttpRequest"}

_SNAPSHOT_TTL_LEAGUE_S = 6 * 60 * 60


def current_understat_season() -> str:
    """Understat's season param is the year the season STARTS in (e.g.
    "2026" for the 2026-27 season) — season runs Aug-May, so before
    August still belongs to the previous year's season. Exact port of
    understat.ts's currentUnderstatSeason."""
    now = datetime.now(timezone.utc)
    return str(now.year if now.month >= 8 else now.year - 1)


def _normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


async def _fetch_json(path: str) -> dict | None:
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{_BASE}{path}", headers=_HEADERS, timeout=httpx.Timeout(10.0))
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except ValueError:
        return None


async def _fetch_league_data(season: str) -> dict | None:
    cache_key = f"soccer:understat:league:py:{season}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_LEAGUE_S:
        return json.loads(cached[0])
    data = await _fetch_json(f"/getLeagueData/EPL/{season}")
    if not data:
        return json.loads(cached[0]) if cached else None
    await write_snapshot(cache_key, json.dumps(data))
    return data


async def build_understat_team_defense_index(season: str | None = None, min_games: int = 3) -> dict[str, TeamDefenseAllowed]:
    """Merges the prior season's real rate underneath the current one for
    a team with fewer than `min_games` real matches so far this season —
    exact same early-season-thin-sample fallback understat.ts's own
    buildUnderstatTeamDefenseIndex uses. Index key is the normalized
    Understat team title (e.g. "arsenal") — see fuzzy_lookup_understat_
    defense for resolving an ESPN opponent name against it."""
    season = season or current_understat_season()
    prior_season = str(int(season) - 1)
    current, prior = await _fetch_league_data(season), await _fetch_league_data(prior_season)
    current_teams = (current or {}).get("teams") or {}
    prior_teams = (prior or {}).get("teams") or {}

    rates: dict[str, dict] = {}
    for team_id in set(current_teams) | set(prior_teams):
        current_team = current_teams.get(team_id)
        prior_team = prior_teams.get(team_id)
        use_team = current_team if current_team and len(current_team.get("history") or []) >= min_games else (prior_team or current_team)
        if not use_team:
            continue
        history = use_team.get("history") or []
        n = len(history)
        if n == 0:
            continue
        goals_against = sum(m.get("missed", 0) for m in history) / n
        goals_for = sum(m.get("scored", 0) for m in history) / n
        rates[use_team["title"]] = {"team_title": use_team["title"], "games_played": n, "goals_against": goals_against, "goals_for": goals_for}

    ordered = sorted(rates.values(), key=lambda r: r["goals_against"])
    index: dict[str, TeamDefenseAllowed] = {}
    for i, r in enumerate(ordered):
        key = _normalize_name(r["team_title"])
        index[key] = TeamDefenseAllowed(
            abbr=key,
            games_played=r["games_played"],
            pool_size=len(ordered),
            allowed_per_game={"attacking": r["goals_against"]},
            rank={"attacking": i + 1},
        )
    return index


def fuzzy_lookup_understat_defense(index: dict[str, TeamDefenseAllowed], espn_team_name: str) -> TeamDefenseAllowed | None:
    """ESPN's team names are full official names ("Brighton & Hove
    Albion"); Understat's are its own shorter convention ("Brighton") — a
    plain normalized-equality check misses every real match. Exact port
    of matchUnderstatTeamName's substring-both-directions fallback (a
    small, known ~20-team pool has no real collision risk the way
    person-name fuzzy matching does)."""
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
