"""R5b — strength rollups: production for and allowed, by team, game and position.

`/api/season-ranks` sums a league's `player_game_history` per request, with no
date cutoff and no positions. The research pages need three things it cannot
give — "strength vs strength" as of kickoff, "what this team allows to the
position", and a team's key players ranked by what they produce — so this
writes them to three tables once a day (`teamProductionJob`) and the pages read
a handful of rows:

  athlete_positions         position and group per athlete
  team_game_production      per team, per game, per position group: summed stats
  player_season_production  per player-team-season: production score and share

WHY PER GAME AND NOT PER SEASON. A pregame card needs totals cut at the game's
date. Summing a team's ~17-82 rows below a date is cheap; a season-level row
cannot be cut at all. The ALLOWED side is the same rows read by opponent.

THE STAT KEYS, GROUPS AND SCORE ARE THE G2 TOOLS' (`docs/design/phase-g2/tools/
g2lib.py` ROLL_KEYS, `build_matchup_data.py` groups and SCORE), because the
pages are rebuilt to those datasets. One addition: soccer_mls uses soccer_epl's.

POSITION SOURCES, per the plan and measured 2026-09-14:
  nfl         nflverse players.csv, by espn_id (16,557 players, all eras)
  nba         ESPN team rosters (current only: `?season=` returns an empty list),
              then ESPN's athlete endpoint for anyone else in the table, capped
              per run so a first fill spreads over several days
  soccer      ESPN team rosters by season
  nhl         api-web rosters by season; history uses NHL ids, not ESPN's
  mlb, cfb    none: MLB splits by stat group already (bat_/pit_), and the plan
              names no CFB source
"""
from __future__ import annotations

import asyncio
import csv
from datetime import datetime, timezone

import httpx

ESPN = "https://site.api.espn.com/apis/site/v2/sports"
ESPN_ATHLETE = "https://site.web.api.espn.com/apis/common/v3/sports"
NFLVERSE_PLAYERS = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"

_NFL_KEYS = ["passing.passingYards", "passing.passingAttempts", "passing.completions", "passing.passingTouchdowns",
             "passing.interceptions", "passing.sacks", "rushing.rushingYards", "rushing.rushingAttempts",
             "rushing.rushingTouchdowns", "receiving.receptions", "receiving.receivingYards",
             "receiving.receivingTargets", "receiving.receivingTouchdowns", "defensive.sacks",
             "defensive.tacklesForLoss", "interceptions.interceptions", "fumbles.fumblesLost"]
_SOCCER_KEYS = ["totalGoals", "totalShots", "shotsOnTarget", "goalAssists", "foulsCommitted", "foulsSuffered",
                "offsides", "yellowCards", "redCards", "saves"]
ROLL_KEYS: dict[str, list[str]] = {
    "nfl": _NFL_KEYS,
    "cfb": ["passing.passingYards", "passing.passingAttempts", "passing.completions", "passing.passingTouchdowns",
            "passing.interceptions", "rushing.rushingYards", "rushing.rushingAttempts", "rushing.rushingTouchdowns",
            "receiving.receptions", "receiving.receivingYards", "defensive.sacks", "interceptions.interceptions"],
    "mlb": ["bat_runs", "bat_hits", "bat_homeRuns", "bat_strikeOuts", "bat_baseOnBalls", "bat_plateAppearances",
            "bat_atBats", "bat_totalBases", "bat_stolenBases", "bat_doubles", "pit_strikeOuts", "pit_earnedRuns",
            "pit_hits", "pit_baseOnBalls", "pit_homeRuns", "pit_outs"],
    "nba": ["points", "rebounds", "assists", "steals", "blocks", "turnovers", "fieldGoalsMade", "fieldGoalsAttempted",
            "threePointFieldGoalsMade", "threePointFieldGoalsAttempted", "freeThrowsMade", "freeThrowsAttempted",
            "offensiveRebounds"],
    "nhl": ["goals", "assists", "sog", "hits", "blockedShots", "powerPlayGoals", "pim", "saves", "shotsAgainst",
            "goalsAgainst", "takeaways", "giveaways"],
    "soccer_epl": _SOCCER_KEYS,
    "soccer_mls": _SOCCER_KEYS,
}

