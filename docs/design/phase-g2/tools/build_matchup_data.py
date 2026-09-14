"""Phase G2 mockup data — opponent / compare datasets, one per sport. Real data only.

Run from the repo root with the python-odds-service venv:
    python-odds-service/.venv/Scripts/python.exe docs/design/phase-g2/tools/build_matchup_data.py [sport ...]

Writes docs/design/phase-g2/data/matchup-<sport>.json, used by the player and team pages' compare control:
every team's per-game production for and allowed (and allowed to each position group), results, key players
with names, and each sport's matchup extras (NFL target maps offense/defense, NBA shot zones allowed, MLB team
splits by handedness from the Statcast corpus, tennis player serve/return profiles, golf field scoring).
"""
import asyncio
import csv
import glob
import io
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timezone

HERE = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "python-odds-service", "src"))
os.chdir(os.path.join(ROOT, "python-odds-service"))
from config import DATABASE_URL  # noqa: E402
import asyncpg  # noqa: E402
import g2lib as L  # noqa: E402

OUT = os.path.join(ROOT, "docs", "design", "phase-g2", "data")
SEASONS = {"nfl": (2026, 2025), "cfb": (2026, 2025), "nba": (2026, 2025), "nhl": (2025, 2024), "mlb": (2026, 2025), "soccer_epl": (2026, 2025)}
FILE = {"soccer_epl": "soccer"}
# Teams of the player subjects, for "next opponent" defaults (ids as stored in player_game_history).
SUBJECT_TEAMS = {"mlb": ["118", "116"], "nfl": ["6"], "cfb": ["194"], "nba": ["13", "7"], "nhl": ["10", "52"], "soccer_epl": ["382"]}
NFLVERSE_TO_ESPN = {"LA": "LAR", "WAS": "WSH", "OAK": "LV", "SD": "LAC", "STL": "LAR"}


