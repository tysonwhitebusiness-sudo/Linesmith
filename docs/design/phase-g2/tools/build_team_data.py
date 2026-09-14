"""Phase G2 mockup data — team page, every team sport. Real data only.

Run from the repo root with the python-odds-service venv:
    python-odds-service/.venv/Scripts/python.exe docs/design/phase-g2/tools/build_team_data.py [slug ...]

Writes docs/design/phase-g2/data/team-<sport>-<slug>.json.
Sources: ESPN team / schedule / standings / core statistics (with league ranks where ESPN publishes them;
computed across every team where it does not), player_game_history (player season totals, soccer team
totals), the Statcast corpus (MLB team contact and pitching, joined to teams through player_game_history),
nfl_target_events (target share and pass map), nba_shot_events and nhl_shot_events (shot profiles),
statsapi / NHL / ESPN athlete APIs and nflverse players.csv for names.
"""
import asyncio
import csv
import glob
import io
import json
import math
import os
import statistics
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python-odds-service", "src"))
os.chdir(os.path.join(ROOT, "python-odds-service"))
from config import DATABASE_URL  # noqa: E402
import asyncpg  # noqa: E402

OUT = os.path.join(ROOT, "docs", "design", "phase-g2", "data")
UA = {"User-Agent": "Mozilla/5.0"}
SITE = "https://site.api.espn.com/apis/site/v2/sports"
CORE = "https://sports.core.api.espn.com/v2/sports"

TEAMS = {
    "mlb-royals": dict(sport="mlb", path="baseball/mlb", core=("baseball", "mlb"), espn="7", db="mlb", team="118", cur=2026, prev=2025, pgh=(2026, 2025), label="Kansas City Royals"),
    "nfl-raiders": dict(sport="nfl", path="football/nfl", core=("football", "nfl"), espn="13", db="nfl", team="13", abbr="LV", cur=2026, prev=2025, pgh=(2026, 2025), label="Las Vegas Raiders"),
    "cfb-ohio-state": dict(sport="cfb", path="football/college-football", core=("football", "college-football"), espn="194", db="cfb", team="194", cur=2026, prev=2025, pgh=(2026, 2025), label="Ohio State Buckeyes"),
    "nba-lakers": dict(sport="nba", path="basketball/nba", core=("basketball", "nba"), espn="13", db="nba", team="13", cur=2026, prev=2025, pgh=(2026, 2025), label="Los Angeles Lakers (2025-26)"),
    "nhl-maple-leafs": dict(sport="nhl", path="hockey/nhl", core=("hockey", "nhl"), espn="21", db="nhl", team="10", nhl_abbr="TOR", cur=2026, prev=2025, pgh=(2025, 2024), label="Toronto Maple Leafs (2025-26)"),
    "soccer-man-city": dict(sport="soccer", path="soccer/eng.1", core=None, espn="382", db="soccer_epl", team="382", cur=2026, prev=2025, pgh=(2026, 2025), label="Manchester City"),
}

