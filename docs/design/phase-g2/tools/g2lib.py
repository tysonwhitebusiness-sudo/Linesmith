"""Shared helpers for the Phase G2 data builders: team directories, results, team rollups, market stats.

Everything reads what the app stores (player_game_history, game_result, team_name_index) or calls
(ESPN, MLB Stats API, NHL API, nflverse). No local app server needed.
"""
import csv
import io
import json
import re
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "Mozilla/5.0"}
SITE = "https://site.api.espn.com/apis/site/v2/sports"
ESPN_PATH = {"nfl": "football/nfl", "cfb": "football/college-football", "nba": "basketball/nba", "soccer_epl": "soccer/eng.1", "nhl": "hockey/nhl", "mlb": "baseball/mlb"}


def get_json(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)


def get_text(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def key(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def pmap(fn, items, workers=8):
    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(fn, items))


def teams_map(sport):
    """team id (as stored in player_game_history) -> {abbr, name, logo}."""
    if sport == "mlb":
        d = get_json("https://statsapi.mlb.com/api/v1/teams?sportId=1")
        return {str(t["id"]): {"abbr": t["abbreviation"], "name": t["name"], "logo": f"https://www.mlbstatic.com/team-logos/{t['id']}.svg"} for t in d["teams"]}
    if sport == "nhl":
        d = get_json("https://api.nhle.com/stats/rest/en/team")
        return {str(t["id"]): {"abbr": t["triCode"], "name": t["fullName"], "logo": f"https://assets.nhle.com/logos/nhl/svg/{t['triCode']}_light.svg"} for t in d["data"]}
    if sport in ("tennis_atp", "golf"):
        return {}
    q = "?groups=80&limit=400" if sport == "cfb" else "?limit=100"
    d = get_json(f"{SITE}/{ESPN_PATH[sport]}/teams{q}")
    out = {}
    for t in d["sports"][0]["leagues"][0]["teams"]:
        t = t["team"]
        out[str(t["id"])] = {"abbr": t.get("abbreviation"), "name": t.get("displayName"), "logo": ((t.get("logos") or [{}])[0]).get("href")}
    return out


async def all_results(c, sport, since="2023-01-01"):
    """Every team's results from game_result, keyed by team id via team_name_index, cross-source duplicates removed."""
    idx = defaultdict(set)
    for r in await c.fetch("SELECT name_key, team_id FROM team_name_index WHERE sport=$1", sport):
        idx[r["name_key"]].add(str(r["team_id"]))
    rows = await c.fetch("SELECT game_date, home_team_raw, away_team_raw, home_score, away_score, source FROM game_result WHERE sport=$1 AND game_date >= $2 AND home_score IS NOT NULL ORDER BY game_date", sport, __import__("datetime").date.fromisoformat(since))
    pref = {"nflverse": 0, "espn_core": 1, "live_capture": 2}
    out = defaultdict(list)
    for r in sorted(rows, key=lambda r: (r["game_date"], pref.get(r["source"], 9))):
        hs, as_ = idx.get(key(r["home_team_raw"]), set()), idx.get(key(r["away_team_raw"]), set())
        if len(hs) != 1 or len(as_) != 1:
            continue
        h, a = next(iter(hs)), next(iter(as_))
        for tid, opp, home, pf, pa in ((h, a, True, r["home_score"], r["away_score"]), (a, h, False, r["away_score"], r["home_score"])):
            if any(abs((o[0] - r["game_date"]).days) <= 1 and o[1] == opp and o[3] == pf and o[4] == pa for o in out[tid]):
                continue
            out[tid].append((r["game_date"], opp, home, pf, pa))
    return out


# Stats rolled up per team (sum of the team's players' game lines). "allowed" rolls the same rows up by opponent.
ROLL_KEYS = {
    "nfl": ["passing.passingYards", "passing.passingAttempts", "passing.completions", "passing.passingTouchdowns", "passing.interceptions", "passing.sacks", "rushing.rushingYards", "rushing.rushingAttempts", "rushing.rushingTouchdowns",
            "receiving.receptions", "receiving.receivingYards", "receiving.receivingTargets", "receiving.receivingTouchdowns", "defensive.sacks", "defensive.tacklesForLoss", "interceptions.interceptions", "fumbles.fumblesLost"],
    "mlb": ["bat_runs", "bat_hits", "bat_homeRuns", "bat_strikeOuts", "bat_baseOnBalls", "bat_plateAppearances", "bat_atBats", "bat_totalBases", "bat_stolenBases", "bat_doubles", "pit_strikeOuts", "pit_earnedRuns", "pit_hits", "pit_baseOnBalls", "pit_homeRuns", "pit_outs"],
    "nba": ["points", "rebounds", "assists", "steals", "blocks", "turnovers", "fieldGoalsMade", "fieldGoalsAttempted", "threePointFieldGoalsMade", "threePointFieldGoalsAttempted", "freeThrowsMade", "freeThrowsAttempted", "offensiveRebounds"],
    "nhl": ["goals", "assists", "sog", "hits", "blockedShots", "powerPlayGoals", "pim", "saves", "shotsAgainst", "goalsAgainst", "takeaways", "giveaways"],
    "soccer_epl": ["totalGoals", "totalShots", "shotsOnTarget", "goalAssists", "foulsCommitted", "foulsSuffered", "offsides", "yellowCards", "redCards", "saves"],
    "cfb": ["passing.passingYards", "passing.passingAttempts", "passing.completions", "passing.passingTouchdowns", "passing.interceptions", "rushing.rushingYards", "rushing.rushingAttempts", "rushing.rushingTouchdowns", "receiving.receptions", "receiving.receivingYards", "defensive.sacks", "interceptions.interceptions"],
}


async def rollups(c, sport, season, before=None, pos_of=None):
    """Per-team totals for and allowed (and allowed to each position group when pos_of is given), with game counts."""
    q = "SELECT athlete_id, team_id, opponent_id, event_id, game_date, stats FROM player_game_history WHERE sport=$1 AND season=$2"
    args = [sport, season]
    if before is not None:
        q += " AND game_date < $3"
        args.append(before)
    rows = await c.fetch(q, *args)
    keys = ROLL_KEYS[sport]
    fr, al = defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(float))
    by_pos = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    games_f, games_a = defaultdict(set), defaultdict(set)
    players = defaultdict(lambda: {"g": 0, "s": defaultdict(float), "team": None})
    for r in rows:
        st = r["stats"] if isinstance(r["stats"], dict) else json.loads(r["stats"])
        t, o = str(r["team_id"]), str(r["opponent_id"])
        games_f[t].add(r["event_id"])
        games_a[o].add(r["event_id"])
        ip = st.get("pit_inningsPitched")
        if isinstance(ip, (int, float)):
            st = {**st, "pit_outs": int(ip) * 3 + round((ip - int(ip)) * 10)}
        p = players[str(r["athlete_id"])]
        p["g"] += 1
        p["team"] = t
        pg = pos_of(str(r["athlete_id"]), st) if pos_of else None
        for k in keys:
            v = st.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                fr[t][k] += v
                al[o][k] += v
                p["s"][k] += v
                if pg:
                    by_pos[pg][o][k] += v
    pack = lambda d, g: {t: {"g": len(g[t]), "s": {k: round(v, 2) for k, v in s.items()}} for t, s in d.items() if g[t]}  # noqa: E731
    out = {"for": pack(fr, games_f), "allowed": pack(al, games_a)}
    if pos_of:
        out["allowedPos"] = {pg: pack(d, games_a) for pg, d in by_pos.items()}
    out["_players"] = players
    return out


