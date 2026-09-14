"""Phase G2 mockup data — player page, every sport. Real data only.

Run from the repo root with the python-odds-service venv:
    python-odds-service/.venv/Scripts/python.exe docs/design/phase-g2/tools/build_player_data.py [subject ...]

Writes docs/design/phase-g2/data/player-<sport>-<slug>.json. Each file records its sources and, for
anything missing, its data status (held / derivable / dropped at ingest / not held).
Sources: player_game_history, prop_odds, game_result, nfl_target_events, nba_shot_events,
nhl_shot_events, golf_* tables, the Statcast Parquet corpus, the Understat cache in snapshot_cache,
the local app API (:3000), ESPN / MLB / NHL public APIs, nflverse players.csv, TennisMyLife CSVs.
"""
import asyncio
import csv
import glob
import io
import json
import os
import re
import statistics
import sys
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python-odds-service", "src"))
os.chdir(os.path.join(ROOT, "python-odds-service"))
from config import DATABASE_URL  # noqa: E402
import asyncpg  # noqa: E402

OUT = os.path.join(ROOT, "docs", "design", "phase-g2", "data")
APP = "http://localhost:3000"
UA = {"User-Agent": "Mozilla/5.0 (linesmith design mockup data builder)"}

SUBJECTS = {
    "mlb-witt": dict(sport="mlb", kind="hitter", id="677951", name="Bobby Witt Jr."),
    "mlb-skubal": dict(sport="mlb", kind="pitcher", id="669373", name="Tarik Skubal"),
    "nfl-lamb": dict(sport="nfl", kind="receiver", id="4241389", name="CeeDee Lamb"),
    "nfl-prescott": dict(sport="nfl", kind="quarterback", id="2577417", name="Dak Prescott"),
    "cfb-sayin": dict(sport="cfb", kind="quarterback", id="5079712", name="Julian Sayin"),
    "nba-doncic": dict(sport="nba", kind="guard", id="3945274", name="Luka Doncic"),
    "nba-jokic": dict(sport="nba", kind="big", id="3112335", name="Nikola Jokic"),
    "nhl-matthews": dict(sport="nhl", kind="skater", id="8479318", name="Auston Matthews"),
    "nhl-hellebuyck": dict(sport="nhl", kind="goalie", id="8476945", name="Connor Hellebuyck"),
    "soccer-haaland": dict(sport="soccer_epl", kind="forward", id="253989", name="Erling Haaland", understat="8260"),
    "soccer-donnarumma": dict(sport="soccer_epl", kind="goalkeeper", id="217092", name="Gianluigi Donnarumma"),
    "tennis-zverev": dict(sport="tennis_atp", kind="player", id="2375", name="Alexander Zverev"),
    "golf-scheffler": dict(sport="golf", kind="golfer", id="9478", name="Scottie Scheffler"),
}