# Production score, per game played (G2 build_matchup_data.SCORE). Weighted sums
# of what a player produced; NOT games played, which put punters first.
SCORE: dict[str, dict[str, float]] = {
    "nfl": {"passing.passingYards": 1, "rushing.rushingYards": 1, "receiving.receivingYards": 1,
            "defensive.sacks": 25, "interceptions.interceptions": 25},
    "mlb": {"bat_hits": 1, "bat_homeRuns": 2, "pit_strikeOuts": 1},
    "nba": {"points": 1, "rebounds": 1, "assists": 1},
    "nhl": {"goals": 3, "assists": 3, "sog": 1, "saves": 0.1},
    "soccer_epl": {"totalGoals": 10, "goalAssists": 10, "totalShots": 1, "saves": 0.5},
}
SCORE["cfb"] = SCORE["nfl"]
SCORE["soccer_mls"] = SCORE["soccer_epl"]

POSITION_SPORTS = ("nfl", "nba", "nhl", "soccer_epl", "soccer_mls")


def nfl_group(position: str | None) -> str | None:
    """The receiving and rushing groups a defense allows production to (G2)."""
    return {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}.get(position or "")


def nba_group(position: str | None) -> str | None:
    """G2: any listed C is a center; a guard spelling is a guard; the rest forwards."""
    p = position or ""
    if not p:
        return None
    if "C" in p:
        return "C"
    if p.startswith("G") or p in ("PG", "SG"):
        return "G"
    return "F"


def soccer_group(position: str | None) -> str | None:
    return {"G": "GK", "D": "DEF", "M": "MID", "F": "FWD"}.get((position or "")[:1])


def nhl_group(roster_section: str) -> str:
    return {"forwards": "F", "defensemen": "D", "goalies": "G"}[roster_section]


def _stat(key: str) -> str:
    """One stat as a float, 0 when absent. MLB's outs are derived from innings
    written as 6.2 for six and two-thirds, which is not a decimal (R2)."""
    if key == "pit_outs":
        ip = "(stats->>'pit_inningsPitched')::float"
        return f"coalesce(floor({ip}) * 3 + round(({ip} - floor({ip})) * 10), 0)"
    return f"coalesce((stats->>'{key}')::float, 0)"


def stats_object_sql(sport: str) -> str:
    parts = ", ".join(f"'{k}', sum({_stat(k)})" for k in ROLL_KEYS[sport])
    return f"jsonb_build_object({parts})"


def score_sql(sport: str) -> str:
    return " + ".join(f"{w} * {_stat(k)}" for k, w in SCORE[sport].items())


async def rebuild_team_game_production(conn, sport: str, season: int) -> int:
    """Replace one sport-season's rows. Pure Postgres: nothing crosses to Python."""
    # 'unknown' = no position on record; 'other' = a position outside every
    # group (an NFL lineman or defender), which is not a gap in the data.
    group_of = ("CASE WHEN ap.athlete_id IS NULL THEN 'unknown' "
                "WHEN ap.position_group IS NULL THEN 'other' ELSE ap.position_group END")
    groups = f"CROSS JOIN LATERAL (VALUES ('all'), ({group_of})) g(grp)" \
        if sport in POSITION_SPORTS else "CROSS JOIN LATERAL (VALUES ('all')) g(grp)"
    async with conn.transaction():
        # LOCAL: the worker pool's 15 s default is right for every other query and
        # must come back with the connection; a CFB season rebuild can run past it.
        await conn.execute("SET LOCAL statement_timeout = '180s'")
        await conn.execute("DELETE FROM team_game_production WHERE sport = $1 AND season = $2", sport, season)
        status = await conn.execute(f"""
            INSERT INTO team_game_production (sport, season, event_id, game_date, team_id, opponent_id, pos_group, players, stats)
            SELECT h.sport, h.season, h.event_id, min(h.game_date), h.team_id, min(h.opponent_id), g.grp, count(*),
                   {stats_object_sql(sport).replace('stats->>', 'h.stats->>')}
              FROM player_game_history h
              LEFT JOIN athlete_positions ap ON ap.sport = h.sport AND ap.athlete_id = h.athlete_id
              {groups}
             WHERE h.sport = $1 AND h.season = $2 AND h.team_id IS NOT NULL AND h.opponent_id IS NOT NULL
             GROUP BY h.sport, h.season, h.event_id, h.team_id, g.grp
        """, sport, season)
    return int(status.split()[-1])


