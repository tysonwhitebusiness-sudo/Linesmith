"""Pre-game research snapshot for a game page, as of kickoff. Everything is cut at the start time.

Used by build_game_data.py. Reads player_game_history (strength, ranks, player history), game_result (form,
head-to-head), the ESPN summary injuries already kept on the doc, and for MLB the Statcast corpus (starters'
arsenal, lineup vs pitcher). A team with too few games before kickoff also gets last season, labelled.
"""
import glob
import os
from collections import defaultdict
from datetime import date, datetime

import g2lib as L

DB_SPORT = {"nfl": "nfl", "cfb": "cfb", "nba": "nba", "nhl": "nhl", "mlb": "mlb", "soccer": "soccer_epl"}
MIN_GAMES = {"nfl": 4, "cfb": 4, "nba": 15, "nhl": 15, "mlb": 20, "soccer_epl": 6}

# (key, label, better-for-this-team, numerator, denominator or None=per game). Allowed reads the same stat as given up.
STRENGTH = {
    "nfl": [("pts", "Pass yards", "high", "passing.passingYards", None), ("rush", "Rush yards", "high", "rushing.rushingYards", None), ("ypa", "Yards per pass attempt", "high", "passing.passingYards", "passing.passingAttempts"),
            ("ypc", "Yards per carry", "high", "rushing.rushingYards", "rushing.rushingAttempts"), ("cmp", "Completion %", "high", "passing.completions", "passing.passingAttempts"), ("td", "Pass TDs", "high", "passing.passingTouchdowns", None),
            ("int", "Interceptions thrown", "low", "passing.interceptions", None), ("sk", "Sacks taken", "low", "passing.sacks", None)],
    "mlb": [("r", "Runs", "high", "bat_runs", None), ("hr", "Home runs", "high", "bat_homeRuns", None), ("avg", "AVG", "high", "bat_hits", "bat_atBats"), ("slg", "SLG", "high", "bat_totalBases", "bat_atBats"),
            ("k", "Strikeout %", "low", "bat_strikeOuts", "bat_plateAppearances"), ("bb", "Walk %", "high", "bat_baseOnBalls", "bat_plateAppearances"), ("sb", "Stolen bases", "high", "bat_stolenBases", None)],
    "nba": [("pts", "Points", "high", "points", None), ("fg", "FG%", "high", "fieldGoalsMade", "fieldGoalsAttempted"), ("tpm", "3-pointers made", "high", "threePointFieldGoalsMade", None), ("tp", "3P%", "high", "threePointFieldGoalsMade", "threePointFieldGoalsAttempted"),
            ("fta", "Free throw attempts", "high", "freeThrowsAttempted", None), ("oreb", "Offensive rebounds", "high", "offensiveRebounds", None), ("ast", "Assists", "high", "assists", None), ("tov", "Turnovers", "low", "turnovers", None)],
    "nhl": [("g", "Goals", "high", "goals", None), ("sog", "Shots on goal", "high", "sog", None), ("ppg", "Power-play goals", "high", "powerPlayGoals", None), ("sh", "Shooting %", "high", "goals", "sog"), ("hits", "Hits", "high", "hits", None), ("blk", "Blocked shots", "high", "blockedShots", None), ("pim", "Penalty minutes", "low", "pim", None)],
    "soccer_epl": [("g", "Goals", "high", "totalGoals", None), ("sh", "Shots", "high", "totalShots", None), ("sot", "Shots on target", "high", "shotsOnTarget", None), ("conv", "Goals per shot %", "high", "totalGoals", "totalShots"), ("fc", "Fouls", "low", "foulsCommitted", None), ("yc", "Yellow cards", "low", "yellowCards", None), ("off", "Offsides", "low", "offsides", None)],
}
STRENGTH["cfb"] = STRENGTH["nfl"]
WATCH = {"nba": [("points", "PTS"), ("rebounds", "REB"), ("assists", "AST"), ("threePointFieldGoalsMade", "3PM")], "nhl": [("goals", "G"), ("assists", "A"), ("points", "P"), ("sog", "SOG")], "soccer_epl": [("totalGoals", "G"), ("totalShots", "SH"), ("shotsOnTarget", "SOT"), ("goalAssists", "A")]}