def next_games(sport, tmap):
    out = {}
    today = date(2026, 9, 14)
    for tid in SUBJECT_TEAMS.get(sport, []):
        try:
            if sport == "mlb":
                d = L.get_json(f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId={tid}&startDate={today}&endDate=2026-10-05")
                g = next((g for dd in d["dates"] for g in dd["games"] if g["status"]["abstractGameState"] != "Final"), None)
                if g:
                    home = str(g["teams"]["home"]["team"]["id"]) == tid
                    opp = g["teams"]["away" if home else "home"]["team"]["id"]
                    out[tid] = {"date": g["gameDate"], "opp": str(opp), "home": home}
            elif sport == "nhl":
                abbr = tmap[tid]["abbr"]
                d = L.get_json(f"https://api-web.nhle.com/v1/club-schedule-season/{abbr}/20262027")
                g = next((g for g in d["games"] if g.get("gameType") == 2), None)
                if g:
                    home = g["homeTeam"]["abbrev"] == abbr
                    opp_abbr = g["awayTeam" if home else "homeTeam"]["abbrev"]
                    opp = next((k for k, v in tmap.items() if v["abbr"] == opp_abbr), None)
                    out[tid] = {"date": g["startTimeUTC"], "opp": opp, "home": home, "note": "next scheduled"}
            else:
                t = L.get_json(f"{L.SITE}/{L.ESPN_PATH[sport]}/teams/{tid}")["team"]
                ev = (t.get("nextEvent") or [None])[0]
                if ev:
                    comp = ev["competitions"][0]
                    me = next(c for c in comp["competitors"] if c["team"]["id"] == tid)
                    op = next(c for c in comp["competitors"] if c["team"]["id"] != tid)
                    done = comp.get("status", {}).get("type", {}).get("completed")
                    out[tid] = {"date": ev["date"], "opp": op["team"]["id"], "home": me.get("homeAway") == "home", "note": "most recent (completed)" if done else ("next scheduled" if sport == "nba" else None)}
        except Exception as e:
            print("  next game failed", sport, tid, e)
    return out


def espn_roster_positions(sport, team_ids):
    pos, meta = {}, {}

    def one(tid):
        try:
            d = L.get_json(f"{L.SITE}/{L.ESPN_PATH[sport]}/teams/{tid}/roster")
            ath = d.get("athletes", [])
            flat = [a for g in ath for a in g.get("items", [])] if ath and "items" in ath[0] else ath
            return [(a["id"], (a.get("position") or {}).get("abbreviation"), a.get("displayName"), (a.get("headshot") or {}).get("href")) for a in flat]
        except Exception:
            return []
    for rows in L.pmap(one, team_ids):
        for aid, p, name, hs in rows:
            pos[str(aid)] = p
            meta[str(aid)] = {"name": name, "pos": p, "headshot": hs}
    return pos, meta


def espn_athlete(sport, aid):
    league = {"nfl": "football/nfl", "cfb": "football/college-football", "nba": "basketball/nba", "soccer_epl": "soccer/eng.1"}[sport]
    try:
        a = L.get_json(f"https://site.web.api.espn.com/apis/common/v3/sports/{league}/athletes/{aid}")["athlete"]
        return aid, {"name": a.get("displayName"), "pos": (a.get("position") or {}).get("abbreviation"), "headshot": (a.get("headshot") or {}).get("href")}
    except Exception:
        return aid, None


# Production score for choosing key players (per game, so part-timers don't win on volume).
SCORE = {
    "nfl": lambda s: (s.get("passing.passingYards", 0) + s.get("rushing.rushingYards", 0) + s.get("receiving.receivingYards", 0)) + 25 * (s.get("defensive.sacks", 0) + s.get("interceptions.interceptions", 0)),
    "mlb": lambda s: s.get("bat_hits", 0) + 2 * s.get("bat_homeRuns", 0) + s.get("pit_strikeOuts", 0),
    "nba": lambda s: s.get("points", 0) + s.get("rebounds", 0) + s.get("assists", 0),
    "nhl": lambda s: 3 * (s.get("goals", 0) + s.get("assists", 0)) + s.get("sog", 0) + 0.1 * s.get("saves", 0),
    "soccer_epl": lambda s: 10 * (s.get("totalGoals", 0) + s.get("goalAssists", 0)) + s.get("totalShots", 0) + 0.5 * s.get("saves", 0),
}
SCORE["cfb"] = SCORE["nfl"]


def top_players(players, n=10, sport="nfl"):
    by_team = defaultdict(list)
    for aid, p in players.items():
        by_team[p["team"]].append((aid, p))
    score = SCORE.get(sport, lambda s: 0)
    return {t: sorted([x for x in ps if x[1]["g"] >= 3], key=lambda x: -score(x[1]["s"]) / x[1]["g"])[:n] for t, ps in by_team.items()}


async def nfl_extras(c, tmap, seasons, nflv):
    gsis_pos = {r["gsis_id"]: r.get("position") for r in nflv if r.get("gsis_id")}
    abbr_to_id = {v["abbr"]: k for k, v in tmap.items()}
    out = {}
    for season in seasons:
        rows = await c.fetch("SELECT game_id, team, receiver_id, pass_location, pass_length, complete_pass, air_yards FROM nfl_target_events WHERE season=$1", season)
        off, de = defaultdict(lambda: defaultdict(lambda: [0, 0])), defaultdict(lambda: defaultdict(lambda: [0, 0]))
        de_pos = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0])))
        league = defaultdict(lambda: [0, 0])
        games_off, games_def = defaultdict(set), defaultdict(set)
        for r in rows:
            parts = (r["game_id"] or "").split("_")
            if len(parts) < 4:
                continue
            away, home = NFLVERSE_TO_ESPN.get(parts[2], parts[2]), NFLVERSE_TO_ESPN.get(parts[3], parts[3])
            posteam = NFLVERSE_TO_ESPN.get(r["team"], r["team"])
            defteam = home if posteam == away else away
            t, d = abbr_to_id.get(posteam), abbr_to_id.get(defteam)
            if not t or not d or not r["pass_length"] or not r["pass_location"]:
                continue
            cell = f"{r['pass_length']}|{r['pass_location']}"
            comp = 1 if r["complete_pass"] else 0
            for bucket, tid, gset in ((off, t, games_off), (de, d, games_def)):
                bucket[tid][cell][0] += 1
                bucket[tid][cell][1] += comp
                gset[tid].add(r["game_id"])
            pg = {"WR": "WR", "TE": "TE", "RB": "RB", "FB": "RB"}.get(gsis_pos.get(r["receiver_id"]))
            if pg:
                de_pos[pg][d][cell][0] += 1
                de_pos[pg][d][cell][1] += comp
            league[cell][0] += 1
            league[cell][1] += comp
        pack = lambda b, g: {tid: {"g": len(g[tid]), "cells": {k: v for k, v in cells.items()}} for tid, cells in b.items()}  # noqa: E731
        out[str(season)] = {"off": pack(off, games_off), "def": pack(de, games_def), "defPos": {pg: pack(b, games_def) for pg, b in de_pos.items()}, "league": dict(league), "teams": len(games_off)}
    return out


