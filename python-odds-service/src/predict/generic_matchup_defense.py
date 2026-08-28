"""Real per-sport 'opponent allows more of stat X to position group Y than
average' leaderboards — the X (matchup-favorability) signal
predict/generic_prop_score.py's own module docstring disclosed as unwired.
Direct port of lib/sports/{nba,nhl}/teamDefenseAllowed.ts's proven rolling-
window methodology (last 15 real completed games per team, prior-season
fallback when the current season doesn't have 15 yet) — same "L15" window
convention this codebase already uses elsewhere (cfbd.ts's
loadCfbdTeamContext).

Both sports' real data sources were re-verified live during this build
(2026-08-27), not assumed from the TS source: NHL's official API
(api-web.nhle.com) matches nhle.ts's shape exactly; NBA's ESPN endpoints
were flagged "UNVERIFIED against a live response" in boxscore.ts's own
header (that sandbox's network blocked site.api.espn.com outright) — this
environment can reach it, and every endpoint used here was checked
against a real live payload before being trusted.

NFL added same day (Phase 3 of docs/daily-picks-full-model-build-
2026-08-27.md) — same ESPN-boxscore-aggregation approach, no new external
dependency. CFB/Soccer still need their own, separate data-source
integrations (CFBD API key, an Understat scraper port) — see that doc's
own Phase 3 section for the real, flagged non-code dependencies.

Team-discovery gotcha found live: both NHL/NBA are currently off-season
(2026-08-27) — NHL's /standings/now and NBA's forward-looking scoreboard
both come back genuinely empty, not an error. Falls back to a fixed
recent in-season date/range (confirmed live to have full 32/30-team
coverage) when the live query is empty — same "revert to a known-good
recent state" shape the last-N-completed-games logic already uses one
level down. NFL's own discovery window is a full month, not one day —
unlike NBA/NHL it's real, actively in preseason right now (real games
exist to discover teams from, just not every single day), so a longer
default window avoids needing a separate off-season fallback at all.
"""
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

import backfill_player_game_history as bph
from db import read_snapshot_with_age, write_snapshot

_NHL_BASE = "https://api-web.nhle.com/v1"
_NBA_ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
_NFL_ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"

_SNAPSHOT_TTL_SCHEDULE_S = 6 * 60 * 60
_SNAPSHOT_TTL_BOXSCORE_S = 6 * 60 * 60
_SNAPSHOT_TTL_LEADERBOARD_S = 24 * 60 * 60

# Known in-season fallback windows, used only when a live "current season"
# query comes back genuinely empty (off-season) — real, verified-live
# dates from the most recently completed season, not a guess.
_NHL_FALLBACK_STANDINGS_DATE = "2025-04-15"
_NBA_FALLBACK_SCOREBOARD_RANGE = "20250401-20250415"


@dataclass
class TeamDefenseAllowed:
    abbr: str
    games_played: int
    pool_size: int
    allowed_per_game: dict[str, float]  # position_group -> stat allowed per game
    rank: dict[str, int]  # position_group -> rank, 1 = fewest allowed (best defense)


def matchup_favorable(index: dict[str, TeamDefenseAllowed], opponent_abbr: str | None, position_group: str | None) -> bool | None:
    """True when the opponent's real rank for this position group's stat
    sits in the worse (allows-more) half of the pool — favorable for an
    'over' on that stat. None (not False) when there's no real data to
    judge by, matching this app's "absent, not fabricated" rule for a
    number it can't stand behind."""
    if not opponent_abbr or not position_group:
        return None
    entry = index.get(opponent_abbr)
    if entry is None or position_group not in entry.rank or entry.pool_size <= 1:
        return None
    rank = entry.rank[position_group]
    return rank > entry.pool_size / 2


def _rank_of(rows: list[dict], key: str) -> dict[str, int]:
    """1 = fewest allowed (best defense) — ascending, matches every TS
    leaderboard's own ranking direction for an 'allowed' stat."""
    ordered = sorted(rows, key=lambda r: r[key])
    return {r["abbr"]: i + 1 for i, r in enumerate(ordered)}