def season_of(sport, d):
    if sport in ("nfl", "cfb", "mlb"):
        return d.year if d.month >= 3 else d.year - 1
    if sport == "nba":
        return d.year + 1 if d.month >= 9 else d.year
    return d.year if d.month >= 7 else d.year - 1  # nhl, soccer_epl (start year)


def value(tot, g, num, den, pct):
    if den:
        return round((100 if pct else 1) * tot.get(num, 0) / tot[den], 3) if tot.get(den) else None
    return round(tot.get(num, 0) / g, 3) if g else None


def strength_block(sport, roll, a, b):
    out = []
    most = max((v["g"] for v in roll["for"].values()), default=0)
    real = {t for t, v in roll["for"].items() if v["g"] >= max(1, most * 0.3)}
    for key, label, better, num, den in STRENGTH[sport]:
        pct = label.endswith("%")
        row = {"key": key, "label": label, "better": better, "teams": {}}
        league = {}
        for side in ("for", "allowed"):
            vals = {t: value(v["s"], v["g"], num, den, pct) for t, v in roll[side].items() if v["g"] >= 1 and t in real}
            vals = {t: v for t, v in vals.items() if v is not None}
            league[side] = sorted(vals.values())
            # For the team's own production, better = as declared; for what it allows, the opposite.
            rev = (better == "high") if side == "for" else (better == "low")
            order = sorted(vals.values(), reverse=rev)
            for t in (a, b):
                if t in vals:
                    row["teams"].setdefault(t, {})[side] = [vals[t], order.index(vals[t]) + 1, len(order)]
        row["league"] = league
        out.append(row)
    return out


