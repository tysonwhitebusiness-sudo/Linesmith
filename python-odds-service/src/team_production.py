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
                "offsides", "yellowCards", "redCards", "saves", "ownGoals"]
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
        if sport in OWN_GOAL_SPORTS:
            await _add_team_goals(conn, sport, season)
    return int(status.split()[-1])


# R8.3-F1. ESPN credits a goal to its scorer, and an own goal to the defender
# as `ownGoals`, so the summed `totalGoals` belongs to nobody's scoreline:
# EPL 2025-26 City 74 against ESPN's 77. `goals` is the team's real score:
# its players' goals plus the opponent's own goals, on the 'all' row only (an
# own goal has no position group on the scoring side). Read by opponent it is
# goals conceded. Measured 2026-09-17 on EPL and MLS 2025: it equals the
# opponent's `goalsConceded` in all 1,780 team-games.
OWN_GOAL_SPORTS = ("soccer_epl", "soccer_mls")


async def _add_team_goals(conn, sport: str, season: int) -> None:
    await conn.execute("""
        UPDATE team_game_production t
           SET stats = t.stats || jsonb_build_object('goals',
                 coalesce((t.stats->>'totalGoals')::float, 0) + coalesce((o.stats->>'ownGoals')::float, 0))
          FROM team_game_production o
         WHERE t.sport = $1 AND t.season = $2 AND t.pos_group = 'all'
           AND o.sport = t.sport AND o.season = t.season AND o.event_id = t.event_id
           AND o.team_id = t.opponent_id AND o.pos_group = 'all'
    """, sport, season)


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


# `nfl_target_events` names receivers by nflverse GSIS id ("00-0035228"), not
# ESPN's, so NFL positions are stored twice: under 'nfl' by ESPN id (what
# player_game_history uses) and under this key by GSIS id.
NFL_GSIS = "nfl_gsis"


async def nfl_positions(client: httpx.AsyncClient) -> tuple[list[tuple], list[tuple]]:
    """(by ESPN id, by GSIS id). Streamed line by line: only the ids and the
    position are kept, so the 7 MB file never sits in the worker's memory whole."""
    by_espn, by_gsis = [], []
    async with client.stream("GET", NFLVERSE_PLAYERS, follow_redirects=True, timeout=120) as res:
        res.raise_for_status()
        lines = res.aiter_lines()
        header = next(csv.reader([await lines.__anext__()]))
        i_espn, i_gsis, i_pos = header.index("espn_id"), header.index("gsis_id"), header.index("position")
        width = max(i_espn, i_gsis, i_pos)
        async for line in lines:
            if not line:
                continue
            row = next(csv.reader([line]))
            if len(row) <= width:
                continue
            pos = row[i_pos] or None
            if row[i_espn]:
                by_espn.append((row[i_espn], pos, nfl_group(pos)))
            if row[i_gsis]:
                by_gsis.append((row[i_gsis], pos, nfl_group(pos)))
    return by_espn, by_gsis


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
        by_espn, by_gsis = await nfl_positions(client)
        return {"nflverse": await _upsert_positions(conn, sport, by_espn, "nflverse players.csv"),
                "nflverse_gsis": await _upsert_positions(conn, NFL_GSIS, by_gsis, "nflverse players.csv")}
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
        if sport in ("nba", "nhl"):
            entry["shot_rows"] = {s: await rebuild_team_shot_profiles(conn, sport, s) for s in seasons}
        if sport == "nfl":
            teams = await espn_nfl_team_ids(client)
            entry["target_rows"] = {s: await rebuild_team_target_profiles(conn, s, teams) for s in seasons}
        out[sport] = entry
    return out


# ---------------------------------------------------------------------------
# team shot views (R5c)
# ---------------------------------------------------------------------------
#
# G2's `build_team_data.nba_shots` / `nhl_shots` computed these on read from a
# season of shots (~220k rows for NBA). Same cells here, once a day, in SQL.
#
# NBA: rim at (25, 1), the fitted origin (`nba_shots.RIM_Y`); G2 wrote the same
# lines shifted by 4.25 feet. `point_value` is right for misses since R5c, so a
# zone is chosen from it directly. Heaves past 43 feet are left out, as in G2.
# NHL: every attempt folded to one attacking end (x = |x|, y mirrored with it),
# 5-ft bins; goals are `event_type = 'goal'`.