# ---------------------------------------------------------------------------
# NHL — official API (api-web.nhle.com), no key required
# ---------------------------------------------------------------------------


def _nhl_position_group(position: str) -> str:
    return "forwards" if position in ("C", "L", "R") else "defense"


def current_nhl_season() -> str:
    now = datetime.now(timezone.utc)
    start_year = now.year if now.month >= 10 else now.year - 1
    return f"{start_year}{start_year + 1}"


async def _fetch_nhl_current_team_abbrs(client: httpx.AsyncClient) -> list[str]:
    try:
        res = await client.get(f"{_NHL_BASE}/standings/now", timeout=httpx.Timeout(15.0))
        data = res.json() if res.status_code == 200 else {}
    except httpx.HTTPError:
        data = {}
    standings = data.get("standings") or []
    if not standings:
        try:
            res = await client.get(f"{_NHL_BASE}/standings/{_NHL_FALLBACK_STANDINGS_DATE}", timeout=httpx.Timeout(15.0))
            data = res.json() if res.status_code == 200 else {}
        except httpx.HTTPError:
            data = {}
        standings = data.get("standings") or []
    return sorted({s["teamAbbrev"]["default"] for s in standings if s.get("teamAbbrev", {}).get("default")})


async def _fetch_nhl_team_schedule(client: httpx.AsyncClient, abbr: str, season: str) -> list[dict]:
    cache_key = f"nhl:schedule:{season}:{abbr}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_SCHEDULE_S:
        return json.loads(cached[0])
    try:
        res = await client.get(f"{_NHL_BASE}/club-schedule-season/{abbr}/{season}", timeout=httpx.Timeout(15.0))
    except httpx.HTTPError:
        return json.loads(cached[0]) if cached else []
    if res.status_code != 200:
        return json.loads(cached[0]) if cached else []
    data = res.json()
    games = [
        {"gameId": str(g["id"]), "date": (g.get("gameDate") or g.get("startTimeUTC", ""))[:10], "gameState": g.get("gameState")}
        for g in data.get("games") or []
        if g.get("gameType") == 2
    ]
    await write_snapshot(cache_key, json.dumps(games))
    return games


async def _fetch_nhl_boxscore(client: httpx.AsyncClient, game_id: str) -> dict | None:
    cache_key = f"nhl:boxscore:{game_id}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_BOXSCORE_S:
        return json.loads(cached[0])
    try:
        res = await client.get(f"{_NHL_BASE}/gamecenter/{game_id}/boxscore", timeout=httpx.Timeout(15.0))
    except httpx.HTTPError:
        return json.loads(cached[0]) if cached else None
    if res.status_code != 200:
        return json.loads(cached[0]) if cached else None
    data = res.json()
    pbgs = data.get("playerByGameStats") or {}

    def to_skaters(side: str) -> list[dict]:
        t = pbgs.get(side) or {}
        return [{"position": p.get("position"), "points": p.get("points", 0)} for p in (t.get("forwards") or []) + (t.get("defense") or [])]

    home_abbr = (data.get("homeTeam") or {}).get("abbrev", "")
    away_abbr = (data.get("awayTeam") or {}).get("abbrev", "")
    box = {"homeAbbr": home_abbr, "awayAbbr": away_abbr, "skatersByAbbr": {home_abbr: to_skaters("homeTeam"), away_abbr: to_skaters("awayTeam")}}
    await write_snapshot(cache_key, json.dumps(box))
    return box