async def pregame(c, cfg, doc):
    sport = DB_SPORT[cfg["sport"]]
    start = datetime.fromisoformat(doc["header"]["date"].replace("Z", "+00:00"))
    day = start.date()
    if cfg["sport"] == "nhl":
        a_id, b_id = str(doc["nhl"]["awayId"]), str(doc["nhl"]["homeId"])
    else:
        a_id, b_id = str(doc["header"]["teams"][0]["id"]), str(doc["header"]["teams"][1]["id"])
    cur = season_of(sport, day)
    out = {"asOf": doc["header"]["date"], "season": cur, "teamIds": [a_id, b_id], "notes": []}

    # Form and head-to-head from game_result, strictly before kickoff.
    results = await L.all_results(c, sport, since=f"{cur - 2}-01-01")
    season_start = await c.fetchval("SELECT min(game_date) FROM player_game_history WHERE sport=$1 AND season=$2", sport, cur)
    form = {}
    for t in (a_id, b_id):
        rs = [r for r in results.get(t, []) if r[0] < day]
        this = [r for r in rs if season_start and r[0] >= season_start]
        form[t] = {"last10": [[str(d), o, h, pf, pa] for d, o, h, pf, pa in rs[-10:]],
                   "record": [sum(1 for r in this if r[3] > r[4]), sum(1 for r in this if r[3] < r[4]), sum(1 for r in this if r[3] == r[4])],
                   "home": [sum(1 for r in this if r[2] and r[3] > r[4]), sum(1 for r in this if r[2] and r[3] < r[4])], "away": [sum(1 for r in this if not r[2] and r[3] > r[4]), sum(1 for r in this if not r[2] and r[3] < r[4])],
                   "pf": round(sum(r[3] for r in this) / len(this), 2) if this else None, "pa": round(sum(r[4] for r in this) / len(this), 2) if this else None, "games": len(this)}
    out["form"] = form
    out["h2h"] = [[str(d), o, h, pf, pa] for d, o, h, pf, pa in results.get(a_id, []) if o == b_id and d < day]

    # Team strength as of kickoff, current season; last season too when either team is early.
    out["strength"] = {}
    roll_cur = await L.rollups(c, sport, cur, before=day)
    roll_cur.pop("_players", None)
    games_cur = {t: roll_cur["for"].get(t, {}).get("g", 0) for t in (a_id, b_id)}
    out["strength"][str(cur)] = strength_block(sport, roll_cur, a_id, b_id)
    out["gamesBefore"] = games_cur
    if min(games_cur.values()) < MIN_GAMES[sport]:
        roll_prev = await L.rollups(c, sport, cur - 1)
        prev_players = roll_prev.pop("_players", None)
        out["strength"][str(cur - 1)] = strength_block(sport, roll_prev, a_id, b_id)
        out["notes"].append(f"Fewer than {MIN_GAMES[sport]} games before kickoff for at least one team, so last season is shown beside this one.")

    # Player props: each player's history in that market before kickoff, and against this opponent.
    props = doc.get("props") or []
    if props and sport in L.MARKET_STAT:
        ids = list({str(p["id"]).split(":")[-1] for p in props})
        rows = await c.fetch("SELECT athlete_id, team_id, opponent_id, game_date, stats FROM player_game_history WHERE sport=$1 AND athlete_id = ANY($2::text[]) AND game_date < $3 ORDER BY game_date", sport, ids, day)
        by_player = defaultdict(list)
        for r in rows:
            st = r["stats"] if isinstance(r["stats"], dict) else __import__("json").loads(r["stats"])
            by_player[str(r["athlete_id"])].append((r["game_date"], str(r["team_id"]), str(r["opponent_id"]), st))
        hist = {}
        for p in props:
            pid = str(p["id"]).split(":")[-1]
            gs = by_player.get(pid, [])
            if not gs:
                continue
            team = gs[-1][1]
            opp = b_id if team == a_id else a_id if team == b_id else None
            vals = [(str(d), L.market_value(sport, p["market"], st), o) for d, t, o, st in gs]
            vals = [v for v in vals if v[1] is not None]
            hist[f"{pid}|{p['market']}"] = {"team": team, "last": vals[-15:], "vsOpp": [v for v in vals if v[2] == opp][-10:], "season": [v[1] for d, t, o, st in [g for g in gs if season_of(sport, g[0]) == cur] for v in [(None, L.market_value(sport, p["market"], st))] if v[1] is not None]}
        out["propHistory"] = hist

    # Players to watch where there are no props (NBA, NHL) or alongside them (soccer): season averages and vs opponent.
    if sport in WATCH:
        import json as _json
        rows = await c.fetch("SELECT athlete_id, team_id, opponent_id, game_date, stats FROM player_game_history WHERE sport=$1 AND team_id = ANY($2::text[]) AND game_date < $3 AND game_date >= $4 ORDER BY game_date", sport, [a_id, b_id], day, date(day.year - 3, 1, 1))
        agg = defaultdict(lambda: {"g": 0, "s": defaultdict(float), "vg": 0, "vs": defaultdict(float), "team": None, "last5": []})
        for r in rows:
            st = r["stats"] if isinstance(r["stats"], dict) else _json.loads(r["stats"])
            if season_of(sport, r["game_date"]) != cur and str(r["opponent_id"]) not in (a_id, b_id):
                continue
            p = agg[(str(r["athlete_id"]), str(r["team_id"]))]
            p["team"] = str(r["team_id"])
            opp = b_id if p["team"] == a_id else a_id
            if season_of(sport, r["game_date"]) == cur:
                p["g"] += 1
                for k, _ in WATCH[sport]:
                    p["s"][k] += st.get(k) or 0
                p["last5"] = (p["last5"] + [[str(r["game_date"]), {k: st.get(k) or 0 for k, _ in WATCH[sport]}]])[-5:]
            if str(r["opponent_id"]) == opp:
                p["vg"] += 1
                for k, _ in WATCH[sport]:
                    p["vs"][k] += st.get(k) or 0
        lead = WATCH[sport][0][0] if sport != "nhl" else "points"
        watch = {}
        early = any(sum(1 for (aid, tid), p in agg.items() if tid == t and p["g"] >= 5) < 4 for t in (a_id, b_id))
        if early:
            # Too few games this season: rebuild the averages from last season (labelled).
            agg = defaultdict(lambda: {"g": 0, "s": defaultdict(float), "vg": 0, "vs": defaultdict(float), "team": None, "last5": []})
            for r in rows:
                st = r["stats"] if isinstance(r["stats"], dict) else _json.loads(r["stats"])
                ssn = season_of(sport, r["game_date"])
                if ssn not in (cur, cur - 1):
                    continue
                p = agg[(str(r["athlete_id"]), str(r["team_id"]))]
                p["team"] = str(r["team_id"])
                if ssn == cur - 1:
                    p["g"] += 1
                    for k, _ in WATCH[sport]:
                        p["s"][k] += st.get(k) or 0
                p["last5"] = (p["last5"] + [[str(r["game_date"]), {k: st.get(k) or 0 for k, _ in WATCH[sport]}]])[-5:]
                if str(r["opponent_id"]) == (b_id if p["team"] == a_id else a_id):
                    p["vg"] += 1
                    for k, _ in WATCH[sport]:
                        p["vs"][k] += st.get(k) or 0
        for t in (a_id, b_id):
            ps = [(aid, p) for (aid, tid), p in agg.items() if tid == t and p["g"] >= 5]
            ps.sort(key=lambda x: -(x[1]["s"][lead] / x[1]["g"]))
            watch[t] = [{"id": aid, "g": p["g"], "avg": {k: round(p["s"][k] / p["g"], 2) for k, _ in WATCH[sport]}, "vsG": p["vg"], "vsAvg": {k: round(p["vs"][k] / p["vg"], 2) for k, _ in WATCH[sport]} if p["vg"] else None, "last5": p["last5"]} for aid, p in ps[:6]]
        names = {}
        want = [w["id"] for ws in watch.values() for w in ws]
        if sport == "nhl":
            roster = doc["nhl"]["roster"]
            names = {aid: {"name": roster.get(aid, {}).get("name"), "pos": roster.get(aid, {}).get("pos"), "headshot": roster.get(aid, {}).get("headshot")} for aid in want}
            missing = [a for a in want if not names[a]["name"]]
            for a, m in L.pmap(lambda a: (a, _nhl_name(a)), missing):
                if m:
                    names[a] = m
        else:
            box_names = {at["id"]: {"name": at["name"], "pos": at.get("pos"), "headshot": at.get("headshot")} for tb in doc.get("box", []) for g in tb["groups"] for at in g["athletes"]}
            for r in doc.get("rosters", []):
                for pl in r["players"]:
                    box_names.setdefault(pl["id"], {"name": pl["name"], "pos": pl.get("pos"), "headshot": None})
            names = {a: box_names.get(a) for a in want}
            league = {"nba": "basketball/nba", "soccer_epl": "soccer/eng.1"}[sport]
            for a in [a for a in want if not names.get(a)]:
                try:
                    at = L.get_json(f"https://site.web.api.espn.com/apis/common/v3/sports/{league}/athletes/{a}")["athlete"]
                    names[a] = {"name": at.get("displayName"), "pos": (at.get("position") or {}).get("abbreviation"), "headshot": (at.get("headshot") or {}).get("href")}
                except Exception:
                    pass
        for t, ws in watch.items():
            for w in ws:
                w.update(names.get(w["id"]) or {"name": None})
            watch[t] = [w for w in ws if w.get("name")]
        out["watch"] = {"keys": WATCH[sport], "teams": watch, "season": cur - 1 if early else cur}

    if sport == "nhl":
        out["goalies"] = await nhl_goalies(c, doc, day)
    if sport == "mlb":
        out["starters"] = await mlb_starters(c, doc, day, cur)
    return out