# Market definitions per subject kind: (market key used by props, label, stat key or function of stats).
MARKETS = {
    "hitter": [("hits", "Hits", "bat_hits"), ("total-bases", "Total bases", "bat_totalBases"), ("home-runs", "Home runs", "bat_homeRuns"), ("rbis", "RBIs", "bat_rbi"), ("runs", "Runs", "bat_runs"), ("hits-runs-rbis", "H+R+RBI", lambda s: s.get("bat_hits", 0) + s.get("bat_runs", 0) + s.get("bat_rbi", 0)), ("batter-strikeouts", "Strikeouts", "bat_strikeOuts"), ("walks", "Walks", "bat_baseOnBalls")],
    "pitcher": [("pitcher-strikeouts", "Strikeouts", "pit_strikeOuts"), ("pitcher-outs", "Outs recorded", lambda s: round(_ip_outs(s.get("pit_inningsPitched")))), ("earned-runs", "Earned runs", "pit_earnedRuns"), ("hits-allowed", "Hits allowed", "pit_hits"), ("walks-allowed", "Walks allowed", "pit_baseOnBalls")],
    "receiver": [("receiving-yards", "Receiving yards", "receiving.receivingYards"), ("receptions", "Receptions", "receiving.receptions"), ("receiving-tds", "Receiving TDs", "receiving.receivingTouchdowns"), ("longest-reception", "Longest reception", "receiving.longReception"), ("targets", "Targets", "receiving.receivingTargets")],
    "quarterback": [("passing-yards", "Passing yards", "passing.passingYards"), ("passing-tds", "Passing TDs", "passing.passingTouchdowns"), ("completions", "Completions", "passing.completions"), ("passing-attempts", "Pass attempts", "passing.passingAttempts"), ("interceptions", "Interceptions", "passing.interceptions"), ("rushing-yards", "Rushing yards", "rushing.rushingYards")],
    "guard": [("points", "Points", "points"), ("assists", "Assists", "assists"), ("rebounds", "Rebounds", "rebounds"), ("threes", "3-pointers made", "threePointFieldGoalsMade"), ("pra", "Pts+Reb+Ast", lambda s: s.get("points", 0) + s.get("rebounds", 0) + s.get("assists", 0)), ("steals-blocks", "Steals+Blocks", lambda s: s.get("steals", 0) + s.get("blocks", 0))],
    "big": [("points", "Points", "points"), ("rebounds", "Rebounds", "rebounds"), ("assists", "Assists", "assists"), ("pra", "Pts+Reb+Ast", lambda s: s.get("points", 0) + s.get("rebounds", 0) + s.get("assists", 0)), ("blocks", "Blocks", "blocks"), ("threes", "3-pointers made", "threePointFieldGoalsMade")],
    "skater": [("shots-on-goal", "Shots on goal", "sog"), ("points", "Points", "points"), ("goals", "Goals", "goals"), ("assists", "Assists", "assists"), ("blocked-shots", "Blocked shots", "blockedShots"), ("hits", "Hits", "hits")],
    "goalie": [("saves", "Saves", "saves"), ("goals-against", "Goals against", "goalsAgainst"), ("shots-against", "Shots against", "shotsAgainst")],
    "forward": [("shots", "Shots", "totalShots"), ("shots-on-target", "Shots on target", "shotsOnTarget"), ("anytime-goalscorer", "Goals", "totalGoals"), ("assists", "Assists", "goalAssists")],
    "goalkeeper": [("saves", "Saves", "saves"), ("goals-conceded", "Goals conceded", "goalsConceded"), ("shots-faced", "Shots faced", "shotsFaced")],
    "player": [("games-won", "Games won", "games_won"), ("sets-won", "Sets won", "sets_won"), ("aces", "Aces", None)],
    "golfer": [],
}


# Pick'em apps post fixed payouts, not prices; they count toward which line is main but never as a price.
PICKEM = {"prizepicks", "underdog", "sleeper", "dabble", "parlayplay", "betr", "chalkboard"}


def _ip_outs(ip):
    if ip is None:
        return 0
    whole = int(ip)
    return whole * 3 + round((ip - whole) * 10)