_NBA_SHOT_SQL = """
WITH s AS (
    SELECT game_id, team_id::text AS team, shooter_id, x_coord AS x, y_coord AS y, made, point_value AS pv
      FROM nba_shot_events
     WHERE season = $1 AND x_coord IS NOT NULL AND y_coord IS NOT NULL AND y_coord <= 43
), gt AS (
    SELECT game_id, array_agg(DISTINCT team) AS teams FROM s GROUP BY game_id
), t AS (
    SELECT s.game_id, s.team, s.made, s.pv,
           (SELECT o FROM unnest(gt.teams) o WHERE o <> s.team LIMIT 1) AS opp,
           CASE WHEN s.pv = 3 THEN CASE WHEN s.y < 9.75 THEN 'Corner 3' ELSE 'Above-break 3' END
                WHEN sqrt(power(s.x - 25, 2) + power(s.y - 1, 2)) <= 4 THEN 'Restricted area'
                WHEN abs(s.x - 25) <= 8 AND s.y <= 14.75 THEN 'Paint (non-RA)'
                ELSE 'Mid-range' END AS cell,
           floor(s.x / 3)::int || '|' || floor((s.y + 4.25) / 3)::int AS bin,
           CASE WHEN ap.athlete_id IS NULL THEN 'unknown' WHEN ap.position_group IS NULL THEN 'other'
                ELSE ap.position_group END AS grp
      FROM s JOIN gt USING (game_id)
      LEFT JOIN athlete_positions ap ON ap.sport = 'nba' AND ap.athlete_id = s.shooter_id::text
), sides AS (
    SELECT 'for' AS side, team AS tid, 'all' AS pg, game_id, cell, bin, made, pv FROM t
    UNION ALL SELECT 'allowed', opp, 'all', game_id, cell, bin, made, pv FROM t WHERE opp IS NOT NULL
    UNION ALL SELECT 'allowed', opp, grp, game_id, cell, NULL, made, pv FROM t WHERE opp IS NOT NULL
), games AS (
    SELECT side, tid, count(DISTINCT game_id) AS g FROM sides WHERE pg = 'all' GROUP BY side, tid
), zones AS (
    SELECT side, tid, pg, jsonb_object_agg(cell, jsonb_build_array(att, mk, pts)) AS z
      FROM (SELECT side, tid, pg, cell, count(*) att, count(*) FILTER (WHERE made) mk,
                   sum(CASE WHEN made THEN pv ELSE 0 END) pts
              FROM sides GROUP BY side, tid, pg, cell) x
     GROUP BY side, tid, pg
), bins AS (
    SELECT side, tid, jsonb_object_agg(bin, jsonb_build_array(att, mk)) AS b
      FROM (SELECT side, tid, bin, count(*) att, count(*) FILTER (WHERE made) mk
              FROM sides WHERE pg = 'all' GROUP BY side, tid, bin) x
     GROUP BY side, tid
)
INSERT INTO team_shot_profile (sport, season, team_id, side, pos_group, games, payload)
SELECT 'nba', $1, z.tid, z.side, z.pg, games.g,
       jsonb_build_object('zones', z.z, 'bins', coalesce(bins.b, '{}'::jsonb))
  FROM zones z JOIN games USING (side, tid)
  LEFT JOIN bins ON bins.side = z.side AND bins.tid = z.tid AND z.pg = 'all'
"""

_NHL_SHOT_SQL = """
WITH s AS (
    SELECT game_id, team_id::text AS team, event_type, coalesce(shot_type, 'unknown') AS shot_type,
           abs(x_coord) AS x, CASE WHEN x_coord >= 0 THEN y_coord ELSE -y_coord END AS y
      FROM nhl_shot_events
     WHERE season = $2 AND x_coord IS NOT NULL AND y_coord IS NOT NULL
), gt AS (
    SELECT game_id, array_agg(DISTINCT team) AS teams FROM s GROUP BY game_id
), t AS (
    SELECT s.*, (SELECT o FROM unnest(gt.teams) o WHERE o <> s.team LIMIT 1) AS opp,
           floor(x / 5)::int || '|' || floor((y + 42.5) / 5)::int AS bin
      FROM s JOIN gt USING (game_id)
), sides AS (
    SELECT 'for' AS side, team AS tid, game_id, bin, shot_type, event_type FROM t
    UNION ALL SELECT 'allowed', opp, game_id, bin, shot_type, event_type FROM t WHERE opp IS NOT NULL
), games AS (
    SELECT side, tid, count(DISTINCT game_id) AS g, count(*) AS attempts FROM sides GROUP BY side, tid
), bins AS (
    SELECT side, tid, jsonb_object_agg(bin, jsonb_build_array(att, goals)) AS b
      FROM (SELECT side, tid, bin, count(*) att, count(*) FILTER (WHERE event_type = 'goal') goals
              FROM sides GROUP BY side, tid, bin) x
     GROUP BY side, tid
), types AS (
    SELECT side, tid, jsonb_object_agg(shot_type, n) AS ty
      FROM (SELECT side, tid, shot_type, count(*) n FROM sides GROUP BY side, tid, shot_type) x
     GROUP BY side, tid
)
INSERT INTO team_shot_profile (sport, season, team_id, side, pos_group, games, payload)
SELECT 'nhl', $1, games.tid, games.side, 'all', games.g,
       jsonb_build_object('bins', bins.b, 'types', types.ty, 'attempts', games.attempts)
  FROM games JOIN bins USING (side, tid) JOIN types USING (side, tid)
"""