async def rebuild_player_production(conn, sport: str, season: int) -> int:
    async with conn.transaction():
        await conn.execute("SET LOCAL statement_timeout = '180s'")
        await conn.execute("DELETE FROM player_season_production WHERE sport = $1 AND season = $2", sport, season)
        status = await conn.execute(f"""
            WITH p AS (
                SELECT h.athlete_id, h.team_id, count(*) AS games, max(h.game_date) AS last_game_date,
                       sum({score_sql(sport).replace('stats->>', 'h.stats->>')}) AS score,
                       {stats_object_sql(sport).replace('stats->>', 'h.stats->>')} AS stats
                  FROM player_game_history h
                 WHERE h.sport = $1 AND h.season = $2 AND h.team_id IS NOT NULL
                 GROUP BY h.athlete_id, h.team_id
            )
            INSERT INTO player_season_production
                (sport, season, athlete_id, team_id, games, score, score_per_game, team_share, position, position_group, stats, last_game_date)
            SELECT $1, $2, p.athlete_id, p.team_id, p.games, p.score, p.score / p.games,
                   p.score / nullif(sum(p.score) OVER (PARTITION BY p.team_id), 0),
                   ap.position, ap.position_group, p.stats, p.last_game_date
              FROM p LEFT JOIN athlete_positions ap ON ap.sport = $1 AND ap.athlete_id = p.athlete_id
        """, sport, season)
    return int(status.split()[-1])


# ---------------------------------------------------------------------------
# positions
# ---------------------------------------------------------------------------

async def _upsert_positions(conn, sport: str, rows: list[tuple[str, str | None, str | None]], source: str) -> int:
    if not rows:
        return 0
    await conn.executemany("""
        INSERT INTO athlete_positions (sport, athlete_id, position, position_group, source, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (sport, athlete_id) DO UPDATE
           SET position = excluded.position, position_group = excluded.position_group,
               source = excluded.source, updated_at = now()
    """, [(sport, aid, pos, grp, source) for aid, pos, grp in rows])
    return len(rows)


async def nfl_positions(client: httpx.AsyncClient) -> list[tuple[str, str | None, str | None]]:
    """Streamed line by line: only (espn_id, position) is kept, so the 7 MB file
    never sits in the worker's memory whole."""
    out = []
    async with client.stream("GET", NFLVERSE_PLAYERS, follow_redirects=True, timeout=120) as res:
        res.raise_for_status()
        lines = res.aiter_lines()
        header = next(csv.reader([await lines.__anext__()]))
        i_espn, i_pos = header.index("espn_id"), header.index("position")
        async for line in lines:
            if not line:
                continue
            row = next(csv.reader([line]))
            if len(row) > max(i_espn, i_pos) and row[i_espn]:
                pos = row[i_pos] or None
                out.append((row[i_espn], pos, nfl_group(pos)))
    return out


async def espn_roster_positions(client, league_path: str, team_ids: list[str], season: int | None, group) -> list[tuple]:
    out = []
    for tid in team_ids:
        params = {"season": season} if season else None
        try:
            res = await client.get(f"{ESPN}/{league_path}/teams/{tid}/roster", params=params, timeout=30)
            if res.status_code != 200:
                continue
            athletes = res.json().get("athletes") or []
        except (httpx.HTTPError, ValueError):
            continue
        flat = [a for g in athletes for a in (g.get("items") or [])] if athletes and "items" in athletes[0] else athletes
        for a in flat:
            pos = (a.get("position") or {}).get("abbreviation")
            if a.get("id"):
                out.append((str(a["id"]), pos, group(pos)))
        await asyncio.sleep(0.2)
    return out


async def espn_athlete_positions(client, league_path: str, athlete_ids: list[str], group) -> list[tuple]:
    out = []
    for aid in athlete_ids:
        try:
            res = await client.get(f"{ESPN_ATHLETE}/{league_path}/athletes/{aid}", timeout=30)
            if res.status_code != 200:
                continue
            pos = ((res.json().get("athlete") or {}).get("position") or {}).get("abbreviation")
        except (httpx.HTTPError, ValueError):
            continue
        out.append((aid, pos, group(pos)))
        await asyncio.sleep(0.2)
    return out