# Stats shown with league rank: (group, ESPN category, stat name, label, better). Ranks are computed across every
# team rather than taken from ESPN, whose published ranks exceed the number of teams and carry no direction.
FOOTBALL = [
    ("Offense", "scoring", "totalPointsPerGame", "Points / game", "high"), ("Offense", "passing", "yardsPerGame", "Yards / game", "high"), ("Offense", "passing", "passingYardsPerGame", "Pass yards / game", "high"),
    ("Offense", "passing", "yardsPerPassAttempt", "Yards / pass attempt", "high"), ("Offense", "rushing", "rushingYardsPerGame", "Rush yards / game", "high"), ("Offense", "rushing", "yardsPerRushAttempt", "Yards / rush", "high"),
    ("Offense", "passing", "interceptions", "Interceptions thrown", "low"), ("Offense", "passing", "sacks", "Sacks allowed", "low"),
    ("Situational", "miscellaneous", "thirdDownConvPct", "3rd down conversion %", "high"), ("Situational", "miscellaneous", "redzoneScoringPct", "Red zone scoring %", "high"), ("Situational", "miscellaneous", "turnOverDifferential", "Turnover differential", "high"),
    ("Situational", "miscellaneous", "totalPenaltyYards", "Penalty yards", "low"), ("Situational", "miscellaneous", "possessionTimeSeconds", "Time of possession (sec)", "high"),
    ("Defense", "defensive", "sacks", "Sacks", "high"), ("Defense", "defensive", "tacklesForLoss", "Tackles for loss", "high"), ("Defense", "defensiveInterceptions", "interceptions", "Interceptions", "high"), ("Defense", "defensive", "passesDefended", "Passes defended", "high"),
]
RANKED = {
    "mlb": [("Hitting", "batting", "runs", "Runs", "high"), ("Hitting", "batting", "avg", "AVG", "high"), ("Hitting", "batting", "onBasePct", "OBP", "high"), ("Hitting", "batting", "slugAvg", "SLG", "high"), ("Hitting", "batting", "OPS", "OPS", "high"),
            ("Hitting", "batting", "homeRuns", "Home runs", "high"), ("Hitting", "batting", "isolatedPower", "ISO", "high"), ("Hitting", "batting", "walks", "Walks", "high"), ("Hitting", "batting", "strikeouts", "Strikeouts", "low"), ("Hitting", "batting", "stolenBases", "Stolen bases", "high"),
            ("Pitching", "pitching", "ERA", "ERA", "low"), ("Pitching", "pitching", "WHIP", "WHIP", "low"), ("Pitching", "pitching", "strikeouts", "Strikeouts", "high"), ("Pitching", "pitching", "walks", "Walks allowed", "low"), ("Pitching", "pitching", "homeRuns", "Home runs allowed", "low"),
            ("Pitching", "pitching", "opponentAvg", "Opponent AVG", "low"), ("Pitching", "pitching", "qualityStarts", "Quality starts", "high"), ("Pitching", "pitching", "saves", "Saves", "high"), ("Pitching", "pitching", "blownSaves", "Blown saves", "low")],
    "nfl": FOOTBALL,
    "cfb": FOOTBALL,
    "nba": [("Offense", "offensive", "avgPoints", "Points / game", "high"), ("Offense", "offensive", "fieldGoalPct", "FG%", "high"), ("Offense", "offensive", "threePointFieldGoalPct", "3P%", "high"), ("Offense", "offensive", "avgThreePointFieldGoalsAttempted", "3PA / game", "high"),
            ("Offense", "offensive", "freeThrowPct", "FT%", "high"), ("Offense", "offensive", "avgFreeThrowsAttempted", "FTA / game", "high"), ("Offense", "offensive", "avgAssists", "Assists / game", "high"), ("Offense", "offensive", "avgTurnovers", "Turnovers / game", "low"),
            ("Offense", "offensive", "avgOffensiveRebounds", "Off. rebounds / game", "high"), ("Offense", "general", "assistTurnoverRatio", "AST/TO", "high"),
            ("Defense", "general", "avgRebounds", "Rebounds / game", "high"), ("Defense", "defensive", "avgSteals", "Steals / game", "high"), ("Defense", "defensive", "avgBlocks", "Blocks / game", "high"), ("Defense", "defensive", "avgDefensiveRebounds", "Def. rebounds / game", "high")],
    "nhl": [("Offense", "offensive", "avgGoals", "Goals / game", "high"), ("Offense", "offensive", "avgShots", "Shots / game", "high"), ("Offense", "offensive", "shootingPct", "Shooting %", "high"), ("Special teams", "offensive", "powerPlayPct", "Power play %", "high"),
            ("Special teams", "defensive", "penaltyKillPct", "Penalty kill %", "high"), ("Defense", "defensive", "avgGoalsAgainst", "Goals against / game", "low"), ("Defense", "defensive", "avgShotsAgainst", "Shots against / game", "low"), ("Defense", "defensive", "savePct", "Save %", "high"),
            ("Special teams", "offensive", "faceoffPercent", "Faceoff %", "high"), ("Special teams", "penalties", "penaltyMinutes", "Penalty minutes", "low")],
}


def get_json(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)


