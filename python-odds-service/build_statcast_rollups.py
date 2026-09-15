"""R5a — build the MLB Statcast rollup tables, off the worker.

    python build_statcast_rollups.py                       # compute and report; writes nothing
    python build_statcast_rollups.py --apply               # write all three tables
    python build_statcast_rollups.py --apply --pregame-date 2026-09-11

Chained after the corpus refresh in `run-corpus-refresh.bat` (every 6 hours on
the operator's machine). Why here and not on the worker, and what the numbers
mean: `src/statcast_rollups.py`. What each run does:

  1. pitches = corpus UNION the Postgres hot window, one copy per pitch (the
     corpus holds duplicates from before R5-F2's fix; the newest copy wins);
  2. regular season only, by game type from the StatsAPI schedule;
  3. per season (this year and last): player blocks with hitter percentiles,
     team blocks, home-run distances from one Savant query;
  4. the pregame block for today's and tomorrow's games (US Eastern), each
     rewritten until first pitch and then left as it stood at kickoff.
     `--pregame-date` recomputes a given date regardless.

One Postgres connection throughout. The corpus is read from the local copy the
refresh just wrote when there is one, which costs no Storage egress.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import httpx  # noqa: E402

import db  # noqa: E402
import statcast_rollups as sr  # noqa: E402

STATSAPI = "https://statsapi.mlb.com/api/v1"
SAVANT_CSV = "https://baseballsavant.mlb.com/statcast_search/csv"
REGULAR = ("R",)
JOB_NAME = "statcastRollups"


def load_table(con, name: str, columns: dict[str, str], rows: list[tuple]) -> None:
    """Rows into DuckDB through Arrow. `executemany` inserts one row at a time:
    70k `player_game_history` rows took 200 seconds that way."""
    import pyarrow as pa

    types = {"BIGINT": pa.int64(), "INTEGER": pa.int32(), "DOUBLE": pa.float64(), "VARCHAR": pa.string(), "DATE": pa.date32()}
    names = list(columns)
    arrays = [pa.array([r[i] for r in rows], type=types[columns[c]]) for i, c in enumerate(names)]
    con.register(f"_arrow_{name}", pa.table(arrays, names=names))
    con.execute(f'CREATE OR REPLACE TABLE {name} AS SELECT * FROM "_arrow_{name}"')
    con.unregister(f"_arrow_{name}")


def _pitch_source():
    from corpus_location import DEFAULT_LOCAL_DIR, corpus_location

    local = os.path.join(DEFAULT_LOCAL_DIR, "mlb_pitch_events")
    if os.path.isdir(local) and any(f.endswith(".parquet") for f in os.listdir(local)):
        return corpus_location(DEFAULT_LOCAL_DIR)
    return corpus_location()


async def load_pitches(conn):
    """A DuckDB connection with `pitches`: corpus UNION Postgres, one row per pitch."""
    from corpus_location import read_parquet_glob
    from corpus_reads import union_view

    backend = _pitch_source()
    con, _ = read_parquet_glob(backend, "mlb_pitch_events")
    info = await union_view(con, conn, "mlb_pitch_events", backend)
    con.execute("""
        CREATE OR REPLACE TABLE pitches AS
        SELECT * EXCLUDE (_rn) FROM (
            SELECT *, row_number() OVER (PARTITION BY game_pk, at_bat_number, pitch_number ORDER BY id DESC) AS _rn
              FROM mlb_pitch_events)
         WHERE _rn = 1
    """)
    unique = con.execute("SELECT count(*) FROM pitches").fetchone()[0]
    return con, {"source": backend.describe, **info, "unique_pitches": unique,
                 "duplicates_dropped": info["union_rows"] - unique}


async def load_schedule(client, con, seasons):
    rows = []
    for season in seasons:
        r = await client.get(f"{STATSAPI}/schedule", params={"sportId": 1, "season": season, "gameType": "S,E,R,F,D,L,W,A"}, timeout=60)
        r.raise_for_status()
        rows += sr.schedule_rows(r.json())
    rows = [(pk, gt, date.fromisoformat(d) if d else None, h, a) for pk, gt, d, h, a in rows]
    load_table(con, "game_types", {"game_pk": "BIGINT", "game_type": "VARCHAR", "official_date": "DATE", "home_id": "BIGINT", "away_id": "BIGINT"}, rows)
    return len(rows)


async def load_hr_distances(client, con, season, through):
    params = {"all": "true", "hfAB": "home\\.\\.run|", "hfGT": "R|", "player_type": "batter", "type": "details",
              "min_pitches": "0", "min_results": "0", "min_abs": "0",
              "game_date_gt": f"{season}-03-01", "game_date_lt": through.isoformat()}
    r = await client.get(SAVANT_CSV, params=params, timeout=300)
    r.raise_for_status()
    rows = sr.home_run_distance_rows(r.text)
    load_table(con, "hr_distance", {"game_pk": "BIGINT", "at_bat_number": "INTEGER", "pitch_number": "INTEGER", "distance": "DOUBLE"}, rows)
    return len(rows)


async def season_rollup(conn, client, con, season, apply):
    t = {}
    mark = time.monotonic()

    def lap(name):
        nonlocal mark
        t[name] = round(time.monotonic() - mark, 1)
        mark = time.monotonic()

    through = date(season, 12, 31)
    n = sr.register_pitch_scope(con, season, through, REGULAR)
    lap("scope")
    if not n:
        return {"season": season, "pitches": 0}
    as_of = con.execute("SELECT max(game_date) FROM scope").fetchone()[0]
    hr_rows = await load_hr_distances(client, con, season, min(as_of + timedelta(days=1), date.today()))
    lap("hr_distances")

    history = await conn.fetch("SELECT event_id, athlete_id, team_id FROM player_game_history WHERE sport = 'mlb' AND season = $1", season)
    load_table(con, "team_of", {"game_pk": "BIGINT", "player_id": "BIGINT", "team_id": "VARCHAR"},
               [(int(r["event_id"]), int(r["athlete_id"]), r["team_id"]) for r in history if r["team_id"]])
    team_games = con.execute("SELECT max(n) FROM (SELECT team_id, count(DISTINCT game_pk) n FROM team_of GROUP BY 1)").fetchone()[0] or 0

    lap("team_of")
    blocks = sr.player_blocks(con)
    sr.attach_pitch_profiles(con, blocks)
    lap("player_blocks")
    min_bip = sr.qualified_bip(team_games)
    pool = sr.hitter_percentiles(con, blocks, min_bip)
    lap("percentiles")
    teams, joined, total = sr.team_blocks(con)
    lap("team_blocks")

    player_rows = [(season, pid, role, as_of, b["pitches"], b["bip"],
                    "percentiles" in b if role == "bat" else "locations" in b,
                    json.dumps(b, separators=(",", ":")))
                   for (role, pid), b in blocks.items()]
    team_rows = [(season, team, side, as_of, int(b["metrics"]["pitches"]),
                  json.dumps({**b, "pitchesJoined": joined, "pitchesTotal": total}, separators=(",", ":")))
                 for (side, team), b in teams.items()]
    summary = {"season": season, "as_of": str(as_of), "pitches": n, "hr_distances": hr_rows,
               "players": len(player_rows), "hitter_pool": pool, "min_bip": min_bip, "teams": len(team_rows),
               "team_join": f"{joined:,} of {total:,}",
               "player_payload_mb": round(sum(len(r[-1]) for r in player_rows) / 1e6, 2), "seconds": t}
    if apply:
        async with conn.transaction():
            await conn.execute("DELETE FROM mlb_statcast_player_season WHERE season = $1", season)
            await conn.executemany("""INSERT INTO mlb_statcast_player_season
                (season, player_id, role, as_of, pitches, bip, qualified, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)""", player_rows)
            await conn.execute("DELETE FROM mlb_statcast_team_season WHERE season = $1", season)
            await conn.executemany("""INSERT INTO mlb_statcast_team_season
                (season, team_id, side, as_of, pitches, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb)""", team_rows)
    return summary


async def roster_hitters(client, team_id, on):
    r = await client.get(f"{STATSAPI}/teams/{team_id}/roster", params={"rosterType": "active", "date": on.isoformat(), "hydrate": "person"}, timeout=60)
    r.raise_for_status()
    out = []
    for p in r.json().get("roster") or []:
        pos = p.get("position") or {}
        if pos.get("type") == "Pitcher" and pos.get("abbreviation") != "TWP":
            continue
        person = p.get("person") or {}
        out.append({"id": person.get("id"), "name": person.get("fullName"), "pos": pos.get("abbreviation"),
                    "bats": (person.get("batSide") or {}).get("code")})
    return [h for h in out if h["id"] is not None]


async def pregame_for_date(conn, client, con, day, force, apply):
    r = await client.get(f"{STATSAPI}/schedule", params={"sportId": 1, "date": day.isoformat(), "gameType": "R", "hydrate": "probablePitcher"}, timeout=60)
    r.raise_for_status()
    games = [g for d in r.json().get("dates") or [] for g in d.get("games") or []]
    existing = {int(x["game_pk"]) for x in await conn.fetch("SELECT game_pk FROM mlb_statcast_game_pregame WHERE game_date = $1", day)}
    written = skipped = 0
    for g in games:
        pk = int(g["gamePk"])
        started = (g.get("status") or {}).get("abstractGameState") != "Preview"
        if pk in existing and started and not force:
            skipped += 1  # research as it stood at kickoff stays
            continue
        season = int(g.get("season") or day.year)
        teams = g.get("teams") or {}
        payload = {"asOf": (day - timedelta(days=1)).isoformat(), "season": season, "starters": {}}
        for side, opp in (("away", "home"), ("home", "away")):
            sp = (teams.get(side) or {}).get("probablePitcher")
            opp_team = ((teams.get(opp) or {}).get("team") or {}).get("id")
            if not sp or not opp_team:
                payload["starters"][side] = None
                continue
            hitters = await roster_hitters(client, opp_team, day)
            block = sr.starter_block(con, sp["id"], [h["id"] for h in hitters], season, day, REGULAR)
            pit_hist = await conn.fetch("""SELECT game_date, opponent_id, stats FROM player_game_history
                WHERE sport = 'mlb' AND athlete_id = $1 AND season = $2 AND game_date < $3 ORDER BY game_date""",
                                        str(sp["id"]), season, day)
            bat_hist = await conn.fetch("""SELECT athlete_id, stats FROM player_game_history
                WHERE sport = 'mlb' AND athlete_id = ANY($1::text[]) AND season = $2 AND game_date < $3""",
                                        [str(h["id"]) for h in hitters], season, day)
            by_hitter: dict[str, list] = {}
            for row in bat_hist:
                by_hitter.setdefault(row["athlete_id"], []).append(row)
            line = sr.pitcher_season_line(pit_hist)
            payload["starters"][side] = {
                "id": sp["id"], "name": sp.get("fullName"), "hand": block["hand"], **line,
                "mix": block["mix"], "pitches": block["pitches"],
                "vsLineup": [{**h, "order": None, "bats": block["hitters"][str(h["id"])]["bats"] or h["bats"],
                              "season": sr.hitter_season_line(by_hitter.get(str(h["id"]), [])),
                              "vsHand": block["hitters"][str(h["id"])]["vsHand"],
                              "vsPitcher": block["hitters"][str(h["id"])]["vsPitcher"]} for h in hitters],
            }
        if apply:
            await conn.execute("""INSERT INTO mlb_statcast_game_pregame (game_pk, game_date, season, as_of, payload, computed_at)
                VALUES ($1, $2, $3, $4, $5::jsonb, now())
                ON CONFLICT (game_pk) DO UPDATE SET game_date = excluded.game_date, season = excluded.season,
                    as_of = excluded.as_of, payload = excluded.payload, computed_at = now()""",
                               pk, day, season, day - timedelta(days=1), json.dumps(payload, separators=(",", ":")))
        written += 1
    return {"date": day.isoformat(), "games": len(games), "written": written, "kept_from_kickoff": skipped}


async def main(apply: bool, pregame_dates: list[date]) -> int:
    started = time.monotonic()
    today_et = datetime.now(ZoneInfo("America/New_York")).date()
    seasons = [today_et.year - 1, today_et.year]
    summary: dict = {"job": JOB_NAME, "started_at": datetime.now(timezone.utc).isoformat(), "apply": apply}
    pool = await db.get_pool()
    try:
        async with pool.acquire(timeout=120) as conn, httpx.AsyncClient(follow_redirects=True) as client:
            await conn.execute("SET statement_timeout = '10min'")
            mark = time.monotonic()
            con, summary["pitches"] = await load_pitches(conn)
            summary["pitches"]["seconds"] = round(time.monotonic() - mark, 1)
            summary["schedule_games"] = await load_schedule(client, con, seasons)
            summary["seasons"] = [await season_rollup(conn, client, con, s, apply) for s in seasons]
            dates = pregame_dates or [today_et, today_et + timedelta(days=1)]
            summary["pregame"] = [await pregame_for_date(conn, client, con, d, bool(pregame_dates), apply) for d in dates]
        summary["ok"] = True
    except Exception as exc:  # noqa: BLE001 — recorded in the breadcrumb, then re-raised
        summary.update(ok=False, error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        summary["elapsed_seconds"] = round(time.monotonic() - started, 1)
        print(json.dumps(summary, indent=1, default=str), flush=True)
        if apply:
            await db.write_job_run_log(JOB_NAME, summary)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write the tables (default: compute and report only)")
    ap.add_argument("--pregame-date", action="append", default=[], type=date.fromisoformat,
                    help="compute the pregame block for this date's games, even if they have started (repeatable)")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.apply, a.pregame_date)))