def nba_zone(x, y, made, pv):
    import math
    yy = y + 4.25
    three = math.hypot(x - 25, yy - 5.25) >= 23.25 or (abs(x - 25) >= 21.5 and yy <= 14)
    val = pv if made else (3 if three else 2)
    if val == 3:
        return ("Corner 3" if yy < 14 else "Above-break 3"), val
    if math.hypot(x - 25, yy - 5.25) <= 4:
        return "Restricted area", val
    if abs(x - 25) <= 8 and yy <= 19:
        return "Paint (non-RA)", val
    return "Mid-range", val


async def nba_extras(c, pos):
    rows = await c.fetch("SELECT game_id, team_id, shooter_id, x_coord, y_coord, made, point_value FROM nba_shot_events WHERE season=2025 AND x_coord IS NOT NULL")
    teams_in_game = defaultdict(set)
    for r in rows:
        teams_in_game[r["game_id"]].add(str(r["team_id"]))
    agg = {"for": defaultdict(lambda: defaultdict(lambda: [0, 0, 0])), "allowed": defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))}
    agg_pos = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0, 0])))
    games = {"for": defaultdict(set), "allowed": defaultdict(set)}
    for r in rows:
        if r["y_coord"] > 43:
            continue
        t = str(r["team_id"])
        opp = next((x for x in teams_in_game[r["game_id"]] if x != t), None)
        z, val = nba_zone(r["x_coord"], r["y_coord"], r["made"], r["point_value"])
        pts = val if r["made"] else 0
        for side, tid in (("for", t), ("allowed", opp)):
            if tid is None:
                continue
            a = agg[side][tid][z]
            a[0] += 1
            a[1] += 1 if r["made"] else 0
            a[2] += pts
            games[side][tid].add(r["game_id"])
        pg = pos.get(str(r["shooter_id"]))
        if opp and pg:
            a = agg_pos[pg][opp][z]
            a[0] += 1
            a[1] += 1 if r["made"] else 0
            a[2] += pts
    keep = {t for t, g in games["for"].items() if len(g) >= 40}
    pack = lambda b, g: {t: {"g": len(g[t]), "zones": {z: v for z, v in zz.items()}} for t, zz in b.items() if t in keep}  # noqa: E731
    return {"season": "2024-25", "for": pack(agg["for"], games["for"]), "allowed": pack(agg["allowed"], games["allowed"]), "allowedPos": {pg: pack(b, games["allowed"]) for pg, b in agg_pos.items()}}