async def rebuild_team_shot_profiles(conn, sport: str, season: int) -> int:
    """NBA `season` is ESPN's end year (2026 = 2025-26); NHL's is the start year,
    stored in `nhl_shot_events` as '20252026'."""
    async with conn.transaction():
        await conn.execute("SET LOCAL statement_timeout = '180s'")
        await conn.execute("DELETE FROM team_shot_profile WHERE sport = $1 AND season = $2", sport, season)
        if sport == "nba":
            status = await conn.execute(_NBA_SHOT_SQL, season)
        else:
            status = await conn.execute(_NHL_SHOT_SQL, season, f"{season}{season + 1}")
    return int(status.split()[-1])


# ---------------------------------------------------------------------------
# NFL target maps, offense and defense (R5d)
# ---------------------------------------------------------------------------
#
# G2's `build_matchup_data.nfl_extras`, in SQL. nflverse spells four teams
# differently from ESPN (LA, WAS, and the relocated OAK/SD/STL), the same map
# `lib/sports/nfl/nflverse.ts` applies; ESPN's team ids come from ESPN's own
# team list each run rather than a constant.

NFLVERSE_TO_ESPN_ABBR = {"LA": "LAR", "WAS": "WSH", "OAK": "LV", "SD": "LAC", "STL": "LAR"}


async def espn_nfl_team_ids(client) -> dict[str, str]:
    """ESPN abbreviation -> ESPN team id, plus nflverse's own spellings."""
    res = await client.get(f"{ESPN}/football/nfl/teams", params={"limit": 40}, timeout=30)
    res.raise_for_status()
    out = {}
    for league in res.json().get("sports", [{}])[0].get("leagues", []):
        for t in league.get("teams", []):
            team = t.get("team") or {}
            if team.get("abbreviation") and team.get("id"):
                out[team["abbreviation"]] = str(team["id"])
    for nflverse, espn in NFLVERSE_TO_ESPN_ABBR.items():
        if espn in out:
            out[nflverse] = out[espn]
    return out


_TARGET_SQL = """
WITH m AS (
    SELECT * FROM unnest($2::text[], $3::text[]) AS m(abbr, team_id)
), e AS (
    SELECT game_id, team, receiver_id, pass_length || '|' || pass_location AS cell,
           coalesce(complete_pass, false) AS complete, coalesce(air_yards, 0) AS air,
           split_part(game_id, '_', 3) AS away, split_part(game_id, '_', 4) AS home
      FROM nfl_target_events
     WHERE season = $1 AND pass_length IS NOT NULL AND pass_location IS NOT NULL AND team IS NOT NULL
), t AS (
    SELECT e.game_id, e.cell, e.complete, e.air, off.team_id AS off_id, def.team_id AS def_id,
           CASE ap.position_group WHEN 'WR' THEN 'WR' WHEN 'TE' THEN 'TE' WHEN 'RB' THEN 'RB' END AS grp
      FROM e
      JOIN m off ON off.abbr = e.team
      JOIN m def ON def.abbr = CASE WHEN e.team = e.away THEN e.home ELSE e.away END
      LEFT JOIN athlete_positions ap ON ap.sport = 'nfl_gsis' AND ap.athlete_id = e.receiver_id
), sides AS (
    SELECT 'offense' AS side, off_id AS tid, 'all' AS pg, game_id, cell, complete, air FROM t
    UNION ALL SELECT 'defense', def_id, 'all', game_id, cell, complete, air FROM t
    UNION ALL SELECT 'defense', def_id, grp, game_id, cell, complete, air FROM t WHERE grp IS NOT NULL
    UNION ALL SELECT 'offense', 'league', 'all', game_id, cell, complete, air FROM t
), games AS (
    SELECT side, tid, count(DISTINCT game_id) AS g FROM sides WHERE pg = 'all' GROUP BY side, tid
), cells AS (
    SELECT side, tid, pg, jsonb_object_agg(cell, jsonb_build_array(n, c, air)) AS cells
      FROM (SELECT side, tid, pg, cell, count(*) n, count(*) FILTER (WHERE complete) c, round(sum(air)::numeric, 1) air
              FROM sides GROUP BY side, tid, pg, cell) x
     GROUP BY side, tid, pg
)
INSERT INTO team_target_profile (season, team_id, side, pos_group, games, payload)
SELECT $1, cells.tid, cells.side, cells.pg, games.g, jsonb_build_object('cells', cells.cells)
  FROM cells JOIN games USING (side, tid)
"""


async def rebuild_team_target_profiles(conn, season: int, team_ids: dict[str, str]) -> int:
    abbrs = list(team_ids)
    async with conn.transaction():
        await conn.execute("SET LOCAL statement_timeout = '180s'")
        await conn.execute("DELETE FROM team_target_profile WHERE season = $1", season)
        status = await conn.execute(_TARGET_SQL, season, abbrs, [team_ids[a] for a in abbrs])
    return int(status.split()[-1])