def _nhl_name(aid):
    try:
        p = L.get_json(f"https://api-web.nhle.com/v1/player/{aid}/landing")
        return {"name": f"{p['firstName']['default']} {p['lastName']['default']}", "pos": p.get("position"), "headshot": p.get("headshot")}
    except Exception:
        return None


async def nhl_goalies(c, doc, day):
    out = {}
    for side, key in (("away", "awayTeam"), ("home", "homeTeam")):
        gs = [g for g in doc["nhl"]["box"][key].get("goalies", []) if g.get("starter")]
        if not gs:
            continue
        g = gs[0]
        rows = await c.fetch("SELECT game_date, opponent_id, stats FROM player_game_history WHERE sport='nhl' AND athlete_id=$1 AND game_date < $2 ORDER BY game_date DESC LIMIT 10", str(g["playerId"]), day)
        import json as _json
        starts = []
        for r in rows:
            st = r["stats"] if isinstance(r["stats"], dict) else _json.loads(r["stats"])
            if st.get("shotsAgainst"):
                starts.append([str(r["game_date"]), str(r["opponent_id"]), st.get("saves"), st.get("shotsAgainst"), st.get("goalsAgainst"), st.get("toiMinutes")])
        roster = doc["nhl"]["roster"].get(str(g["playerId"]), {})
        out[side] = {"id": str(g["playerId"]), "name": g["name"]["default"], "fullName": roster.get("name"), "headshot": roster.get("headshot"), "recent": starts}
    return out