async def mlb_extras(c, season):
    """Team splits by handedness from the Statcast corpus: batting vs LHP/RHP and pitching vs LHH/RHH."""
    import pyarrow.dataset as ds
    team_of = {(str(r["event_id"]), str(r["athlete_id"])): str(r["team_id"]) for r in await c.fetch("SELECT event_id, athlete_id, team_id FROM player_game_history WHERE sport='mlb' AND season=$1", season)}
    files = sorted(glob.glob(os.path.join(ROOT, "python-odds-service", "corpus", "mlb_pitch_events", "*.parquet")))
    rows = [r for r in ds.dataset(files, format="parquet").to_table(columns=["season", "game_pk", "batter_id", "pitcher_id", "p_throws", "stand", "description", "events", "estimated_woba", "launch_speed"]).to_pylist() if r["season"] == season]
    WH = {"swinging_strike", "swinging_strike_blocked", "missed_bunt"}
    SW = WH | {"foul", "foul_tip", "hit_into_play", "foul_bunt"}
    acc = defaultdict(lambda: defaultdict(float))
    for r in rows:
        g = str(r["game_pk"])
        for side, tid, hand in (("bat", team_of.get((g, str(r["batter_id"]))), r["p_throws"]), ("pit", team_of.get((g, str(r["pitcher_id"]))), r["stand"])):
            if not tid or hand not in ("L", "R"):
                continue
            a = acc[(side, tid, hand)]
            a["pitches"] += 1
            a["swings"] += r["description"] in SW
            a["whiffs"] += r["description"] in WH
            if r["events"]:
                a["pa"] += 1
                a["k"] += r["events"] in ("strikeout", "strikeout_double_play")
                a["bb"] += r["events"] in ("walk", "intent_walk")
                a["hr"] += r["events"] == "home_run"
            if r["launch_speed"] is not None and r["description"] == "hit_into_play":
                a["bip"] += 1
                a["hard"] += r["launch_speed"] >= 95
                if r["estimated_woba"] is not None:
                    a["xw"] += r["estimated_woba"]
                    a["xwn"] += 1
    out = {"bat": defaultdict(dict), "pit": defaultdict(dict)}
    for (side, tid, hand), a in acc.items():
        d = lambda x, y: round(100 * x / y, 2) if y else None  # noqa: E731
        out[side][tid][hand] = {"pa": int(a["pa"]), "kPct": d(a["k"], a["pa"]), "bbPct": d(a["bb"], a["pa"]), "hrPct": d(a["hr"], a["pa"]), "whiff": d(a["whiffs"], a["swings"]), "hardHit": d(a["hard"], a["bip"]), "xwobacon": round(a["xw"] / a["xwn"], 3) if a["xwn"] else None}
    return {"season": season, "bat": out["bat"], "pit": out["pit"]}