def get_json(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def get_text(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def key(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def stat_value(stats, spec):
    if spec is None:
        return None
    if callable(spec):
        try:
            return spec(stats)
        except Exception:
            return None
    v = stats.get(spec)
    return None if v is None else float(v)


async def teams_map(sport):
    path = {"soccer_epl": "soccer/epl", "soccer_mls": "soccer/mls"}.get(sport, sport)
    try:
        j = get_json(f"{APP}/api/{path}/teams", timeout=150)
        return {str(t["teamId"]): {"abbr": t.get("abbreviation"), "name": t.get("name"), "logo": t.get("logoUrl")} for t in j.get("teams", [])}
    except Exception as e:
        print("  teams map failed", sport, e)
        return {}


async def game_results(c, sport, team_id, tmap):
    """Results for one team from game_result, de-duplicated across sources (same score and home/away within a day)."""
    if sport in ("tennis_atp", "golf"):
        return []
    names = await c.fetch("SELECT name_key FROM team_name_index WHERE sport=$1 AND team_id=$2", sport, str(team_id))
    keys = {n["name_key"] for n in names}
    if not keys:
        return []
    rows = await c.fetch("SELECT game_date, home_team_raw, away_team_raw, home_score, away_score, source FROM game_result WHERE sport=$1 AND game_date >= '2023-01-01' AND home_score IS NOT NULL ORDER BY game_date", sport)
    pref = {"nflverse": 0, "espn_core": 1, "live_capture": 2}
    out = []
    for r in sorted(rows, key=lambda r: (r["game_date"], pref.get(r["source"], 9))):
        home = key(r["home_team_raw"]) in keys
        away = key(r["away_team_raw"]) in keys
        if not (home or away):
            continue
        pf, pa = (r["home_score"], r["away_score"]) if home else (r["away_score"], r["home_score"])
        if any(abs((o["d"] - r["game_date"]).days) <= 1 and o["pf"] == pf and o["pa"] == pa and o["home"] == home for o in out):
            continue
        out.append({"d": r["game_date"], "home": home, "pf": pf, "pa": pa})
    return out


async def prop_lines(c, subject_ids):
    """Main line per market for the player's most recent game with props, pre-game quotes only.

    prop_odds holds alternate ladders (some providers file them under the main market key) and keeps capturing
    after the start, so "the latest row" is not the line. The main line is the one quoted on both sides by the
    most books; ties go to the price nearest even money.
    """
    games = await c.fetch("""SELECT p.game_id, max(p.fetched_at) t, min(g.event_start) start FROM prop_odds p
                              LEFT JOIN game_result g ON g.event_ref = p.game_id
                              WHERE p.subject_id = ANY($1::text[]) GROUP BY p.game_id ORDER BY t DESC LIMIT 6""", subject_ids)
    latest, rows = None, []
    for gm in games:
        rs = await c.fetch("""SELECT market_key, line, side, bookmaker, american_odds, fetched_at FROM prop_odds
                              WHERE subject_id = ANY($1::text[]) AND game_id = $2 AND ($3::timestamptz IS NULL OR fetched_at <= $3)
                              ORDER BY fetched_at""", subject_ids, gm["game_id"], gm["start"])
        # The most recent game with a real pre-game market (3+ sportsbooks, pick'em apps excluded).
        if len({r["bookmaker"] for r in rs if r["bookmaker"] not in PICKEM}) >= 3 or (not latest and rs):
            latest, rows = gm, rs
            if len({r["bookmaker"] for r in rs if r["bookmaker"] not in PICKEM}) >= 3:
                break
    if not latest:
        return {}
    last = {}
    for r in rows:
        last[(r["market_key"], r["bookmaker"], (r["side"] or "").lower(), r["line"])] = r
    by_market = defaultdict(list)
    for (mk, _book, _side, _ln), r in last.items():
        by_market[mk].append(r)
    implied = lambda p: 100 / (p + 100) if p > 0 else -p / (-p + 100)  # noqa: E731
    best = {}
    for mk, rs in by_market.items():
        lines = {r["line"] for r in rs if r["line"] is not None}
        if not lines:
            continue

        def score(ln):
            at = [r for r in rs if r["line"] == ln]
            overs = {r["bookmaker"] for r in at if (r["side"] or "").lower() == "over"}
            unders = {r["bookmaker"] for r in at if (r["side"] or "").lower() == "under"}
            imps = [implied(r["american_odds"]) for r in at if (r["side"] or "").lower() == "over" and r["american_odds"] and r["bookmaker"] not in PICKEM]
            return (len(overs & unders), -abs(statistics.mean(imps) - 0.5) if imps else -1, len(overs | unders))
        line = max(lines, key=score)
        if score(line)[0] == 0:
            # Nothing quoted on both sides: what was stored is an alternate ladder, not the market's line.
            best[mk] = {"altOnly": True, "capturedAt": max(r["fetched_at"] for r in rs).isoformat(), "gameId": latest["game_id"]}
            continue
        at = [r for r in rs if r["line"] == line]
        b = {"line": line, "over": None, "under": None, "books": {}, "capturedAt": max(r["fetched_at"] for r in at).isoformat(), "gameId": latest["game_id"], "gameStart": latest["start"].isoformat() if latest["start"] else None}
        for r in at:
            side = (r["side"] or "").lower()
            b["books"].setdefault(r["bookmaker"], {})[side] = r["american_odds"]
            cur = b.get(side)
            if side in ("over", "under") and r["american_odds"] is not None and r["bookmaker"] not in PICKEM and (cur is None or r["american_odds"] > cur["price"]):
                b[side] = {"price": r["american_odds"], "book": r["bookmaker"]}
        best[mk] = b
    return best


async def history(c, sport, athlete_id):
    rows = await c.fetch("SELECT season, event_id, game_date, team_id, opponent_id, is_home, stats FROM player_game_history WHERE sport=$1 AND athlete_id=$2 ORDER BY game_date", sport, athlete_id)
    out = []
    for r in rows:
        st = r["stats"] if isinstance(r["stats"], dict) else json.loads(r["stats"])
        out.append({"date": str(r["game_date"]), "season": r["season"], "event": r["event_id"], "team": r["team_id"], "opp": r["opponent_id"], "home": r["is_home"], "stats": st})
    return out


def attach_results(games, results):
    for g in games:
        d = date.fromisoformat(g["date"])
        m = next((x for x in results if abs((x["d"] - d).days) <= 1 and x["home"] == g["home"]), None)
        if m:
            g["pf"], g["pa"] = m["pf"], m["pa"]
            g["result"] = "W" if m["pf"] > m["pa"] else "L" if m["pf"] < m["pa"] else "D"


def espn_bio(sport_path, athlete_id):
    try:
        a = get_json(f"https://site.web.api.espn.com/apis/common/v3/sports/{sport_path}/athletes/{athlete_id}")["athlete"]
        return {"name": a.get("displayName"), "jersey": a.get("jersey"), "position": (a.get("position") or {}).get("displayName"), "posAbbr": (a.get("position") or {}).get("abbreviation"),
                "team": (a.get("team") or {}).get("displayName"), "teamAbbr": (a.get("team") or {}).get("abbreviation"), "teamLogo": ((a.get("team") or {}).get("logos") or [{}])[0].get("href"),
                "headshot": (a.get("headshot") or {}).get("href"), "age": a.get("age"), "height": a.get("displayHeight"), "weight": a.get("displayWeight"),
                "experience": a.get("displayExperience"), "college": (a.get("college") or {}).get("name"), "birthplace": a.get("displayBirthPlace"), "draft": a.get("displayDraft"), "hand": (a.get("hand") or {}).get("displayValue")}
    except Exception as e:
        print("  espn bio failed", athlete_id, e)
        return {}


def markets_block(kind, games, lines, candidates):
    blocks = []
    for mk, label, spec in MARKETS.get(kind, []):
        values = [{"date": g["date"], "season": g["season"], "opp": g.get("oppAbbr"), "home": g["home"], "v": stat_value(g["stats"], spec)} for g in games]
        values = [v for v in values if v["v"] is not None]
        line = lines.get(mk)
        alt_only = bool(line and line.get("altOnly"))
        if alt_only:
            line = None
        cand = next((x for x in candidates if x.get("dimension") == mk), None)
        blocks.append({"key": mk, "label": label, "line": (line or {}).get("line") if line else (cand or {}).get("line"),
                       "over": (line or {}).get("over"), "under": (line or {}).get("under"), "books": len((line or {}).get("books", {})),
                       "capturedAt": (line or {}).get("capturedAt"), "gameId": (line or {}).get("gameId"), "gameStart": (line or {}).get("gameStart"), "values": values,
                       "status": "priced" if line else ("alternate lines only (no two-sided market stored)" if alt_only else "line without price" if cand and cand.get("line") is not None else "no line posted")})
    return blocks


def corpus_table(columns):
    import pyarrow.dataset as ds
    files = sorted(glob.glob(os.path.join(ROOT, "python-odds-service", "corpus", "mlb_pitch_events", "*.parquet")))
    return ds.dataset(files, format="parquet").to_table(columns=columns).to_pylist()


def mlb_extras(kind, pid):
    rows = corpus_table(["season", "game_date", "batter_id", "pitcher_id", "p_throws", "stand", "pitch_type", "zone", "plate_x", "plate_z", "release_speed", "launch_speed", "launch_angle", "estimated_woba", "description", "events"])
    who = "batter_id" if kind == "hitter" else "pitcher_id"
    mine = [r for r in rows if r[who] == int(pid)]
    SW = {"swinging_strike", "swinging_strike_blocked", "foul", "foul_tip", "hit_into_play", "foul_bunt", "missed_bunt"}
    WH = {"swinging_strike", "swinging_strike_blocked", "missed_bunt"}
    HITS = {"single": 1, "double": 2, "triple": 3, "home_run": 4}
    NONAB = {"walk", "hit_by_pitch", "sac_fly", "sac_bunt", "catcher_interf", "intent_walk", "sac_fly_double_play"}
    ex = {"source": "corpus/mlb_pitch_events (Statcast), 2025-03 to 2026-09-11", "seasons": {}}
    for season in (2025, 2026):
        s_rows = [r for r in mine if r["season"] == season]
        if not s_rows:
            continue
        bip = [r for r in s_rows if r["description"] == "hit_into_play" and r["launch_speed"] is not None]
        by_type = defaultdict(lambda: {"n": 0, "sw": 0, "wh": 0, "bip": 0, "xw": [], "ev": [], "velo": [], "cs": 0})
        for r in s_rows:
            d = by_type[r["pitch_type"] or "?"]
            d["n"] += 1
            d["sw"] += r["description"] in SW
            d["wh"] += r["description"] in WH
            d["cs"] += r["description"] == "called_strike"
            if r["release_speed"]:
                d["velo"].append(r["release_speed"])
            if r["description"] == "hit_into_play":
                d["bip"] += 1
                if r["estimated_woba"] is not None:
                    d["xw"].append(r["estimated_woba"])
                if r["launch_speed"] is not None:
                    d["ev"].append(r["launch_speed"])
        total = len(s_rows)
        pitches = sorted([{"type": k, "n": v["n"], "usage": round(100 * v["n"] / total, 1), "velo": round(statistics.mean(v["velo"]), 1) if v["velo"] else None,
                           "whiff": round(100 * v["wh"] / v["sw"], 1) if v["sw"] else None, "csw": round(100 * (v["cs"] + v["wh"]) / v["n"], 1) if v["n"] else None,
                           "bip": v["bip"], "xwoba": round(statistics.mean(v["xw"]), 3) if v["xw"] else None, "ev": round(statistics.mean(v["ev"]), 1) if v["ev"] else None}
                          for k, v in by_type.items() if v["n"] >= 25], key=lambda x: -x["n"])
        zones = {}
        for z in range(1, 15):
            zr = [r for r in s_rows if r["zone"] == z]
            if not zr:
                continue
            xw = [r["estimated_woba"] for r in zr if r["description"] == "hit_into_play" and r["estimated_woba"] is not None]
            zones[z] = {"n": len(zr), "share": round(100 * len(zr) / total, 1), "swing": round(100 * sum(r["description"] in SW for r in zr) / len(zr), 1),
                        "whiff": round(100 * sum(r["description"] in WH for r in zr) / max(1, sum(r["description"] in SW for r in zr)), 1), "xwoba": round(statistics.mean(xw), 3) if xw else None}
        # Plate-appearance outcomes split by opposing hand.
        pa = [r for r in s_rows if r["events"]]
        hand_key = "p_throws" if kind == "hitter" else "stand"
        splits = {}
        for hand in ("L", "R"):
            hr = [r for r in pa if r[hand_key] == hand]
            ab = [r for r in hr if r["events"] not in NONAB]
            hits = [r for r in ab if r["events"] in HITS]
            k = sum(1 for r in hr if r["events"] in ("strikeout", "strikeout_double_play"))
            bb = sum(1 for r in hr if r["events"] in ("walk", "intent_walk"))
            xw = [r["estimated_woba"] for r in hr if r["estimated_woba"] is not None and r["description"] == "hit_into_play"]
            splits[hand] = {"pa": len(hr), "avg": round(len(hits) / len(ab), 3) if ab else None, "slg": round(sum(HITS[r["events"]] for r in hits) / len(ab), 3) if ab else None,
                            "kPct": round(100 * k / len(hr), 1) if hr else None, "bbPct": round(100 * bb / len(hr), 1) if hr else None, "hr": sum(1 for r in hr if r["events"] == "home_run"), "xwobacon": round(statistics.mean(xw), 3) if xw else None}
        bydate = defaultdict(list)
        for r in (bip if kind == "hitter" else [r for r in s_rows if r["release_speed"] and r["pitch_type"] in ("FF", "SI")]):
            bydate[str(r["game_date"])].append(r["launch_speed"] if kind == "hitter" else r["release_speed"])
        trend = [{"date": d, "avg": round(statistics.mean(v), 1), "max": round(max(v), 1), "n": len(v)} for d, v in sorted(bydate.items())]
        evs = [r["launch_speed"] for r in bip]
        season_out = {"pitches": total, "bip": len(bip), "pitchTypes": pitches, "zones": zones, "splitsByHand": splits, "trend": trend,
                      "evHist": [{"lo": lo, "n": sum(1 for v in evs if lo <= v < lo + 2)} for lo in range(40, 122, 2)] if evs else [],
                      "maxEV": round(max(evs), 1) if evs else None, "avgEV": round(statistics.mean(evs), 1) if evs else None,
                      "p90EV": round(sorted(evs)[int(0.9 * len(evs))], 1) if evs else None, "hardHit": round(100 * sum(1 for v in evs if v >= 95) / len(evs), 1) if evs else None,
                      "hrList": [{"date": str(r["game_date"]), "ev": r["launch_speed"], "la": r["launch_angle"], "pitch": r["pitch_type"], "velo": r["release_speed"]} for r in bip if r["events"] == "home_run"]}
        if kind == "pitcher":
            # A location sample of pitches by type for the arsenal map (plate_x, plate_z), capped.
            loc = [(r["pitch_type"], round(r["plate_x"], 2), round(r["plate_z"], 2)) for r in s_rows if r["plate_x"] is not None and r["plate_z"] is not None]
            season_out["locations"] = loc[-900:]
        ex["seasons"][season] = season_out
    # League percentiles for the hitter power profile (2026, 150+ balls in play).
    if kind == "hitter":
        agg = defaultdict(list)
        for r in rows:
            if r["season"] == 2026 and r["description"] == "hit_into_play" and r["launch_speed"] is not None:
                agg[r["batter_id"]].append(r["launch_speed"])
        pool = {b: v for b, v in agg.items() if len(v) >= 150}
        me = pool.get(int(pid), [])
        def pct(metric):
            vals = sorted(metric(v) for v in pool.values())
            mine_v = metric(me)
            return round(100 * sum(1 for x in vals if x <= mine_v) / len(vals))
        ex["percentiles2026"] = {"pool": len(pool), "maxEV": pct(max), "avgEV": pct(statistics.mean), "p90EV": pct(lambda v: sorted(v)[int(0.9 * len(v))]), "hardHit": pct(lambda v: sum(1 for x in v if x >= 95) / len(v))}
    return ex


async def nfl_extras(c, espn_id, kind):
    players = get_text("https://github.com/nflverse/nflverse-data/releases/download/players/players.csv", timeout=120)
    gsis = next((row["gsis_id"] for row in csv.DictReader(io.StringIO(players)) if row.get("espn_id") == espn_id), None)
    if not gsis:
        return {"status": "nflverse id not found"}
    col = "receiver_id" if kind == "receiver" else "passer_id"
    rows = await c.fetch(f"SELECT season, week, air_yards, pass_location, pass_length, yards_after_catch, complete_pass, touchdown, interception FROM nfl_target_events WHERE {col}=$1 ORDER BY season, week", gsis)
    t = [dict(r) for r in rows]
    return {"source": "nfl_target_events (nflverse play-by-play), 2024-2026", "gsis": gsis, "role": col,
            "targets": [[r["season"], r["week"], r["air_yards"], r["pass_location"], r["pass_length"], r["yards_after_catch"], bool(r["complete_pass"]), bool(r["touchdown"]), bool(r["interception"])] for r in t],
            "fields": ["season", "week", "airYards", "location", "length", "yac", "complete", "td", "int"]}


async def run_subject(c, slug, cfg):
    sport, kind, pid = cfg["sport"], cfg["kind"], cfg["id"]
    print(f"{slug}: {cfg['name']}")
    doc = {"slug": slug, "sport": sport, "kind": kind, "builtAt": datetime.now(timezone.utc).isoformat(), "sources": [], "status": {}}
    espn_path = {"nfl": "football/nfl", "cfb": "football/college-football", "nba": "basketball/nba", "soccer_epl": "soccer/eng.1", "tennis_atp": "tennis/atp", "golf": "golf/pga"}.get(sport)
    if sport == "mlb":
        p = get_json(f"https://statsapi.mlb.com/api/v1/people/{pid}?hydrate=currentTeam")["people"][0]
        tid = (p.get("currentTeam") or {}).get("id")
        doc["bio"] = {"name": p.get("fullName"), "jersey": p.get("primaryNumber"), "position": (p.get("primaryPosition") or {}).get("name"), "posAbbr": (p.get("primaryPosition") or {}).get("abbreviation"),
                      "team": (p.get("currentTeam") or {}).get("name"), "teamId": tid, "teamLogo": f"https://www.mlbstatic.com/team-logos/{tid}.svg" if tid else None,
                      "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/{pid}/headshot/67/current", "age": p.get("currentAge"),
                      "height": p.get("height"), "weight": f"{p.get('weight')} lbs" if p.get("weight") else None, "bats": (p.get("batSide") or {}).get("code"), "throws": (p.get("pitchHand") or {}).get("code"), "debut": p.get("mlbDebutDate")}
        doc["sources"].append("statsapi.mlb.com people")
    elif sport == "nhl":
        a = get_json(f"https://api-web.nhle.com/v1/player/{pid}/landing")
        doc["bio"] = {"name": f"{a['firstName']['default']} {a['lastName']['default']}", "jersey": a.get("sweaterNumber"), "position": a.get("position"), "posAbbr": a.get("position"), "team": a.get("fullTeamName", {}).get("default"),
                      "teamAbbr": a.get("currentTeamAbbrev"), "teamId": a.get("currentTeamId"), "teamLogo": a.get("teamLogo"), "headshot": a.get("headshot"), "birthDate": a.get("birthDate"),
                      "height": f"{a.get('heightInInches') // 12}' {a.get('heightInInches') % 12}\"" if a.get("heightInInches") else None, "weight": f"{a.get('weightInPounds')} lbs", "shoots": a.get("shootsCatches"),
                      "draft": a.get("draftDetails")}
        doc["nhlSeasons"] = [s for s in a.get("seasonTotals", []) if s.get("leagueAbbrev") == "NHL" and s.get("gameTypeId") == 2][-4:]
        doc["nhlCareer"] = (a.get("careerTotals") or {}).get("regularSeason")
        doc["sources"].append("api-web.nhle.com player landing (season and career totals the app does not parse)")
    else:
        doc["bio"] = espn_bio(espn_path, pid)
        doc["sources"].append("ESPN athlete API")

    tmap = await teams_map(sport) if sport not in ("tennis_atp", "golf") else {}
    games = await history(c, sport, pid) if sport != "golf" else []
    for g in games:
        o = tmap.get(str(g["opp"]), {})
        g["oppAbbr"], g["oppLogo"] = o.get("abbr"), o.get("logo")
    if games:
        doc["sources"].append(f"player_game_history ({len(games)} games, {games[0]['season']}-{games[-1]['season']})")
        if sport != "tennis_atp":
            # Join per the team the player was on for each game (trades mid-season change it).
            for team_id in sorted({g["team"] for g in games if g["team"]}):
                results = await game_results(c, sport, team_id, tmap)
                attach_results([g for g in games if g["team"] == team_id], results)
            doc["sources"].append("game_result (results joined per game's team, cross-source duplicates removed)")
    doc["games"] = games

    subject_ids = [pid, f"espn:football:{pid}", f"espn:basketball:{pid}", f"espn:soccer:{pid}", f"espn:tennis:{pid}", f"nhl:{pid}"]
    lines = await prop_lines(c, subject_ids)
    cands = []
    snap_path = {"soccer_epl": "soccer/epl", "tennis_atp": "tennis/atp"}.get(sport, sport)
    try:
        snap = get_json(f"{APP}/api/{snap_path}", timeout=200)
        cands = [x for x in snap.get("candidates", []) if str(x.get("subjectId", "")).split(":")[-1] == pid]
    except Exception as e:
        print("  snapshot failed", e)
    doc["markets"] = markets_block(kind, games, lines, cands)
    doc["sources"].append(f"prop_odds ({len(lines)} priced markets) + app snapshot candidates ({len(cands)})")

    if sport == "mlb":
        doc["statcast"] = mlb_extras(kind, pid)
        doc["sources"].append(doc["statcast"]["source"])
        doc["status"]["hitDistance"] = "dropped at ingest (hit_distance_sc)"
        doc["status"]["spinAndMovement"] = "dropped at ingest"
    if sport == "nfl":
        doc["targets"] = await nfl_extras(c, pid, kind)
        doc["sources"].append("nflverse players.csv (espn_id -> gsis_id)")
        doc["status"]["epa"] = "dropped at ingest (play-by-play)"
        doc["status"]["snaps"] = "not held"
    if sport == "nba":
        rows = await c.fetch("SELECT season, game_date, period, x_coord, y_coord, made, shot_type, point_value FROM nba_shot_events WHERE shooter_id=$1", int(pid))
        doc["shots"] = {"source": "nba_shot_events (2024-25 season)", "fields": ["x", "y", "made", "type", "pts"], "rows": [[r["x_coord"], r["y_coord"], bool(r["made"]), r["shot_type"], r["point_value"]] for r in rows]}
        doc["status"]["advanced"] = "derivable (usage, pace from box scores)"
    if sport == "nhl":
        col = "goalie_id" if kind == "goalie" else "shooter_id"
        rows = await c.fetch(f"SELECT game_date, period, x_coord, y_coord, event_type, shot_type, zone_code FROM nhl_shot_events WHERE {col}=$1", int(pid))
        doc["shots"] = {"source": f"nhl_shot_events (2024-25 season), by {col}", "fields": ["x", "y", "event", "type", "period"], "rows": [[r["x_coord"], r["y_coord"], r["event_type"], r["shot_type"], r["period"]] for r in rows if r["x_coord"] is not None]}
    if sport == "soccer_epl" and cfg.get("understat"):
        v = await c.fetchval("SELECT payload FROM snapshot_cache WHERE cache_key=$1", f"soccer:understat:player:v3:{cfg['understat']}")
        d = json.loads(v) if isinstance(v, str) else v
        if isinstance(d, str):
            d = json.loads(d)
        doc["understat"] = {"source": "Understat via snapshot_cache (fetched by the app per page; not stored as data)", "matches": d.get("matches", []),
                            "shots": [[round(float(s["X"]), 3), round(float(s["Y"]), 3), round(float(s["xG"]), 3), s["result"], s["situation"], s["shotType"], s["season"], s["minute"]] for s in d.get("shots", [])],
                            "shotFields": ["x", "y", "xG", "result", "situation", "shotType", "season", "minute"]}
        doc["sources"].append("Understat cache (203 matches, xG per shot)")
    if sport == "tennis_atp":
        matches = []
        for yr in (2024, 2025, 2026):
            try:
                text = get_text(f"https://stats.tennismylife.org/data/{yr}.csv", timeout=120)
            except Exception as e:
                print("  tennismylife", yr, e)
                continue
            for row in csv.DictReader(io.StringIO(text)):
                won = key(row.get("winner_name")) == key(cfg["name"])
                lost = key(row.get("loser_name")) == key(cfg["name"])
                if not (won or lost):
                    continue
                me, op = ("w_", "l_") if won else ("l_", "w_")
                num = lambda k: (float(row[k]) if row.get(k) not in (None, "") else None)
                matches.append({"date": row.get("tourney_date"), "tourney": row.get("tourney_name"), "surface": row.get("surface"), "level": row.get("tourney_level"), "round": row.get("round"), "won": won,
                                "opp": row.get("loser_name") if won else row.get("winner_name"), "oppRank": row.get(("loser" if won else "winner") + "_rank"), "rank": row.get(("winner" if won else "loser") + "_rank"),
                                "score": row.get("score"), "minutes": num("minutes"), "ace": num(me + "ace"), "df": num(me + "df"), "svpt": num(me + "svpt"), "firstIn": num(me + "1stIn"), "firstWon": num(me + "1stWon"),
                                "secondWon": num(me + "2ndWon"), "svGms": num(me + "SvGms"), "bpSaved": num(me + "bpSaved"), "bpFaced": num(me + "bpFaced"),
                                "oppSvpt": num(op + "svpt"), "oppFirstWon": num(op + "1stWon"), "oppSecondWon": num(op + "2ndWon"), "oppBpSaved": num(op + "bpSaved"), "oppBpFaced": num(op + "bpFaced"), "oppAce": num(op + "ace")})
        doc["matches"] = {"source": "TennisMyLife season CSVs (the app parses aces only; serve, return, break points, minutes and ranks are dropped)", "rows": matches}
        doc["sources"].append(f"TennisMyLife CSVs ({len(matches)} matches)")
    if sport == "golf":
        rounds = await c.fetch("SELECT event_id, round, total_strokes, relative_to_par, wind_mph, temp_f FROM golf_round_scores WHERE espn_id=$1 ORDER BY event_id, round", pid)
        holes = await c.fetch("SELECT event_id, round, hole, par, strokes, relative_to_par, category FROM golf_hole_scores WHERE espn_id=$1 ORDER BY event_id, round, hole", pid)
        shots = await c.fetch("SELECT tournament_id, round_number, hole_number, shot_number, distance_yds, left_yds, from_lie, to_lie, is_putt FROM golf_shot_events WHERE player_name=$1", cfg["name"])
        events = {}
        for eid in {r["event_id"] for r in rounds}:
            try:
                ev = get_json(f"https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?event={eid}")
                e0 = (ev.get("events") or [{}])[0]
                events[eid] = {"name": e0.get("name"), "date": e0.get("date")}
            except Exception:
                events[eid] = {"name": None}
        doc["golf"] = {"source": "golf_round_scores, golf_hole_scores (3 events), golf_shot_events (season)", "events": events,
                       "rounds": [dict(r) for r in rounds], "holes": [dict(h) for h in holes],
                       "shots": [[s["tournament_id"], s["round_number"], s["hole_number"], s["shot_number"], s["distance_yds"], s["left_yds"], s["from_lie"], s["to_lie"], bool(s["is_putt"])] for s in shots],
                       "shotFields": ["tournament", "round", "hole", "shot", "distanceYds", "leftYds", "fromLie", "toLie", "isPutt"]}
        doc["sources"].append(f"golf tables ({len(rounds)} rounds, {len(holes)} holes, {len(shots)} shots)")

    with open(os.path.join(OUT, f"player-{slug}.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, default=str, separators=(",", ":"))
    size = os.path.getsize(os.path.join(OUT, f"player-{slug}.json"))
    priced = [m["key"] for m in doc["markets"] if m["status"] == "priced"]
    print(f"  games {len(games)} · markets {len(doc['markets'])} (priced: {priced}) · results {sum(1 for g in games if g.get('result'))} · {size // 1024} KB")


async def main():
    os.makedirs(OUT, exist_ok=True)
    wanted = sys.argv[1:] or list(SUBJECTS)
    c = await asyncpg.connect(DATABASE_URL, statement_cache_size=0, timeout=30)
    try:
        for slug in wanted:
            try:
                await run_subject(c, slug, SUBJECTS[slug])
            except Exception as e:
                import traceback
                print(f"  FAILED {slug}: {e}")
                traceback.print_exc(limit=3)
    finally:
        await c.close()


asyncio.run(main())