async def _nhl_last_n_completed(client: httpx.AsyncClient, abbr: str, season: str, n: int) -> list[dict]:
    games = [g for g in await _fetch_nhl_team_schedule(client, abbr, season) if g["gameState"] in ("OFF", "FINAL")]
    if len(games) < n:
        prior_start = int(season[:4]) - 1
        prior_season = f"{prior_start}{prior_start + 1}"
        prior = [g for g in await _fetch_nhl_team_schedule(client, abbr, prior_season) if g["gameState"] in ("OFF", "FINAL")]
        games = prior + games
    games.sort(key=lambda g: g["date"], reverse=True)
    return games[:n]


async def build_nhl_team_defense_index(season: str | None = None, window_size: int = 15, team_abbrs: list[str] | None = None) -> dict[str, TeamDefenseAllowed]:
    """`team_abbrs` override is for testing a small slice without paying
    the full ~32-team, ~200-unique-boxscore cold-rebuild cost — omit it
    for a real leaderboard."""
    season = season or current_nhl_season()
    cache_key = f"nhl:defenseAllowed:leaderboard:py:{season}:{window_size}"
    if team_abbrs is None:
        cached = await read_snapshot_with_age(cache_key)
        if cached and cached[1] < _SNAPSHOT_TTL_LEADERBOARD_S:
            raw = json.loads(cached[0])
            return {abbr: TeamDefenseAllowed(**v) for abbr, v in raw.items()}

    async with httpx.AsyncClient() as client:
        abbrs = team_abbrs if team_abbrs is not None else await _fetch_nhl_current_team_abbrs(client)
        rows: list[dict] = []
        for abbr in abbrs:
            games = await _nhl_last_n_completed(client, abbr, season, window_size)
            if not games:
                continue
            played = 0
            forward_pts = 0.0
            defense_pts = 0.0
            for g in games:
                box = await _fetch_nhl_boxscore(client, g["gameId"])
                if not box:
                    continue
                opponent_abbr = box["awayAbbr"] if box["homeAbbr"] == abbr else box["homeAbbr"] if box["awayAbbr"] == abbr else None
                if not opponent_abbr:
                    continue
                opponent_skaters = box["skatersByAbbr"].get(opponent_abbr) or []
                played += 1
                for s in opponent_skaters:
                    if _nhl_position_group(s.get("position") or "") == "forwards":
                        forward_pts += s.get("points", 0)
                    else:
                        defense_pts += s.get("points", 0)
            if played == 0:
                continue
            rows.append({"abbr": abbr, "games_played": played, "forwards": forward_pts / played, "defense": defense_pts / played})

    forward_ranks = _rank_of(rows, "forwards")
    defense_ranks = _rank_of(rows, "defense")
    index: dict[str, TeamDefenseAllowed] = {}
    for r in rows:
        index[r["abbr"]] = TeamDefenseAllowed(
            abbr=r["abbr"],
            games_played=r["games_played"],
            pool_size=len(rows),
            allowed_per_game={"forwards": r["forwards"], "defense": r["defense"]},
            rank={"forwards": forward_ranks[r["abbr"]], "defense": defense_ranks[r["abbr"]]},
        )
    if team_abbrs is None:
        await write_snapshot(cache_key, json.dumps({abbr: v.__dict__ for abbr, v in index.items()}))
    return index


# ---------------------------------------------------------------------------
# NBA — ESPN site API (site.api.espn.com), no key required
# ---------------------------------------------------------------------------


def _nba_position_group(position_abbr: str | None) -> str | None:
    if not position_abbr:
        return None
    p = position_abbr.upper()
    if p in ("PG", "SG", "G"):
        return "guards"
    if p in ("SF", "PF", "F"):
        return "forwards"
    if p == "C":
        return "centers"
    return None