def get_text(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def team_info(cfg):
    t = get_json(f"{SITE}/{cfg['path']}/teams/{cfg['espn']}")["team"]
    nxt = (t.get("nextEvent") or [None])[0]
    nxt_out = None
    if nxt:
        comp = nxt["competitions"][0]
        opp = next((c for c in comp["competitors"] if c["team"]["id"] != cfg["espn"]), None)
        me = next((c for c in comp["competitors"] if c["team"]["id"] == cfg["espn"]), None)
        nxt_out = dict(id=nxt["id"], date=nxt["date"], name=nxt.get("shortName"), home=(me or {}).get("homeAway") == "home", opp=opp and dict(abbr=opp["team"].get("abbreviation"), name=opp["team"].get("displayName"), logo=((opp["team"].get("logos") or [{}])[0]).get("href")),
                       completed=comp.get("status", {}).get("type", {}).get("completed"), venue=(comp.get("venue") or {}).get("fullName"))
    return dict(id=t["id"], abbr=t.get("abbreviation"), name=t.get("displayName"), short=t.get("shortDisplayName"), color="#" + (t.get("color") or "333333"), alt="#" + (t.get("alternateColor") or "999999"),
                logo=((t.get("logos") or [{}])[0]).get("href"), standing=t.get("standingSummary"), rank=t.get("rank"),
                record={i.get("type"): i.get("summary") for i in (t.get("record") or {}).get("items", [])},
                venue=((t.get("franchise") or {}).get("venue") or {}).get("fullName"), next=nxt_out)


def schedule(cfg, season):
    extra = "&seasontype=2" if cfg["sport"] in ("nba", "nhl", "mlb") else ""
    d = get_json(f"{SITE}/{cfg['path']}/teams/{cfg['espn']}/schedule?season={season}{extra}")
    out = []
    for e in d.get("events", []):
        comp = e["competitions"][0]
        me = next((c for c in comp["competitors"] if c["team"]["id"] == cfg["espn"]), None)
        opp = next((c for c in comp["competitors"] if c["team"]["id"] != cfg["espn"]), None)
        if not me or not opp:
            continue
        score = lambda c: num((c.get("score") or {}).get("value") if isinstance(c.get("score"), dict) else c.get("score"))  # noqa: E731
        done = comp.get("status", {}).get("type", {}).get("completed")
        us, them = score(me), score(opp)
        out.append(dict(id=e["id"], date=e["date"], home=me.get("homeAway") == "home", done=bool(done), us=us if done else None, them=them if done else None,
                        result=("W" if us > them else "L" if us < them else "D") if done and us is not None and them is not None else None,
                        opp=dict(id=opp["team"]["id"], abbr=opp["team"].get("abbreviation"), name=opp["team"].get("displayName"), logo=((opp["team"].get("logos") or [{}])[0]).get("href")),
                        type=(e.get("seasonType") or {}).get("name") or (e.get("league") or {}).get("abbreviation"), week=(e.get("week") or {}).get("text"), venue=(comp.get("venue") or {}).get("fullName"),
                        oppRank=((opp.get("curatedRank") or {}).get("current")) if cfg["sport"] == "cfb" else None))
    return out


def core_stats(cfg, season, team_id=None):
    sp, lg = cfg["core"]
    d = get_json(f"{CORE}/{sp}/leagues/{lg}/seasons/{season}/types/2/teams/{team_id or cfg['espn']}/statistics")
    cats = []
    for c in d["splits"]["categories"]:
        cats.append(dict(name=c["name"], label=c.get("displayName"), stats=[[s["name"], s.get("displayName"), s.get("displayValue"), s.get("perGameDisplayValue"), s.get("rank"), s.get("value"), s.get("abbreviation")] for s in c.get("stats", [])]))
    return cats


def league_ranks(cfg, season):
    """Fetch every team's ESPN statistics for the season and rank the curated list.

    Football ranks on ESPN's per-game value where it gives one (teams have played different numbers of games early on);
    rates and averages rank on the value itself.
    """
    from concurrent.futures import ThreadPoolExecutor
    q = "?groups=80&limit=300" if cfg["sport"] == "cfb" else ""
    teams = [t["team"]["id"] for t in get_json(f"{SITE}/{cfg['path']}/teams{q}")["sports"][0]["leagues"][0]["teams"]]

    def one(tid):
        try:
            return tid, {(c["name"], st[0]): st for c in core_stats(cfg, season, tid) for st in c["stats"]}
        except Exception:
            return tid, None
    with ThreadPoolExecutor(8) as ex:
        table = {tid: st for tid, st in ex.map(one, teams) if st}

    # Football counting stats rank per game (teams have played different numbers of games); rates rank as they are.
    per_game = {("passing", "interceptions"), ("passing", "sacks"), ("miscellaneous", "totalPenaltyYards"), ("miscellaneous", "possessionTimeSeconds"),
                ("defensive", "sacks"), ("defensive", "tacklesForLoss"), ("defensiveInterceptions", "interceptions"), ("defensive", "passesDefended")}

    def games(st):
        for key in (("general", "gamesPlayed"), ("passing", "teamGamesPlayed"), ("scoring", "teamGamesPlayed")):
            if key in st and st[key][5]:
                return st[key][5]
        return None

    def val(st, cat, name):
        row = st.get((cat, name))
        if not row or row[5] is None:
            return None
        if cfg["sport"] in ("nfl", "cfb") and (cat, name) in per_game:
            g = games(st)
            return row[5] / g if g else None
        return row[5]

    def show(v, cat, name, raw):
        if cfg["sport"] in ("nfl", "cfb") and (cat, name) in per_game:
            if name == "possessionTimeSeconds":
                return f"{int(v // 60)}:{int(round(v % 60)):02d}"
            return f"{v:.1f}"
        return raw
    out = []
    for group, cat, name, label, better in RANKED[cfg["sport"]]:
        league = {tid: val(st, cat, name) for tid, st in table.items()}
        league = {tid: v for tid, v in league.items() if v is not None}
        if cfg["espn"] not in league or len(set(league.values())) <= 1:
            continue  # no value, or no variation across the league (ESPN CFB red-zone % is 0 for every team)
        if cfg["sport"] == "cfb" and name == "possessionTimeSeconds":
            continue  # ESPN CFB possession time is incomplete (about half a game per game)
        mine = league[cfg["espn"]]
        order = sorted(league.values(), reverse=(better == "high"))
        pg = cfg["sport"] in ("nfl", "cfb") and (cat, name) in per_game
        out.append(dict(group=group, cat=cat, name=name, label=(label.replace(" (sec)", "") + " / game") if pg else label, better=better, value=mine,
                        display=show(mine, cat, name, table[cfg["espn"]][(cat, name)][2]), rank=order.index(mine) + 1, of=len(order), league=sorted(league.values())))
    return out


def standings(cfg, season):
    d = get_json(f"https://site.api.espn.com/apis/v2/sports/{cfg['path']}/standings?season={season}")
    groups = d.get("children") or [d]
    for g in groups:
        entries = (g.get("standings") or {}).get("entries", [])
        if any(e["team"]["id"] == cfg["espn"] for e in entries):
            rows = []
            for e in entries:
                st = {s.get("name") or s.get("type"): s.get("displayValue") for s in e.get("stats", [])}
                rows.append(dict(id=e["team"]["id"], abbr=e["team"].get("abbreviation"), name=e["team"].get("displayName"), logo=((e["team"].get("logos") or [{}])[0]).get("href"), stats=st))
            return dict(group=g.get("name"), season=(g.get("standings") or {}).get("seasonDisplayName"), rows=rows)
    return None


async def players(c, cfg, season):
    rows = await c.fetch("SELECT athlete_id, stats FROM player_game_history WHERE sport=$1 AND team_id=$2 AND season=$3", cfg["db"], cfg["team"], season)
    agg = defaultdict(lambda: {"games": 0, "t": defaultdict(float)})
    for r in rows:
        st = r["stats"] if isinstance(r["stats"], dict) else json.loads(r["stats"])
        a = agg[r["athlete_id"]]
        a["games"] += 1
        for k, v in st.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                a["t"][k] += v
        # Innings pitched is written as whole.thirds (6.2 = 6 and 2/3); summing it directly is wrong, so carry outs.
        ip = st.get("pit_inningsPitched")
        if isinstance(ip, (int, float)):
            a["t"]["pit_outs"] += int(ip) * 3 + round((ip - int(ip)) * 10)
    return {aid: {"games": a["games"], "totals": {k: round(v, 3) for k, v in a["t"].items()}} for aid, a in agg.items()}


def names_for(cfg, ids):
    out = {}
    if cfg["sport"] == "mlb":
        for i in range(0, len(ids), 60):
            d = get_json("https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(ids[i:i + 60]))
            for p in d.get("people", []):
                out[str(p["id"])] = dict(name=p["fullName"], pos=(p.get("primaryPosition") or {}).get("abbreviation"), headshot=f"https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/{p['id']}/headshot/67/current")
    elif cfg["sport"] == "nhl":
        for pid in ids:
            try:
                p = get_json(f"https://api-web.nhle.com/v1/player/{pid}/landing")
                out[pid] = dict(name=f"{p['firstName']['default']} {p['lastName']['default']}", pos=p.get("position"), headshot=p.get("headshot"))
            except Exception:
                pass
    else:
        league = {"nfl": "football/nfl", "cfb": "football/college-football", "nba": "basketball/nba", "soccer": "soccer/eng.1"}[cfg["sport"]]
        for pid in ids:
            try:
                a = get_json(f"https://site.web.api.espn.com/apis/common/v3/sports/{league}/athletes/{pid}")["athlete"]
                out[pid] = dict(name=a.get("displayName"), pos=(a.get("position") or {}).get("abbreviation"), headshot=(a.get("headshot") or {}).get("href"))
            except Exception:
                pass
    return out


def corpus_rows(columns):
    import pyarrow.dataset as ds
    files = sorted(glob.glob(os.path.join(ROOT, "python-odds-service", "corpus", "mlb_pitch_events", "*.parquet")))
    return ds.dataset(files, format="parquet").to_table(columns=columns).to_pylist()


async def mlb_statcast(c, cfg, season):
    team_of = {}
    for r in await c.fetch("SELECT event_id, athlete_id, team_id FROM player_game_history WHERE sport='mlb' AND season=$1", season):
        team_of[(str(r["event_id"]), str(r["athlete_id"]))] = r["team_id"]
    rows = [r for r in corpus_rows(["season", "game_pk", "batter_id", "pitcher_id", "zone", "launch_speed", "launch_angle", "description", "events", "release_speed", "pitch_type"]) if r["season"] == season]
    SW = {"swinging_strike", "swinging_strike_blocked", "foul", "foul_tip", "hit_into_play", "foul_bunt", "missed_bunt"}
    WH = {"swinging_strike", "swinging_strike_blocked", "missed_bunt"}
    PA_END = {"strikeout", "walk", "single", "double", "triple", "home_run", "field_out", "grounded_into_double_play", "force_out", "sac_fly", "hit_by_pitch", "fielders_choice", "double_play", "field_error", "strikeout_double_play", "fielders_choice_out", "sac_bunt", "intent_walk", "catcher_interf", "sac_fly_double_play", "triple_play"}
    acc = {side: defaultdict(lambda: defaultdict(float)) for side in ("bat", "pit")}
    unmatched = 0
    for r in rows:
        g = str(r["game_pk"])
        bt, pt = team_of.get((g, str(r["batter_id"]))), team_of.get((g, str(r["pitcher_id"])))
        if not bt and not pt:
            unmatched += 1
        for side, t in (("bat", bt), ("pit", pt)):
            if not t:
                continue
            a = acc[side][t]
            a["pitches"] += 1
            swing = r["description"] in SW
            outside = r["zone"] is not None and r["zone"] > 9
            a["swings"] += swing
            a["whiffs"] += r["description"] in WH
            a["outside"] += outside
            a["chase"] += outside and swing
            if r["events"] in PA_END:
                a["pa"] += 1
                a["k"] += r["events"] in ("strikeout", "strikeout_double_play")
                a["bb"] += r["events"] in ("walk", "intent_walk")
                a["hr"] += r["events"] == "home_run"
            if r["launch_speed"] is not None and r["description"] == "hit_into_play":
                a["bip"] += 1
                a["ev"] += r["launch_speed"]
                a["hard"] += r["launch_speed"] >= 95
                la = r["launch_angle"]
                a["sweet"] += la is not None and 8 <= la <= 32
                a["barrel"] += la is not None and r["launch_speed"] >= 98 and 26 <= la <= 30
            if side == "pit" and r["pitch_type"] == "FF" and r["release_speed"]:
                a["ffn"] += 1
                a["ffv"] += r["release_speed"]

    def metrics(a):
        d = lambda x, y: (100 * x / y) if y else None  # noqa: E731
        return {"avgEV": a["ev"] / a["bip"] if a["bip"] else None, "hardHit": d(a["hard"], a["bip"]), "sweetSpot": d(a["sweet"], a["bip"]), "barrelish": d(a["barrel"], a["bip"]), "kPct": d(a["k"], a["pa"]), "bbPct": d(a["bb"], a["pa"]),
                "whiff": d(a["whiffs"], a["swings"]), "chase": d(a["chase"], a["outside"]), "hrPct": d(a["hr"], a["pa"]), "ffVelo": a["ffv"] / a["ffn"] if a["ffn"] else None, "pitches": a["pitches"]}
    out = {}
    for side in ("bat", "pit"):
        league = {t: metrics(a) for t, a in acc[side].items()}
        out[side] = {"team": league.get(cfg["team"]), "league": {k: sorted(v[k] for v in league.values() if v[k] is not None) for k in (league.get(cfg["team"]) or {})}, "teams": len(league)}
    out["pitchesJoined"] = len(rows) - unmatched
    out["pitchesTotal"] = len(rows)
    return out


async def nfl_targets(c, cfg, seasons):
    players_csv = get_text("https://github.com/nflverse/nflverse-data/releases/download/players/players.csv")
    names = {row["gsis_id"]: dict(name=row.get("display_name") or row.get("football_name"), pos=row.get("position"), espn=row.get("espn_id"), headshot=row.get("headshot")) for row in csv.DictReader(io.StringIO(players_csv)) if row.get("gsis_id")}
    out = {}
    for season in seasons:
        rows = await c.fetch("SELECT receiver_id, passer_id, air_yards, pass_location, pass_length, yards_after_catch, complete_pass, touchdown, interception, team FROM nfl_target_events WHERE season=$1", season)
        mine = [r for r in rows if r["team"] == cfg["abbr"]]
        if not mine:
            continue
        by = defaultdict(list)
        for r in mine:
            by[r["receiver_id"]].append(r)
        recv = []
        for rid, rs in by.items():
            air = [r["air_yards"] for r in rs if r["air_yards"] is not None]
            recv.append(dict(id=rid, **names.get(rid, {"name": rid}), targets=len(rs), share=100 * len(rs) / len(mine), adot=statistics.mean(air) if air else None, catches=sum(1 for r in rs if r["complete_pass"]), tds=sum(1 for r in rs if r["touchdown"]),
                             deep=sum(1 for r in rs if r["pass_length"] == "deep"), yac=sum((r["yards_after_catch"] or 0) for r in rs if r["complete_pass"])))
        recv.sort(key=lambda x: -x["targets"])

        def grid(rs):
            g = defaultdict(lambda: [0, 0])
            for r in rs:
                if r["pass_length"] and r["pass_location"]:
                    g[f"{r['pass_length']}|{r['pass_location']}"][0] += 1
                    g[f"{r['pass_length']}|{r['pass_location']}"][1] += 1 if r["complete_pass"] else 0
            tot = sum(v[0] for v in g.values())
            return {k: dict(att=v[0], share=100 * v[0] / tot if tot else None, comp=100 * v[1] / v[0] if v[0] else None) for k, v in g.items()}
        teams = {r["team"] for r in rows}
        out[str(season)] = dict(total=len(mine), receivers=recv[:14], grid=grid(mine), leagueGrid=grid(rows), leagueTeams=len(teams), passers=Counter(names.get(r["passer_id"], {}).get("name", r["passer_id"]) for r in mine).most_common(4))
    return out


def nba_zone(x, y, made, pv):
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


async def nba_shots(c, cfg):
    rows = await c.fetch("SELECT team_id, x_coord, y_coord, made, point_value, game_id FROM nba_shot_events WHERE season=2025 AND x_coord IS NOT NULL")
    zones = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    games = defaultdict(set)
    bins = defaultdict(lambda: [0, 0])
    lbins = defaultdict(lambda: [0, 0])
    for r in rows:
        if r["y_coord"] > 43:
            continue
        z, val = nba_zone(r["x_coord"], r["y_coord"], r["made"], r["point_value"])
        t = str(r["team_id"])
        zones[t][z][0] += 1
        zones[t][z][1] += 1 if r["made"] else 0
        zones[t][z][2] += val if r["made"] else 0
        games[t].add(r["game_id"])
        key = f"{int(r['x_coord'] // 3)}|{int((r['y_coord'] + 4.25) // 3)}"
        lbins[key][0] += 1
        lbins[key][1] += 1 if r["made"] else 0
        if t == cfg["team"]:
            bins[key][0] += 1
            bins[key][1] += 1 if r["made"] else 0
    zone_names = ["Restricted area", "Paint (non-RA)", "Mid-range", "Corner 3", "Above-break 3"]
    # Only real franchises (All-Star and exhibition teams have a handful of games).
    per_team = {t: {z: dict(fga_pg=v[0] / len(games[t]), fg=100 * v[1] / v[0] if v[0] else None, pps=v[2] / v[0] if v[0] else None, share=100 * v[0] / sum(x[0] for x in zz.values())) for z, v in zz.items()} for t, zz in zones.items() if len(games[t]) >= 40}
    mine = per_team.get(cfg["team"], {})
    league = {z: {k: sorted(pt[z][k] for pt in per_team.values() if z in pt and pt[z][k] is not None) for k in ("fga_pg", "fg", "pps", "share")} for z in zone_names}
    n_team = len(games.get(cfg["team"], [])) or 1
    n_league_games = sum(len(g) for g in games.values()) or 1
    return dict(season="2024-25", zones=[dict(zone=z, **(mine.get(z) or {})) for z in zone_names], league=league, teams=len(per_team), games=len(games.get(cfg["team"], [])),
                bins=[[k, v[0] / n_team, v[1]] for k, v in bins.items()], leagueBins=[[k, v[0] / n_league_games, v[1]] for k, v in lbins.items()])


async def nhl_shots(c, cfg):
    rows = await c.fetch("SELECT game_id, team_id, event_type, shot_type, x_coord, y_coord FROM nhl_shot_events WHERE season='20242025' AND x_coord IS NOT NULL")
    rows = [r for r in rows if str(r["game_id"])[4:6] == "02"]  # regular season only (NHL game ids: 01 preseason, 02 regular, 03 playoffs)
    tid = int(cfg["team"])
    my_games = {r["game_id"] for r in rows if r["team_id"] == tid}
    bins = {"for": defaultdict(lambda: [0, 0]), "against": defaultdict(lambda: [0, 0])}
    types = {"for": Counter(), "against": Counter()}
    league_att = defaultdict(int)
    games_by_team = defaultdict(set)
    for r in rows:
        games_by_team[r["team_id"]].add(r["game_id"])
        league_att[r["team_id"]] += 1
        if r["game_id"] not in my_games:
            continue
        side = "for" if r["team_id"] == tid else "against"
        x, y = abs(r["x_coord"]), r["y_coord"] if r["x_coord"] >= 0 else -r["y_coord"]
        k = f"{int(x // 5)}|{int((y + 42.5) // 5)}"
        bins[side][k][0] += 1
        bins[side][k][1] += 1 if r["event_type"] == "goal" else 0
        types[side][r["shot_type"] or "unknown"] += 1
    n = len(my_games) or 1
    per_game = sorted(league_att[t] / len(g) for t, g in games_by_team.items() if g)
    return dict(season="2024-25", games=len(my_games), bins={s: [[k, v[0] / n, v[1]] for k, v in b.items()] for s, b in bins.items()}, types={s: t.most_common(8) for s, t in types.items()},
                attemptsPerGame=dict(team=league_att[tid] / n, league=per_game))


async def soccer_team_totals(c, cfg, season):
    rows = await c.fetch("SELECT team_id, event_id, stats FROM player_game_history WHERE sport='soccer_epl' AND season=$1", season)
    tot = defaultdict(lambda: defaultdict(float))
    games = defaultdict(set)
    for r in rows:
        st = r["stats"] if isinstance(r["stats"], dict) else json.loads(r["stats"])
        games[r["team_id"]].add(r["event_id"])
        for k in ("totalGoals", "totalShots", "shotsOnTarget", "goalAssists", "foulsCommitted", "foulsSuffered", "offsides", "yellowCards", "redCards", "saves", "goalsConceded"):
            tot[r["team_id"]][k] += st.get(k) or 0
    better = {"totalGoals": "high", "totalShots": "high", "shotsOnTarget": "high", "goalAssists": "high", "foulsCommitted": "low", "foulsSuffered": "high", "offsides": "low", "yellowCards": "low", "redCards": "low", "saves": "high", "goalsConceded": "low"}
    labels = {"totalGoals": "Goals / match", "totalShots": "Shots / match", "shotsOnTarget": "Shots on target / match", "goalAssists": "Assists / match", "foulsCommitted": "Fouls / match", "foulsSuffered": "Fouled / match", "offsides": "Offsides / match", "yellowCards": "Yellow cards / match", "redCards": "Red cards", "saves": "Saves / match", "goalsConceded": "Goals conceded (keepers) / match"}
    per = {t: {k: (v / len(games[t]) if k != "redCards" else v) for k, v in tt.items()} for t, tt in tot.items() if games[t]}
    out = []
    for k, b in better.items():
        mine = per.get(cfg["team"], {}).get(k)
        if mine is None:
            continue
        order = sorted((p[k] for p in per.values()), reverse=(b == "high"))
        out.append(dict(name=k, label=labels[k], better=b, value=mine, rank=order.index(mine) + 1, of=len(order), league=sorted(p[k] for p in per.values())))
    return dict(games=len(games.get(cfg["team"], [])), ranked=out)


async def build(slug, cfg, c):
    doc = dict(slug=slug, sport=cfg["sport"], label=cfg["label"], builtAt=datetime.now(timezone.utc).isoformat(), sources=[], status={})
    doc["team"] = team_info(cfg)
    doc["schedule"] = {str(cfg["cur"]): schedule(cfg, cfg["cur"]), str(cfg["prev"]): schedule(cfg, cfg["prev"])}
    doc["sources"].append(f"ESPN team + schedule ({cfg['cur']}, {cfg['prev']})")
    try:
        doc["standings"] = standings(cfg, cfg["cur"])
        doc["sources"].append("ESPN standings")
    except Exception as e:
        doc["status"]["standings"] = f"unavailable ({e})"
    if cfg["sport"] in RANKED:
        doc["ranked"] = {}
        for season in (cfg["cur"], cfg["prev"]):
            try:
                doc["ranked"][str(season)] = league_ranks(cfg, season)
            except Exception as e:
                doc["status"][f"ranks{season}"] = f"unavailable ({e})"
        doc["sources"].append("League ranks computed across every team's ESPN statistics (ESPN's own ranks exceed the team count and carry no direction)")
    if cfg["sport"] == "soccer":
        doc["soccerTotals"] = {str(s): await soccer_team_totals(c, cfg, s) for s in cfg["pgh"]}
        doc["sources"].append("player_game_history summed to team totals, ranked across the 20 clubs")
    # Players: season totals from the app's own game logs, names from each sport's people API.
    doc["players"] = {}
    all_ids = set()
    for s in cfg["pgh"]:
        p = await players(c, cfg, s)
        doc["players"][str(s)] = p
        all_ids |= set(p)
    top = sorted(all_ids, key=lambda a: -max(doc["players"][str(s)].get(a, {}).get("games", 0) for s in cfg["pgh"]))[:60]
    names = names_for(cfg, top)
    for s in cfg["pgh"]:
        doc["players"][str(s)] = [dict(id=a, **names.get(a, {"name": None}), **v) for a, v in doc["players"][str(s)].items() if a in names]
    doc["pghSeasons"] = list(cfg["pgh"])
    doc["sources"].append("player_game_history (player season totals for this team)")
    if cfg["sport"] == "mlb":
        doc["statcast"] = await mlb_statcast(c, cfg, cfg["cur"])
        doc["sources"].append(f"Statcast corpus {cfg['cur']}, joined to teams through player_game_history ({doc['statcast']['pitchesJoined']:,} of {doc['statcast']['pitchesTotal']:,} pitches matched)")
    if cfg["sport"] == "nfl":
        doc["targets"] = await nfl_targets(c, cfg, (cfg["prev"], cfg["cur"]))
        doc["sources"].append("nfl_target_events + nflverse players.csv")
        doc["status"]["epa"] = "dropped at ingest"
    if cfg["sport"] == "nba":
        doc["shots"] = await nba_shots(c, cfg)
        doc["sources"].append("nba_shot_events (2024-25 only; rim-origin corrected)")
    if cfg["sport"] == "nhl":
        doc["shots"] = await nhl_shots(c, cfg)
        doc["sources"].append("nhl_shot_events (2024-25 only)")
        doc["status"]["xg"] = "derivable from location and shot type; no model today"
    if cfg["sport"] == "soccer":
        doc["status"]["xg"] = "not held at team level (Understat cached per player only)"
    if cfg["sport"] == "cfb":
        doc["status"]["advanced"] = "not held (CFBD advanced team stats are not ingested)"
    path = os.path.join(OUT, f"team-{slug}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{slug}: {os.path.getsize(path) // 1024} KB · {', '.join(k for k in doc if k not in ('slug', 'sport', 'label', 'builtAt'))}", flush=True)


async def main():
    slugs = sys.argv[1:] or list(TEAMS)
    c = await asyncpg.connect(DATABASE_URL, statement_cache_size=0)
    try:
        for s in slugs:
            try:
                await build(s, TEAMS[s], c)
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"{s}: FAILED {e}", flush=True)
    finally:
        await c.close()


asyncio.run(main())