# Prop market -> stat key in player_game_history, per sport (function or key).
MARKET_STAT = {
    "nfl": {"passing-yards": "passing.passingYards", "passing-tds": "passing.passingTouchdowns", "completions": "passing.completions", "passing-attempts": "passing.passingAttempts", "pass-attempts": "passing.passingAttempts",
            "interceptions": "passing.interceptions", "rushing-yards": "rushing.rushingYards", "rushing-attempts": "rushing.rushingAttempts", "receiving-yards": "receiving.receivingYards", "receptions": "receiving.receptions",
            "longest-reception": "receiving.longReception", "tackles": "defensive.totalTackles", "sacks": "defensive.sacks",
            "assists": lambda s: (s.get("defensive.totalTackles") or 0) - (s.get("defensive.soloTackles") or 0),
            "anytime-td": lambda s: 1 if (s.get("rushing.rushingTouchdowns") or 0) + (s.get("receiving.receivingTouchdowns") or 0) > 0 else 0,
            "rush-rec-yards": lambda s: (s.get("rushing.rushingYards") or 0) + (s.get("receiving.receivingYards") or 0)},
    "mlb": {"hits": "bat_hits", "total-bases": "bat_totalBases", "home-runs": "bat_homeRuns", "rbis": "bat_rbi", "runs": "bat_runs", "walks": "bat_baseOnBalls", "batter-strikeouts": "bat_strikeOuts", "doubles": "bat_doubles",
            "triples": "bat_triples", "stolen-bases": "bat_stolenBases", "singles": lambda s: (s.get("bat_hits") or 0) - (s.get("bat_doubles") or 0) - (s.get("bat_triples") or 0) - (s.get("bat_homeRuns") or 0),
            "hits-runs-rbis": lambda s: (s.get("bat_hits") or 0) + (s.get("bat_runs") or 0) + (s.get("bat_rbi") or 0), "pitcher-strikeouts": "pit_strikeOuts", "earned-runs": "pit_earnedRuns", "pitcher-hits-allowed": "pit_hits",
            "pitcher-outs": lambda s: int(s.get("pit_inningsPitched") or 0) * 3 + round(((s.get("pit_inningsPitched") or 0) - int(s.get("pit_inningsPitched") or 0)) * 10) if s.get("pit_inningsPitched") is not None else None},
    "soccer_epl": {"shots": "totalShots", "shots-on-target": "shotsOnTarget", "goals": "totalGoals", "anytime-goalscorer": "totalGoals", "assists": "goalAssists", "saves": "saves", "fouls-committed": "foulsCommitted", "tackles": None},
}
MARKET_STAT["cfb"] = MARKET_STAT["nfl"]


def market_value(sport, market, stats):
    spec = MARKET_STAT.get(sport, {}).get(market)
    if spec is None:
        return None
    if callable(spec):
        try:
            return spec(stats)
        except Exception:
            return None
    v = stats.get(spec)
    return None if v is None else float(v)


def nflverse_players():
    text = get_text("https://github.com/nflverse/nflverse-data/releases/download/players/players.csv")
    return list(csv.DictReader(io.StringIO(text)))