def current_nba_season_year(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    return now.year + 1 if now.month >= 10 else now.year


async def _fetch_nba_current_teams(client: httpx.AsyncClient) -> list[tuple[str, str]]:
    """Real (team_id, abbr) pairs, discovered from a real scoreboard
    window rather than ESPN's dedicated /teams list endpoint — that
    endpoint was checked live during this build and confirmed to return
    an incomplete, inconsistent subset (13 of 30 teams, including a
    non-standard 'LON' entry) regardless of query params tried. The
    scoreboard endpoint is already proven live elsewhere in this exact
    pipeline (game_context.py's _fetch_espn_scoreboard) and every team
    plays multiple games in any real 2-week window, so this is more
    reliable, not just a workaround."""
    now = datetime.now(timezone.utc)
    date_range = f"{now.strftime('%Y%m%d')}-{(now.replace(day=1)).strftime('%Y%m%d')}"
    try:
        res = await client.get(f"{_NBA_ESPN_BASE}/scoreboard?dates={now.strftime('%Y%m%d')}-{now.strftime('%Y%m%d')}", timeout=httpx.Timeout(15.0))
        data = res.json() if res.status_code == 200 else {}
    except httpx.HTTPError:
        data = {}
    events = data.get("events") or []
    if not events:
        try:
            res = await client.get(f"{_NBA_ESPN_BASE}/scoreboard?dates={_NBA_FALLBACK_SCOREBOARD_RANGE}", timeout=httpx.Timeout(15.0))
            data = res.json() if res.status_code == 200 else {}
        except httpx.HTTPError:
            data = {}
        events = data.get("events") or []
    pairs: dict[str, str] = {}
    for e in events:
        comps = (e.get("competitions") or [{}])[0].get("competitors") or []
        for c in comps:
            team = c.get("team") or {}
            abbr = team.get("abbreviation")
            team_id = team.get("id")
            if abbr and team_id:
                pairs[abbr] = str(team_id)
    return sorted(pairs.items())


async def _fetch_nba_team_schedule(client: httpx.AsyncClient, team_id: str, season: str) -> list[dict]:
    cache_key = f"nba:schedule:{season}:{team_id}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_SCHEDULE_S:
        return json.loads(cached[0])
    try:
        res = await client.get(f"{_NBA_ESPN_BASE}/teams/{team_id}/schedule?season={season}", timeout=httpx.Timeout(15.0))
    except httpx.HTTPError:
        return json.loads(cached[0]) if cached else []
    if res.status_code != 200:
        return json.loads(cached[0]) if cached else []
    data = res.json()
    games = []
    for e in data.get("events") or []:
        comp = (e.get("competitions") or [{}])[0]
        games.append({"gameId": str(e.get("id")), "date": e.get("date"), "completed": bool(((comp.get("status") or {}).get("type") or {}).get("completed"))})
    await write_snapshot(cache_key, json.dumps(games))
    return games


async def _fetch_nba_boxscore(client: httpx.AsyncClient, game_id: str) -> dict | None:
    cache_key = f"nba:boxscore:{game_id}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_BOXSCORE_S:
        return json.loads(cached[0])
    try:
        res = await client.get(f"{_NBA_ESPN_BASE}/summary?event={game_id}", timeout=httpx.Timeout(15.0))
    except httpx.HTTPError:
        return json.loads(cached[0]) if cached else None
    if res.status_code != 200:
        return json.loads(cached[0]) if cached else None
    data = res.json()
    team_groups = (data.get("boxscore") or {}).get("players") or []
    if not team_groups:
        return json.loads(cached[0]) if cached else None

    players_by_abbr: dict[str, list[dict]] = {}
    for group in team_groups:
        abbr = (group.get("team") or {}).get("abbreviation")
        if not abbr:
            continue
        players: list[dict] = []
        for stat_group in group.get("statistics") or []:
            labels = [l.upper() for l in (stat_group.get("labels") or [])]
            pts_idx = labels.index("PTS") if "PTS" in labels else -1
            for a in stat_group.get("athletes") or []:
                stats = a.get("stats") or []
                pos = ((a.get("athlete") or {}).get("position") or {})
                pos_abbr = pos.get("abbreviation") if isinstance(pos, dict) else pos
                points = 0.0
                if 0 <= pts_idx < len(stats):
                    try:
                        points = float(stats[pts_idx])
                    except (TypeError, ValueError):
                        points = 0.0
                players.append({"position": pos_abbr, "points": points})
        players_by_abbr[abbr] = players

    box = {"playersByAbbr": players_by_abbr}
    await write_snapshot(cache_key, json.dumps(box))
    return box


async def _nba_last_n_completed(client: httpx.AsyncClient, team_id: str, season_year: int, n: int) -> list[dict]:
    games = [g for g in await _fetch_nba_team_schedule(client, team_id, str(season_year)) if g["completed"]]
    if len(games) < n:
        prior = [g for g in await _fetch_nba_team_schedule(client, team_id, str(season_year - 1)) if g["completed"]]
        games = prior + games
    games.sort(key=lambda g: g["date"], reverse=True)
    return games[:n]


async def build_nba_team_defense_index(season_year: int | None = None, window_size: int = 15, teams: list[tuple[str, str]] | None = None) -> dict[str, TeamDefenseAllowed]:
    """`teams` override (abbr, team_id pairs) is for testing a small
    slice without paying the full ~30-team cold-rebuild cost — omit it
    for a real leaderboard."""
    season_year = season_year or current_nba_season_year()
    cache_key = f"nba:defenseAllowed:leaderboard:py:{season_year}:{window_size}"
    if teams is None:
        cached = await read_snapshot_with_age(cache_key)
        if cached and cached[1] < _SNAPSHOT_TTL_LEADERBOARD_S:
            raw = json.loads(cached[0])
            return {abbr: TeamDefenseAllowed(**v) for abbr, v in raw.items()}

    async with httpx.AsyncClient() as client:
        team_pairs = teams if teams is not None else await _fetch_nba_current_teams(client)
        rows: list[dict] = []
        for abbr, team_id in team_pairs:
            games = await _nba_last_n_completed(client, team_id, season_year, window_size)
            if not games:
                continue
            played = 0
            guard_pts = forward_pts = center_pts = 0.0
            for g in games:
                box = await _fetch_nba_boxscore(client, g["gameId"])
                if not box:
                    continue
                players_by_abbr = box["playersByAbbr"]
                opponent_players = None
                for other_abbr, players in players_by_abbr.items():
                    if other_abbr != abbr:
                        opponent_players = players
                if opponent_players is None:
                    continue
                played += 1
                for p in opponent_players:
                    group = _nba_position_group(p.get("position"))
                    if group == "guards":
                        guard_pts += p.get("points", 0)
                    elif group == "forwards":
                        forward_pts += p.get("points", 0)
                    elif group == "centers":
                        center_pts += p.get("points", 0)
            if played == 0:
                continue
            rows.append({"abbr": abbr, "games_played": played, "guards": guard_pts / played, "forwards": forward_pts / played, "centers": center_pts / played})

    guard_ranks = _rank_of(rows, "guards")
    forward_ranks = _rank_of(rows, "forwards")
    center_ranks = _rank_of(rows, "centers")
    index: dict[str, TeamDefenseAllowed] = {}
    for r in rows:
        index[r["abbr"]] = TeamDefenseAllowed(
            abbr=r["abbr"],
            games_played=r["games_played"],
            pool_size=len(rows),
            allowed_per_game={"guards": r["guards"], "forwards": r["forwards"], "centers": r["centers"]},
            rank={"guards": guard_ranks[r["abbr"]], "forwards": forward_ranks[r["abbr"]], "centers": center_ranks[r["abbr"]]},
        )
    if teams is None:
        await write_snapshot(cache_key, json.dumps({abbr: v.__dict__ for abbr, v in index.items()}))
    return index


# ---------------------------------------------------------------------------
# NFL — ESPN site API (site.api.espn.com), no key required
# ---------------------------------------------------------------------------


def _nfl_position_group(stat_key: str) -> str | None:
    """The three buckets here are the real offensive stat CATEGORIES
    (passing/rushing/receiving) NFL_DIMENSIONS/CFB_DIMENSIONS's own
    category-prefixed field names already use — not literal roster
    positions (QB/RB/WR/TE). A real, deliberate choice: "how many yards
    has this defense allowed in the passing game" only needs to know
    which stat category a real opposing player's box-score line falls
    under, not that player's own roster position (which
    backfill_player_game_history.py's parse_football doesn't even carry —
    it groups by ESPN's own boxscore category, same source this reuses).
    This also means a candidate's position_group maps directly onto its
    own dimension (a receiving-yards candidate passes
    position_group="receiving"), no separate roster lookup needed."""
    if stat_key.startswith("passing."):
        return "passing"
    if stat_key.startswith("rushing."):
        return "rushing"
    if stat_key.startswith("receiving."):
        return "receiving"
    return None


def current_nfl_season_year(now: datetime | None = None) -> int:
    """Matches generic_team_elo.py's own NFL season-label convention
    (start year, month>=7 cutoff) — the two modules should never disagree
    about what "this season" means for the same sport."""
    now = now or datetime.now(timezone.utc)
    return now.year if now.month >= 7 else now.year - 1


async def _fetch_nfl_current_teams(client: httpx.AsyncClient) -> list[tuple[str, str]]:
    """Real (abbr, team_id) pairs, discovered from a real 31-day scoreboard
    window (not a single day — unlike NBA/NHL's off-season, NFL is
    genuinely in preseason right now, real games exist most days but not
    literally every day) rather than ESPN's dedicated /teams list, same
    reasoning _fetch_nba_current_teams already documents for why a
    scoreboard sweep beats that endpoint."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=31)
    try:
        res = await client.get(
            f"{_NFL_ESPN_BASE}/scoreboard",
            params={"dates": f"{start:%Y%m%d}-{now:%Y%m%d}", "limit": 1000},
            timeout=httpx.Timeout(15.0),
        )
        data = res.json() if res.status_code == 200 else {}
    except httpx.HTTPError:
        data = {}
    events = data.get("events") or []
    pairs: dict[str, str] = {}
    for e in events:
        comps = (e.get("competitions") or [{}])[0].get("competitors") or []
        for c in comps:
            team = c.get("team") or {}
            abbr = team.get("abbreviation")
            team_id = team.get("id")
            if abbr and team_id:
                pairs[abbr] = str(team_id)
    return sorted(pairs.items())


async def _fetch_nfl_team_schedule(client: httpx.AsyncClient, team_id: str, season: str) -> list[dict]:
    cache_key = f"nfl:schedule:{season}:{team_id}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_SCHEDULE_S:
        return json.loads(cached[0])
    try:
        res = await client.get(f"{_NFL_ESPN_BASE}/teams/{team_id}/schedule", params={"season": season}, timeout=httpx.Timeout(15.0))
    except httpx.HTTPError:
        return json.loads(cached[0]) if cached else []
    if res.status_code != 200:
        return json.loads(cached[0]) if cached else []
    data = res.json()
    games = []
    for e in data.get("events") or []:
        comp = (e.get("competitions") or [{}])[0]
        games.append({"gameId": str(e.get("id")), "date": e.get("date"), "completed": bool(((comp.get("status") or {}).get("type") or {}).get("completed"))})
    await write_snapshot(cache_key, json.dumps(games))
    return games


async def _fetch_nfl_boxscore_raw(client: httpx.AsyncClient, game_id: str) -> dict | None:
    """Caches the raw summary payload (not a pre-aggregated shape, unlike
    NBA/NHL's boxscore caches) so it can be fed straight into
    backfill_player_game_history.parse_football — real reuse of the
    already-live-verified football parser rather than a second one tuned
    just for yards-allowed aggregation."""
    cache_key = f"nfl:boxscoreRaw:{game_id}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _SNAPSHOT_TTL_BOXSCORE_S:
        return json.loads(cached[0])
    try:
        res = await client.get(f"{_NFL_ESPN_BASE}/summary", params={"event": game_id}, timeout=httpx.Timeout(15.0))
    except httpx.HTTPError:
        return json.loads(cached[0]) if cached else None
    if res.status_code != 200:
        return json.loads(cached[0]) if cached else None
    data = res.json()
    await write_snapshot(cache_key, json.dumps(data))
    return data


async def _nfl_last_n_completed(client: httpx.AsyncClient, team_id: str, season_year: int, n: int) -> list[dict]:
    games = [g for g in await _fetch_nfl_team_schedule(client, team_id, str(season_year)) if g["completed"]]
    if len(games) < n:
        prior = [g for g in await _fetch_nfl_team_schedule(client, team_id, str(season_year - 1)) if g["completed"]]
        games = prior + games
    games.sort(key=lambda g: g["date"], reverse=True)
    return games[:n]


async def build_nfl_team_defense_index(season_year: int | None = None, window_size: int = 15, teams: list[tuple[str, str]] | None = None) -> dict[str, TeamDefenseAllowed]:
    """`teams` override (abbr, team_id pairs) is for testing a small slice
    without paying the full ~32-team cold-rebuild cost — omit it for a
    real leaderboard. Position groups here are "passing"/"rushing"/
    "receiving" (see _nfl_position_group's own docstring for why), so
    `allowed_per_game`/`rank` carry those three keys instead of NBA's
    guards/forwards/centers or NHL's forwards/defense.

    Real, disclosed limitation confirmed live: "passing" and "receiving"
    come out identical or near-identical for every real team (a
    completed pass's yardage is definitionally counted once as the QB's
    passing yards and once as the receiver's receiving yards in ESPN's
    own box score) — a team that allows a lot through the air reads the
    same for a QB's passing-yards candidate and a WR's receiving-yards
    candidate. Splitting "receiving" further (e.g. by target depth or
    receiver position) would need real per-target data this endpoint
    doesn't carry; not attempted here, same v1-disclosed-not-split status
    as every other unrefined signal in this file."""
    season_year = season_year or current_nfl_season_year()
    cache_key = f"nfl:defenseAllowed:leaderboard:py:{season_year}:{window_size}"
    if teams is None:
        cached = await read_snapshot_with_age(cache_key)
        if cached and cached[1] < _SNAPSHOT_TTL_LEADERBOARD_S:
            raw = json.loads(cached[0])
            return {abbr: TeamDefenseAllowed(**v) for abbr, v in raw.items()}

    async with httpx.AsyncClient() as client:
        team_pairs = teams if teams is not None else await _fetch_nfl_current_teams(client)
        rows: list[dict] = []
        for abbr, team_id in team_pairs:
            games = await _nfl_last_n_completed(client, team_id, season_year, window_size)
            if not games:
                continue
            played = 0
            passing_yds = rushing_yds = receiving_yds = 0.0
            for g in games:
                raw = await _fetch_nfl_boxscore_raw(client, g["gameId"])
                if not raw:
                    continue
                player_rows = bph.parse_football(raw, "nfl", g["gameId"], season_year)
                if not player_rows:
                    continue
                opp_rows = [r for r in player_rows if r.team_id != team_id]
                if not opp_rows:
                    continue
                played += 1
                for r in opp_rows:
                    passing_yds += r.stats.get("passing.passingYards", 0.0)
                    rushing_yds += r.stats.get("rushing.rushingYards", 0.0)
                    receiving_yds += r.stats.get("receiving.receivingYards", 0.0)
            if played == 0:
                continue
            rows.append({"abbr": abbr, "games_played": played, "passing": passing_yds / played, "rushing": rushing_yds / played, "receiving": receiving_yds / played})

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
    if teams is None:
        await write_snapshot(cache_key, json.dumps({abbr: v.__dict__ for abbr, v in index.items()}))
    return index