async def build_team_sport(c, sport):
    cur, prev = SEASONS[sport]
    tmap = L.teams_map(sport)
    doc = {"sport": FILE.get(sport, sport), "builtAt": datetime.now(timezone.utc).isoformat(), "seasons": [cur, prev], "teams": tmap, "sources": [], "status": {}}
    results = await L.all_results(c, sport, since="2023-01-01")
    doc["results"] = {tid: [[str(d), o, h, pf, pa] for d, o, h, pf, pa in rs] for tid, rs in results.items()}
    doc["sources"].append("game_result via team_name_index (cross-source duplicates removed)")

    pos_of, names = None, {}
    if sport in ("nfl",):
        nflv = L.nflverse_players()
        espn_pos = {r["espn_id"]: r.get("position") for r in nflv if r.get("espn_id")}
        group = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}
        pos_of = lambda aid, st: group.get(espn_pos.get(aid))  # noqa: E731
        names = {r["espn_id"]: {"name": r.get("display_name"), "pos": r.get("position"), "headshot": r.get("headshot")} for r in nflv if r.get("espn_id")}
        doc["sources"].append("nflverse players.csv (positions, names)")
    elif sport == "nba":
        pos, names = espn_roster_positions(sport, list(tmap))
        grp = lambda p: None if not p else ("C" if "C" in p else "G" if p.startswith("G") or p in ("PG", "SG") else "F")  # noqa: E731
        pos_of = lambda aid, st: grp(pos.get(aid))  # noqa: E731
        doc["sources"].append("ESPN team rosters (positions)")
    elif sport == "soccer_epl":
        pos, names = espn_roster_positions(sport, list(tmap))
        pos_of = lambda aid, st: {"G": "GK", "D": "DEF", "M": "MID", "F": "FWD"}.get((pos.get(aid) or "")[:1])  # noqa: E731
        doc["sources"].append("ESPN team rosters (positions)")
    elif sport == "nhl":
        pos_of = lambda aid, st: "G" if st.get("isGoalie") or "saves" in st else "S"  # noqa: E731

    doc["rollup"] = {}
    all_players = {}
    for season in (cur, prev):
        r = await L.rollups(c, sport, season, pos_of=pos_of)
        players = r.pop("_players")
        doc["rollup"][str(season)] = r
        all_players[season] = players
    doc["sources"].append("player_game_history rolled up per team: for, allowed (by opponent), allowed to each position group")

    # Key players per team with names (CFB: only teams that played the subject team, to keep lookups sane).
    want_ids = set()
    tops = {}
    for season, players in all_players.items():
        t = top_players(players, 8, sport)
        if sport == "cfb":
            opps = {row[1] for row in results.get("194", [])} | {"194"}
            t = {k: v for k, v in t.items() if k in opps}
        tops[season] = t
        for ps in t.values():
            want_ids |= {aid for aid, _ in ps}
    missing = [a for a in want_ids if a not in names]
    if sport == "mlb":
        for i in range(0, len(missing), 80):
            d = L.get_json("https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(missing[i:i + 80]))
            for p in d.get("people", []):
                names[str(p["id"])] = {"name": p["fullName"], "pos": (p.get("primaryPosition") or {}).get("abbreviation"), "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/{p['id']}/headshot/67/current"}
    elif sport == "nhl":
        def one(aid):
            try:
                p = L.get_json(f"https://api-web.nhle.com/v1/player/{aid}/landing")
                return aid, {"name": f"{p['firstName']['default']} {p['lastName']['default']}", "pos": p.get("position"), "headshot": p.get("headshot")}
            except Exception:
                return aid, None
        names.update({a: m for a, m in L.pmap(one, missing) if m})
    elif missing:
        names.update({a: m for a, m in L.pmap(lambda a: espn_athlete(sport, a), missing) if m})
    doc["players"] = {str(season): {tid: [{"id": aid, **names.get(aid, {"name": None}), "g": p["g"], "s": {k: round(v, 2) for k, v in p["s"].items()}} for aid, p in ps if names.get(aid, {}).get("name")] for tid, ps in t.items()} for season, t in tops.items()}
    doc["next"] = next_games(sport, tmap)

    if sport == "nfl":
        doc["targets"] = await nfl_extras(c, tmap, (cur, prev), nflv)
        doc["sources"].append("nfl_target_events: throw maps for offense and against each defense, by receiver position")
    if sport == "nba":
        doc["shots"] = await nba_extras(c, pos)
        doc["sources"].append("nba_shot_events 2024-25: zones for and allowed, allowed by shooter position (rim-origin corrected)")
    if sport == "mlb":
        doc["hand"] = await mlb_extras(c, cur)
        doc["sources"].append("Statcast corpus 2026: team batting vs LHP/RHP and pitching vs LHH/RHH (joined through player_game_history)")
    path = os.path.join(OUT, f"matchup-{FILE.get(sport, sport)}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{sport}: {os.path.getsize(path) // 1024} KB · teams {len(tmap)} · next {doc['next']}", flush=True)


async def build_tennis(c):
    rows = []
    for yr in (2025, 2026):
        rows += [dict(r, _yr=yr) for r in csv.DictReader(io.StringIO(L.get_text(f"https://stats.tennismylife.org/data/{yr}.csv")))]
    num = lambda v: float(v) if v not in (None, "") else None  # noqa: E731
    prof = defaultdict(lambda: defaultdict(float))
    meta = {}
    for r in rows:
        for me, op, won in (("w", "l", True), ("l", "w", False)):
            name = r[f"{'winner' if won else 'loser'}_name"]
            p = prof[(name, r["_yr"])]
            vals = {k: num(r.get(f"{me}_{k}")) for k in ("ace", "df", "svpt", "1stIn", "1stWon", "2ndWon", "SvGms", "bpSaved", "bpFaced")}
            ovals = {k: num(r.get(f"{op}_{k}")) for k in ("svpt", "1stWon", "2ndWon", "bpSaved", "bpFaced")}
            p["m"] += 1
            p["w"] += won
            p[f"w_{r['surface']}"] += won
            p[f"m_{r['surface']}"] += 1
            if vals["svpt"] and ovals["svpt"]:
                p["sm"] += 1
                for k, v in vals.items():
                    p[k] += v or 0
                for k, v in ovals.items():
                    p["o" + k] += v or 0
            rank = num(r.get(f"{'winner' if won else 'loser'}_rank"))
            if rank:
                meta[name] = {"rank": rank, "hand": r.get(f"{'winner' if won else 'loser'}_hand"), "ioc": r.get(f"{'winner' if won else 'loser'}_ioc")}
    players = {}
    for (name, yr), p in prof.items():
        if p["m"] < 10:
            continue
        d = lambda x, y: round(100 * x / y, 1) if y else None  # noqa: E731
        players.setdefault(name, {**meta.get(name, {})})[str(yr)] = {"matches": int(p["m"]), "wins": int(p["w"]), "hard": [int(p["w_Hard"]), int(p["m_Hard"])], "clay": [int(p["w_Clay"]), int(p["m_Clay"])], "grass": [int(p["w_Grass"]), int(p["m_Grass"])],
                                                                  "acesPerMatch": round(p["ace"] / p["sm"], 2) if p["sm"] else None, "firstIn": d(p["1stIn"], p["svpt"]), "firstWon": d(p["1stWon"], p["1stIn"]), "secondWon": d(p["2ndWon"], p["svpt"] - p["1stIn"]),
                                                                  "bpSaved": d(p["bpSaved"], p["bpFaced"]), "returnWon": d(p["osvpt"] - p["o1stWon"] - p["o2ndWon"], p["osvpt"]), "bpConverted": d(p["obpFaced"] - p["obpSaved"], p["obpFaced"])}
    h2h = defaultdict(list)
    for r in rows:
        pair = tuple(sorted((r["winner_name"], r["loser_name"])))
        h2h["|".join(pair)].append([r["tourney_date"], r["tourney_name"], r["surface"], r["round"], r["winner_name"], r["score"]])
    keep = {n for n, p in players.items() if (p.get("rank") or 999) <= 60}
    doc = {"sport": "tennis", "builtAt": datetime.now(timezone.utc).isoformat(), "players": {n: p for n, p in players.items() if n in keep},
           "h2h": {k: v for k, v in h2h.items() if all(x in keep for x in k.split("|"))}, "sources": ["TennisMyLife 2025–2026 CSVs (serve, return and break-point rates per player; head-to-head)"]}
    path = os.path.join(OUT, "matchup-tennis.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"tennis: {os.path.getsize(path) // 1024} KB · players {len(doc['players'])}", flush=True)


async def build_golf(c):
    events = [r["event_id"] for r in await c.fetch("SELECT DISTINCT event_id FROM golf_round_scores WHERE espn_id='9478'")]
    rows = await c.fetch("SELECT event_id, espn_id, round, total_strokes, relative_to_par FROM golf_round_scores WHERE event_id = ANY($1::text[])", events)
    names = {r["event_id"]: {"name": r["name"], "course": r["course_name"]} for r in await c.fetch("SELECT event_id, name, course_name FROM golf_tournaments WHERE event_id = ANY($1::text[])", events)}
    players = defaultdict(lambda: defaultdict(list))
    for r in rows:
        players[r["espn_id"]][r["event_id"]].append([r["round"], r["total_strokes"], r["relative_to_par"]])
    # Names for the top of each field.
    totals = defaultdict(dict)
    for pid, evs in players.items():
        for eid, rs in evs.items():
            totals[eid][pid] = sum(x[2] or 0 for x in rs) if len(rs) >= 4 else None
    want = set()
    for eid, t in totals.items():
        want |= {p for p, v in sorted(((p, v) for p, v in t.items() if v is not None), key=lambda x: x[1])[:25]}
    want.add("9478")

    def one(pid):
        try:
            a = L.get_json(f"https://site.web.api.espn.com/apis/common/v3/sports/golf/pga/athletes/{pid}")["athlete"]
            return pid, {"name": a.get("displayName"), "headshot": (a.get("headshot") or {}).get("href")}
        except Exception:
            return pid, None
    meta = {p: m for p, m in L.pmap(one, sorted(want)) if m}
    doc = {"sport": "golf", "builtAt": datetime.now(timezone.utc).isoformat(), "events": names, "rounds": {pid: evs for pid, evs in players.items()}, "names": meta,
           "sources": ["golf_round_scores for every player in the subject's events", "golf_tournaments (names)", "ESPN athlete API (names for the top 25 of each field)"]}
    path = os.path.join(OUT, "matchup-golf.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"golf: {os.path.getsize(path) // 1024} KB · players {len(players)}", flush=True)


async def main():
    wanted = sys.argv[1:] or ["nfl", "cfb", "nba", "nhl", "mlb", "soccer_epl", "tennis", "golf"]
    c = await asyncpg.connect(DATABASE_URL, statement_cache_size=0)
    try:
        for s in wanted:
            try:
                if s == "tennis":
                    await build_tennis(c)
                elif s == "golf":
                    await build_golf(c)
                else:
                    await build_team_sport(c, s)
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"{s}: FAILED {e}", flush=True)
    finally:
        await c.close()


asyncio.run(main())