async def nhl_positions(client, season: int) -> list[tuple]:
    """api-web rosters for one season (history labels NHL seasons by start year)."""
    teams = (await client.get("https://api.nhle.com/stats/rest/en/team", timeout=30)).json().get("data") or []
    season_id = f"{season}{season + 1}"
    out = []
    for t in teams:
        abbr = t.get("triCode")
        if not abbr:
            continue
        try:
            res = await client.get(f"https://api-web.nhle.com/v1/roster/{abbr}/{season_id}", timeout=30)
            if res.status_code != 200:
                continue
            roster = res.json()
        except (httpx.HTTPError, ValueError):
            continue
        for section in ("forwards", "defensemen", "goalies"):
            for p in roster.get(section) or []:
                if p.get("id"):
                    out.append((str(p["id"]), p.get("positionCode"), nhl_group(section)))
        await asyncio.sleep(0.1)
    return out


ATHLETE_LOOKUPS_PER_RUN = 150


async def refresh_positions(conn, client, sport: str, seasons: list[int]) -> dict:
    """Fill `athlete_positions` for the athletes in these seasons' history."""
    if sport == "nfl":
        return {"nflverse": await _upsert_positions(conn, sport, await nfl_positions(client), "nflverse players.csv")}
    if sport == "nhl":
        n = 0
        for season in sorted(seasons):  # oldest first, so the latest roster wins
            n += await _upsert_positions(conn, sport, await nhl_positions(client, season), f"api-web roster {season}")
        return {"rosters": n}
    league, group = {"nba": ("basketball/nba", nba_group), "soccer_epl": ("soccer/eng.1", soccer_group),
                     "soccer_mls": ("soccer/usa.1", soccer_group)}[sport]
    team_ids = [r["team_id"] for r in await conn.fetch(
        "SELECT DISTINCT team_id FROM player_game_history WHERE sport = $1 AND season = ANY($2::int[]) AND team_id IS NOT NULL",
        sport, seasons)]
    n = 0
    if sport == "nba":
        n += await _upsert_positions(conn, sport, await espn_roster_positions(client, league, team_ids, None, group), "ESPN roster")
    else:
        for season in sorted(seasons):
            n += await _upsert_positions(conn, sport, await espn_roster_positions(client, league, team_ids, season, group), f"ESPN roster {season}")
    missing = [r["athlete_id"] for r in await conn.fetch("""
        SELECT DISTINCT h.athlete_id FROM player_game_history h
          LEFT JOIN athlete_positions ap ON ap.sport = h.sport AND ap.athlete_id = h.athlete_id
         WHERE h.sport = $1 AND h.season = ANY($2::int[]) AND ap.athlete_id IS NULL
         LIMIT $3""", sport, seasons, ATHLETE_LOOKUPS_PER_RUN)]
    looked_up = await _upsert_positions(conn, sport, await espn_athlete_positions(client, league, missing, group), "ESPN athlete")
    return {"rosters": n, "athlete_lookups": looked_up}


async def current_seasons(conn, sport: str) -> list[int]:
    """This season and last, by the labels the history table actually holds."""
    rows = await conn.fetch("SELECT DISTINCT season FROM player_game_history WHERE sport = $1 AND game_date > now() - interval '550 days'", sport)
    return sorted(r["season"] for r in rows)[-2:]


async def run(conn, client, sports=tuple(ROLL_KEYS)) -> dict:
    out: dict = {"started_at": datetime.now(timezone.utc).isoformat()}
    for sport in sports:
        seasons = await current_seasons(conn, sport)
        entry: dict = {"seasons": seasons}
        if sport in POSITION_SPORTS:
            try:
                entry["positions"] = await refresh_positions(conn, client, sport, seasons)
            except Exception as exc:  # noqa: BLE001 — positions are best effort; rollups still run
                entry["positions_error"] = f"{type(exc).__name__}: {exc}"
        entry["team_rows"] = {s: await rebuild_team_game_production(conn, sport, s) for s in seasons}
        entry["player_rows"] = {s: await rebuild_player_production(conn, sport, s) for s in seasons}
        out[sport] = entry
    return out