async def mlb_starters(c, doc, day, season):
    import json as _json
    import pyarrow.dataset as ds
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
    files = sorted(glob.glob(os.path.join(root, "python-odds-service", "corpus", "mlb_pitch_events", "*.parquet")))
    box = doc["mlbBox"]
    starters = {side: box[i]["pitching"][0] for i, side in enumerate(("away", "home"))}
    lineups = {side: [b for b in box[i]["batting"] if b.get("order") and int(b["order"]) % 100 == 0] for i, side in enumerate(("away", "home"))}
    p_ids = {starters[s]["id"] for s in starters}
    b_ids = {b["id"] for s in lineups for b in lineups[s]}
    table = ds.dataset(files, format="parquet").to_table(columns=["game_date", "season", "pitcher_id", "batter_id", "p_throws", "stand", "pitch_type", "release_speed", "description", "events", "estimated_woba", "launch_speed"]).to_pylist()
    before = [r for r in table if r["game_date"] < day and (r["pitcher_id"] in p_ids or r["batter_id"] in b_ids)]
    WH = {"swinging_strike", "swinging_strike_blocked", "missed_bunt"}
    SW = WH | {"foul", "foul_tip", "hit_into_play", "foul_bunt"}
    HITS = {"single", "double", "triple", "home_run"}
    AB_OUT = HITS | {"strikeout", "field_out", "grounded_into_double_play", "force_out", "fielders_choice", "double_play", "field_error", "strikeout_double_play", "fielders_choice_out", "triple_play"}
    out = {}
    for side, opp_side in (("away", "home"), ("home", "away")):
        sp = starters[side]
        mine = [r for r in before if r["pitcher_id"] == sp["id"] and r["season"] == season]
        hand = next((r["p_throws"] for r in mine), None)
        mix = defaultdict(lambda: {"n": 0, "v": 0.0, "vn": 0, "sw": 0, "wh": 0})
        for r in mine:
            m = mix[r["pitch_type"] or "?"]
            m["n"] += 1
            if r["release_speed"]:
                m["v"] += r["release_speed"]
                m["vn"] += 1
            m["sw"] += r["description"] in SW
            m["wh"] += r["description"] in WH
        rows = await c.fetch("SELECT game_date, opponent_id, stats FROM player_game_history WHERE sport='mlb' AND athlete_id=$1 AND season=$2 AND game_date < $3 ORDER BY game_date", str(sp["id"]), season, day)
        log = []
        tot = defaultdict(float)
        for r in rows:
            st = r["stats"] if isinstance(r["stats"], dict) else _json.loads(r["stats"])
            if st.get("pit_inningsPitched") is None:
                continue
            ip = st["pit_inningsPitched"]
            outs = int(ip) * 3 + round((ip - int(ip)) * 10)
            tot["outs"] += outs
            for k in ("pit_earnedRuns", "pit_strikeOuts", "pit_baseOnBalls", "pit_hits", "pit_homeRuns"):
                tot[k] += st.get(k) or 0
            tot["gs"] += st.get("pit_gamesStarted") or 0
            log.append([str(r["game_date"]), str(r["opponent_id"]), ip, st.get("pit_hits"), st.get("pit_earnedRuns"), st.get("pit_baseOnBalls"), st.get("pit_strikeOuts")])
        vs_lineup = []
        for b in lineups[opp_side]:
            h2h = [r for r in before if r["batter_id"] == b["id"] and r["pitcher_id"] == sp["id"] and r["events"]]
            vs_hand = [r for r in before if r["batter_id"] == b["id"] and r["p_throws"] == hand and r["season"] == season]
            pa = [r for r in vs_hand if r["events"]]
            ab = [r for r in pa if r["events"] in AB_OUT]
            con = [r["estimated_woba"] for r in vs_hand if r["estimated_woba"] is not None and r["description"] == "hit_into_play"]
            prow = await c.fetch("SELECT stats FROM player_game_history WHERE sport='mlb' AND athlete_id=$1 AND season=$2 AND game_date < $3", str(b["id"]), season, day)
            st = defaultdict(float)
            for r in prow:
                s = r["stats"] if isinstance(r["stats"], dict) else _json.loads(r["stats"])
                for k in ("bat_atBats", "bat_hits", "bat_homeRuns", "bat_baseOnBalls", "bat_strikeOuts", "bat_totalBases", "bat_plateAppearances", "bat_hitByPitch"):
                    st[k] += s.get(k) or 0
            vs_lineup.append({"id": b["id"], "name": b["name"], "pos": b["pos"], "order": int(b["order"]) // 100, "bats": next((r["stand"] for r in before if r["batter_id"] == b["id"]), None),
                              "season": {"pa": st["bat_plateAppearances"], "avg": round(st["bat_hits"] / st["bat_atBats"], 3) if st["bat_atBats"] else None, "obp": round((st["bat_hits"] + st["bat_baseOnBalls"] + st["bat_hitByPitch"]) / st["bat_plateAppearances"], 3) if st["bat_plateAppearances"] else None,
                                         "slg": round(st["bat_totalBases"] / st["bat_atBats"], 3) if st["bat_atBats"] else None, "hr": st["bat_homeRuns"]},
                              "vsHand": {"pa": len(pa), "avg": round(sum(1 for r in ab if r["events"] in HITS) / len(ab), 3) if ab else None, "k": round(100 * sum(1 for r in pa if r["events"] in ("strikeout", "strikeout_double_play")) / len(pa), 1) if pa else None, "xwobacon": round(sum(con) / len(con), 3) if con else None},
                              "vsPitcher": {"pa": len(h2h), "h": sum(1 for r in h2h if r["events"] in HITS), "hr": sum(1 for r in h2h if r["events"] == "home_run"), "k": sum(1 for r in h2h if r["events"] in ("strikeout", "strikeout_double_play")), "bb": sum(1 for r in h2h if r["events"] in ("walk", "intent_walk")), "ab": sum(1 for r in h2h if r["events"] in AB_OUT)}})
        out[side] = {"id": sp["id"], "name": sp["name"], "hand": hand, "season": {"gs": tot["gs"], "ip": f"{int(tot['outs'] // 3)}.{int(tot['outs'] % 3)}", "era": round(27 * tot["pit_earnedRuns"] / tot["outs"], 2) if tot["outs"] else None, "whip": round(3 * (tot["pit_hits"] + tot["pit_baseOnBalls"]) / tot["outs"], 2) if tot["outs"] else None, "k": tot["pit_strikeOuts"], "bb": tot["pit_baseOnBalls"], "hr": tot["pit_homeRuns"]},
                     "log": log[-6:], "mix": sorted([{"type": k, "n": v["n"], "share": round(100 * v["n"] / len(mine), 1), "velo": round(v["v"] / v["vn"], 1) if v["vn"] else None, "whiff": round(100 * v["wh"] / v["sw"], 1) if v["sw"] else None} for k, v in mix.items()], key=lambda x: -x["n"]),
                     "pitches": len(mine), "vsLineup": vs_lineup}
    return out
