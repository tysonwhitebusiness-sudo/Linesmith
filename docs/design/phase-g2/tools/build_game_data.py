"""Phase G2 mockup data — game page, every sport. Real data only.

Run from the repo root with the python-odds-service venv:
    python-odds-service/.venv/Scripts/python.exe docs/design/phase-g2/tools/build_game_data.py [slug ...]

Writes docs/design/phase-g2/data/game-<sport>-<slug>.json.
Sources: ESPN summary (all team sports), statsapi live feed + win probability (MLB), NHL gamecenter
play-by-play + boxscore (NHL shot coordinates), TennisMyLife CSVs (tennis), and the app's own
game_odds_history / prop_odds tables (line movement and player props where captured).
"""
import asyncio
import csv
import io
import json
import os
import re
import statistics
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python-odds-service", "src"))
os.chdir(os.path.join(ROOT, "python-odds-service"))
from config import DATABASE_URL  # noqa: E402
import asyncpg  # noqa: E402

OUT = os.path.join(ROOT, "docs", "design", "phase-g2", "data")
UA = {"User-Agent": "Mozilla/5.0"}
ESPN = "https://site.api.espn.com/apis/site/v2/sports"

GAMES = {
    "mlb-kc-bos": dict(sport="mlb", pk="824711", label="KC @ BOS · Sep 11"),
    "nfl-dal-nyg": dict(sport="nfl", event="401872930", path="football/nfl", label="DAL @ NYG · Sep 13"),
    "cfb-osu-tex": dict(sport="cfb", event="401856682", path="football/college-football", label="OSU @ TEX · Sep 12"),
    "nba-okc-lal": dict(sport="nba", event="401811010", path="basketball/nba", label="OKC @ LAL · Apr 8 (last season)"),
    "nhl-fla-tor": dict(sport="nhl", event="401803621", path="hockey/nhl", nhl_date="2026-04-11", nhl_team="TOR", label="FLA @ TOR · Apr 11 (last season)"),
    "soccer-mci-mun": dict(sport="soccer", event="401879278", path="soccer/eng.1", label="MCI @ MUN · Sep 13"),
    "tennis-paul-zverev": dict(sport="tennis", players=("Tommy Paul", "Alexander Zverev"), tourney="Cincinnati Masters", round="R16", year=2026, label="Paul v Zverev · Cincinnati R16"),
}


def get_json(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def espn_header(d):
    comp = d["header"]["competitions"][0]
    teams = []
    for c in sorted(comp["competitors"], key=lambda c: 0 if c["homeAway"] == "away" else 1):
        t = c["team"]
        logo = (t.get("logos") or [{}])[0].get("href") or t.get("logo")
        teams.append(dict(id=t["id"], abbr=t.get("abbreviation"), name=t.get("displayName"), short=t.get("shortDisplayName") or t.get("name"),
                          color="#" + (t.get("color") or "3a3f46"), alt="#" + (t.get("alternateColor") or "888888"), logo=logo, homeAway=c["homeAway"],
                          score=num(c.get("score")), winner=c.get("winner"), record=(c.get("record") or [{}])[0].get("displayValue") if c.get("record") else None,
                          lines=[num(l.get("displayValue")) for l in c.get("linescores") or []]))
    gi = d.get("gameInfo", {})
    return dict(date=comp.get("date"), status=comp.get("status", {}).get("type", {}).get("detail"), venue=(gi.get("venue") or {}).get("fullName"),
                city=", ".join(v for v in ((gi.get("venue") or {}).get("address") or {}).values() if v), attendance=gi.get("attendance"), teams=teams)


def espn_team_stats(d, teams):
    by = {t["team"]["id"]: {s.get("name"): (s.get("label") or s.get("abbreviation") or s.get("name"), s.get("displayValue")) for s in t.get("statistics", [])} for t in d["boxscore"]["teams"]}
    away, home = teams[0]["id"], teams[1]["id"]
    keys = [s.get("name") for s in next(t for t in d["boxscore"]["teams"])["statistics"]]
    return [dict(key=k, label=by[away].get(k, by[home].get(k, (k, None)))[0], away=by[away].get(k, (None, None))[1], home=by[home].get(k, (None, None))[1]) for k in keys]


def espn_box(d):
    out = []
    for team in d["boxscore"].get("players", []):
        groups = []
        for g in team["statistics"]:
            ath = []
            for a in g.get("athletes", []):
                at = a["athlete"]
                ath.append(dict(id=at["id"], name=at.get("displayName"), short=at.get("shortName"), pos=(at.get("position") or {}).get("abbreviation"),
                                headshot=(at.get("headshot") or {}).get("href"), starter=a.get("starter"), dnp=a.get("didNotPlay"), stats=a.get("stats", [])))
            groups.append(dict(name=g.get("name") or "players", labels=g.get("labels"), keys=g.get("keys"), totals=g.get("totals"), athletes=ath))
        out.append(dict(team=team["team"]["id"], groups=groups))
    return out


def espn_lines(d):
    pc = (d.get("pickcenter") or [None])[0]
    if not pc:
        return None
    return dict(provider=(pc.get("provider") or {}).get("name"), details=pc.get("details"), spread=pc.get("spread"), total=pc.get("overUnder"),
                moneyline=pc.get("moneyline"), pointSpread=pc.get("pointSpread"), totalLine=pc.get("total"),
                drawML=(pc.get("drawOdds") or {}).get("moneyLine"))


def espn_wp(d):
    return [[w["playId"], round(w["homeWinPercentage"], 4)] for w in d.get("winprobability", [])]


def football(cfg, d, doc):
    plays, drives = [], []
    for dr in d.get("drives", {}).get("previous", []):
        drives.append(dict(id=dr["id"], team=dr["team"]["id"], result=dr.get("displayResult") or dr.get("result"), short=dr.get("shortDisplayResult"), yards=dr.get("yards"), plays=dr.get("offensivePlays"),
                           time=(dr.get("timeElapsed") or {}).get("displayValue"), period=((dr.get("start") or {}).get("period") or {}).get("number"),
                           clock=((dr.get("start") or {}).get("clock") or {}).get("displayValue"), start=(dr.get("start") or {}).get("yardLine"), startText=(dr.get("start") or {}).get("text"),
                           end=(dr.get("end") or {}).get("yardLine"), endText=(dr.get("end") or {}).get("text"), score=dr.get("isScore")))
        for p in dr.get("plays", []):
            st, en = p.get("start") or {}, p.get("end") or {}
            plays.append(dict(id=p["id"], drive=dr["id"], team=(st.get("team") or {}).get("id") or dr["team"]["id"], period=(p.get("period") or {}).get("number"),
                              clock=(p.get("clock") or {}).get("displayValue"), type=(p.get("type") or {}).get("text"), text=p.get("text"), yds=p.get("statYardage"),
                              start=st.get("yardsToEndzone"), end=en.get("yardsToEndzone"), down=st.get("down"), dist=st.get("distance"), downText=st.get("shortDownDistanceText"),
                              spot=st.get("possessionText"), score=p.get("scoringPlay"), turnover=p.get("isTurnover"), penalty=p.get("isPenalty"), away=p.get("awayScore"), home=p.get("homeScore")))
    doc.update(plays=plays, drives=drives, wp=espn_wp(d))
    doc["status"]["epa"] = "not in ESPN summary (nflverse play-by-play carries it; dropped at ingest)" if cfg["sport"] == "nfl" else "not held (CFBD publishes PPA; not ingested)"


def nba(cfg, d, doc):
    plays = []
    for p in d.get("plays", []):
        c = p.get("coordinate") or {}
        x, y = c.get("x"), c.get("y")
        plays.append(dict(id=p["id"], period=(p.get("period") or {}).get("number"), clock=(p.get("clock") or {}).get("displayValue"), type=(p.get("type") or {}).get("text"),
                          text=p.get("text"), team=(p.get("team") or {}).get("id"), away=p.get("awayScore"), home=p.get("homeScore"), score=p.get("scoringPlay"), pts=p.get("scoreValue"),
                          shot=p.get("shootingPlay"), att=p.get("pointsAttempted"), x=x if (x is not None and -10 < x < 60) else None, y=y if (y is not None and -10 < y < 100) else None,
                          who=((p.get("participants") or [{}])[0].get("athlete") or {}).get("id")))
    doc.update(plays=plays, wp=espn_wp(d))


def soccer(cfg, d, doc):
    events = []
    for c in d.get("commentary", []):
        p = c.get("play") or {}
        events.append(dict(seq=c.get("sequence"), minute=(c.get("time") or {}).get("displayValue"), sec=(c.get("time") or {}).get("value"), text=c.get("text"),
                           type=(p.get("type") or {}).get("text"), team=(p.get("team") or {}).get("id") or (p.get("team") or {}).get("displayName"),
                           x=p.get("fieldPositionX"), y=p.get("fieldPositionY"), x2=p.get("fieldPosition2X"), y2=p.get("fieldPosition2Y"),
                           who=[(q.get("athlete") or {}).get("displayName") for q in p.get("participants") or []]))
    key = [dict(minute=(k.get("clock") or {}).get("displayValue"), sec=(k.get("clock") or {}).get("value"), type=(k.get("type") or {}).get("text"), team=(k.get("team") or {}).get("id"),
                text=k.get("text"), short=k.get("shortText"), score=k.get("scoringPlay"), x=k.get("fieldPositionX"), y=k.get("fieldPositionY"),
                who=[(q.get("athlete") or {}).get("displayName") for q in k.get("participants") or []]) for k in d.get("keyEvents", [])]
    rosters = []
    for r in d.get("rosters", []):
        players = []
        for p in r.get("roster", []):
            a = p["athlete"]
            players.append(dict(id=a["id"], name=a.get("displayName"), short=a.get("shortName"), jersey=p.get("jersey"), pos=(p.get("position") or {}).get("abbreviation"),
                                posName=(p.get("position") or {}).get("displayName"), starter=p.get("starter"), subIn=p.get("subbedIn"), subOut=p.get("subbedOut"), place=p.get("formationPlace"),
                                stats={s["name"]: s.get("value") for s in p.get("stats", [])}))
        rosters.append(dict(team=r["team"]["id"], formation=r.get("formation"), players=players))
    doc.update(events=events, keyEvents=key, rosters=rosters, lastFive=[dict(team=t["team"]["id"], events=[dict(date=e.get("gameDate"), atVs=e.get("atVs"), score=e.get("score"), result=e.get("gameResult"), opp=(e.get("opponent") or {}).get("abbreviation"), oppLogo=e.get("opponentLogo")) for e in t.get("events", [])]) for t in d.get("lastFiveGames", [])])
    doc["status"]["xg"] = "not held for this match (Understat is cached per player, not per match)"
    doc["status"]["shots"] = "positions from ESPN commentary (a curated subset of the match's shots)"


def nhl(cfg, d, doc):
    sch = get_json(f"https://api-web.nhle.com/v1/club-schedule-season/{cfg['nhl_team']}/20252026")
    gid = next(g["id"] for g in sch["games"] if g["gameDate"] == cfg["nhl_date"])
    pbp = get_json(f"https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play")
    box = get_json(f"https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore")
    roster = {r["playerId"]: dict(name=f"{r['firstName']['default']} {r['lastName']['default']}", num=r.get("sweaterNumber"), pos=r.get("positionCode"), team=r["teamId"], headshot=r.get("headshot")) for r in pbp["rosterSpots"]}
    home_id = pbp["homeTeam"]["id"]
    events = []
    for p in pbp["plays"]:
        k, det = p["typeDescKey"], p.get("details") or {}
        if k not in ("goal", "shot-on-goal", "missed-shot", "blocked-shot", "penalty", "hit", "faceoff", "takeaway", "giveaway", "period-start", "period-end"):
            continue
        shooter = det.get("shootingPlayerId") or det.get("scoringPlayerId")
        events.append(dict(period=p["periodDescriptor"]["number"], ptype=p["periodDescriptor"]["periodType"], t=p.get("timeInPeriod"), type=k, team=det.get("eventOwnerTeamId"),
                           home=det.get("eventOwnerTeamId") == home_id if det.get("eventOwnerTeamId") else None, x=det.get("xCoord"), y=det.get("yCoord"), zone=det.get("zoneCode"),
                           shotType=det.get("shotType"), who=shooter, goalie=det.get("goalieInNetId"), a1=det.get("assist1PlayerId"), a2=det.get("assist2PlayerId"),
                           side=p.get("homeTeamDefendingSide"), situation=p.get("situationCode"), penalty=det.get("descKey"), pim=det.get("duration"), hs=det.get("homeScore"), as_=det.get("awayScore")))
    doc.update(nhl=dict(gameId=gid, homeId=home_id, awayId=pbp["awayTeam"]["id"], roster={str(k): v for k, v in roster.items()}, events=events, box=box["playerByGameStats"]))
    doc["status"]["winProbability"] = "not published by ESPN or the NHL API for hockey"
    doc["status"]["xg"] = "derivable from shot location and type (no model in the app today)"


def mlb(cfg, doc):
    feed = get_json(f"https://statsapi.mlb.com/api/v1.1/game/{cfg['pk']}/feed/live")
    wp = get_json(f"https://statsapi.mlb.com/api/v1/game/{cfg['pk']}/winProbability")
    gd, ld = feed["gameData"], feed["liveData"]
    teams = []
    for side in ("away", "home"):
        t = gd["teams"][side]
        ls = ld["linescore"]["teams"][side]
        teams.append(dict(id=str(t["id"]), abbr=t["abbreviation"], name=t["name"], short=t["teamName"], homeAway=side, score=ls.get("runs"), hits=ls.get("hits"), errors=ls.get("errors"),
                          lob=ls.get("leftOnBase"), logo=f"https://www.mlbstatic.com/team-logos/{t['id']}.svg", record=f"{t.get('record', {}).get('wins')}-{t.get('record', {}).get('losses')}" if t.get("record") else None,
                          lines=[(i.get(side) or {}).get("runs") for i in ld["linescore"]["innings"]], color={"118": "#004687", "111": "#bd3039"}.get(str(t["id"]), "#3a3f46")))
    teams[0]["winner"], teams[1]["winner"] = teams[0]["score"] > teams[1]["score"], teams[1]["score"] > teams[0]["score"]
    doc["header"] = dict(date=gd["datetime"]["dateTime"], status=gd["status"]["detailedState"], venue=gd["venue"]["name"], city=f"{gd['venue'].get('location', {}).get('city', '')}, {gd['venue'].get('location', {}).get('stateAbbrev', '')}",
                         attendance=(gd.get("gameInfo") or {}).get("attendance"), weather=gd.get("weather"), duration=(gd.get("gameInfo") or {}).get("gameDurationMinutes"), teams=teams,
                         probables={s: (gd.get("probablePitchers") or {}).get(s, {}).get("fullName") for s in ("away", "home")},
                         decisions={k: v.get("fullName") for k, v in (ld.get("decisions") or {}).items()})
    abs_ = []
    for p in ld["plays"]["allPlays"]:
        pitches = []
        hit = None
        for e in p["playEvents"]:
            if e.get("isPitch"):
                pd, c = e.get("pitchData") or {}, (e.get("pitchData") or {}).get("coordinates") or {}
                pitches.append([(e["details"].get("type") or {}).get("code"), pd.get("startSpeed"), c.get("pX"), c.get("pZ"), e["details"].get("code"), (e["details"].get("call") or {}).get("description"), pd.get("strikeZoneTop"), pd.get("strikeZoneBottom"), (e.get("count") or {}).get("balls"), (e.get("count") or {}).get("strikes")])
            if e.get("hitData"):
                h = e["hitData"]
                hit = dict(ev=h.get("launchSpeed"), la=h.get("launchAngle"), dist=h.get("totalDistance"), traj=h.get("trajectory"), x=(h.get("coordinates") or {}).get("coordX"), y=(h.get("coordinates") or {}).get("coordY"))
        a, r, m = p["about"], p["result"], p["matchup"]
        abs_.append(dict(i=a["atBatIndex"], inning=a["inning"], half=a["halfInning"], batter=m["batter"]["fullName"], batterId=m["batter"]["id"], bats=m["batSide"]["code"], pitcher=m["pitcher"]["fullName"],
                         pitcherId=m["pitcher"]["id"], throws=m["pitchHand"]["code"], event=r.get("event"), eventType=r.get("eventType"), desc=r.get("description"), rbi=r.get("rbi"), away=r.get("awayScore"),
                         home=r.get("homeScore"), scoring=a.get("isScoringPlay"), outs=(p.get("count") or {}).get("outs"), pitches=pitches, hit=hit))
    doc["atBats"] = abs_
    doc["wp"] = [[w["atBatIndex"], round(w["homeTeamWinProbability"] / 100, 4), round(w.get("homeTeamWinProbabilityAdded") or 0, 2)] for w in wp]
    box = []
    for side in ("away", "home"):
        bt = ld["boxscore"]["teams"][side]
        players = bt["players"]
        bat = [dict(id=pid, name=players[f"ID{pid}"]["person"]["fullName"], pos=players[f"ID{pid}"]["position"]["abbreviation"], order=players[f"ID{pid}"].get("battingOrder"), s=players[f"ID{pid}"]["stats"]["batting"],
                    season=players[f"ID{pid}"]["seasonStats"]["batting"]) for pid in bt["batters"] if players[f"ID{pid}"]["stats"].get("batting")]
        pit = [dict(id=pid, name=players[f"ID{pid}"]["person"]["fullName"], s=players[f"ID{pid}"]["stats"]["pitching"], season=players[f"ID{pid}"]["seasonStats"]["pitching"]) for pid in bt["pitchers"]]
        box.append(dict(team=str(bt["team"]["id"]), batting=bat, pitching=pit, teamStats=dict(batting=bt["teamStats"]["batting"], pitching=bt["teamStats"]["pitching"])))
    doc["mlbBox"] = box
    doc["sources"] += ["statsapi.mlb.com live feed (every pitch, hit data incl. distance)", "statsapi win probability (per plate appearance)"]


def tennis(cfg, doc):
    rows = []
    for yr in (2024, 2025, 2026):
        with urllib.request.urlopen(urllib.request.Request(f"https://stats.tennismylife.org/data/{yr}.csv", headers=UA), timeout=90) as r:
            rows += list(csv.DictReader(io.TextIOWrapper(r, encoding="utf-8")))
    a, b = cfg["players"]
    pair = {a, b}
    match = next(x for x in rows if {x["winner_name"], x["loser_name"]} == pair and x["tourney_name"] == cfg["tourney"] and x["round"] == cfg["round"] and x["tourney_date"].startswith(str(cfg["year"])))
    h2h = [dict(date=x["tourney_date"], tourney=x["tourney_name"], surface=x["surface"], round=x["round"], winner=x["winner_name"], score=x["score"]) for x in rows if {x["winner_name"], x["loser_name"]} == pair]

    def side(x, pre):
        return {k: num(x[f"{pre}_{k}"]) for k in ("ace", "df", "svpt", "1stIn", "1stWon", "2ndWon", "SvGms", "bpSaved", "bpFaced")}

    def player(name):
        won = match["winner_name"] == name
        pre = "winner" if won else "loser"
        recent = []
        for x in rows:
            if name not in (x["winner_name"], x["loser_name"]) or x["tourney_date"] > match["tourney_date"] or not x["tourney_date"].startswith(str(cfg["year"])):
                continue
            w = x["winner_name"] == name
            recent.append(dict(date=x["tourney_date"], tourney=x["tourney_name"], surface=x["surface"], round=x["round"], won=w, opp=x["loser_name"] if w else x["winner_name"], score=x["score"],
                               me=side(x, "w" if w else "l"), them=side(x, "l" if w else "w"), oppRank=num(x["loser_rank" if w else "winner_rank"])))
        return dict(name=name, won=won, seed=match[f"{pre}_seed"] or None, rank=num(match[f"{pre}_rank"]), points=num(match[f"{pre}_rank_points"]), hand=match[f"{pre}_hand"], ht=num(match[f"{pre}_ht"]),
                    ioc=match[f"{pre}_ioc"], age=num(match[f"{pre}_age"]), stats=side(match, "w" if won else "l"), season=recent)

    doc["tennis"] = dict(tourney=match["tourney_name"], surface=match["surface"], level=match["tourney_level"], date=match["tourney_date"], round=match["round"], bestOf=num(match["best_of"]),
                         minutes=num(match["minutes"]), score=match["score"], indoor=match.get("indoor"), players=[player(a), player(b)], h2h=h2h)
    doc["header"] = dict(date=match["tourney_date"], status="Final", venue=match["tourney_name"], teams=[])
    doc["sources"].append("TennisMyLife CSVs 2024-2026 (match stats both players, head-to-head)")
    doc["status"]["pointByPoint"] = "not held (no point-by-point source ingested)"
    doc["status"]["odds"] = "not captured for this match"


async def odds(c, doc, event_ids, start_iso):
    start = datetime.fromisoformat(start_iso.replace("Z", "+00:00")) if start_iso else None
    hist = await c.fetch("SELECT market, side, bookmaker, american_odds, point, observed_at FROM game_odds_history WHERE event_id = ANY($1::text[]) ORDER BY observed_at", event_ids)
    rows = []
    for r in hist:
        t = r["observed_at"]
        rows.append([r["market"], r["side"], r["bookmaker"], r["american_odds"], float(r["point"]) if r["point"] is not None else None, int(t.timestamp()), bool(start and t > start)])
    props = await c.fetch("SELECT subject_id, subject_name, market_key, line, side, bookmaker, american_odds, fetched_at FROM prop_odds WHERE game_id = ANY($1::text[]) AND ($2::timestamptz IS NULL OR fetched_at <= $2) ORDER BY fetched_at", event_ids, start)
    last = {}
    for r in props:
        last[(r["subject_id"], r["market_key"], r["bookmaker"], r["side"], r["line"])] = r
    grouped = defaultdict(lambda: dict(lines=[], over=[], under=[]))
    pickem = {"prizepicks", "underdog", "sleeper", "dabble", "parlayplay", "betr", "chalkboard"}  # fixed payouts, not prices
    for (sid, mk, book, side, _ln), r in last.items():
        g = grouped[(sid, mk)]
        g["name"] = r["subject_name"]
        if r["line"] is not None:
            g["lines"].append(float(r["line"]))
        if side and side.lower() in ("over", "under") and r["american_odds"] is not None and book not in pickem:
            g[side.lower()].append((r["american_odds"], book, float(r["line"]) if r["line"] is not None else None))
    prop_rows, alt_only = [], 0
    for (sid, mk), g in grouped.items():
        if not g["lines"]:
            continue
        # Main line: quoted on both sides (over and under) by the most books; alternate ladders are usually one-sided.
        # Ties, and markets with no two-sided line, go to the line priced closest to even money.
        over_books, under_books, imp = defaultdict(set), defaultdict(set), defaultdict(list)
        for price, book, ln in g["over"]:
            over_books[ln].add(book)
            imp[ln].append(100 / (price + 100) if price > 0 else -price / (-price + 100))
        for _price, book, ln in g["under"]:
            under_books[ln].add(book)
        cands = set(g["lines"])
        even = lambda ln: abs(statistics.mean(imp[ln]) - 0.5) if imp[ln] else 1  # noqa: E731
        line = max(cands, key=lambda ln: (len(over_books[ln] & under_books[ln]), -even(ln), len(over_books[ln] | under_books[ln])))
        if not (over_books[line] & under_books[line]):
            alt_only += 1  # only one-sided / alternate quotes stored: not a market line
            continue
        best = lambda arr: max((x for x in arr if x[2] == line), default=None, key=lambda x: x[0])  # noqa: E731
        bo, bu = best(g["over"]), best(g["under"])
        prop_rows.append(dict(id=sid, name=g["name"], market=mk, line=line, books=len({x[1] for x in g["over"] + g["under"]}), over=bo and dict(price=bo[0], book=bo[1]), under=bu and dict(price=bu[0], book=bu[1])))
    doc["odds"] = dict(fields=["market", "side", "book", "odds", "point", "t", "afterStart"], rows=rows, start=start_iso)
    doc["props"] = prop_rows
    doc["propsAltOnly"] = alt_only
    doc["sources"].append(f"game_odds_history ({len(rows)} snapshots) · prop_odds ({len(prop_rows)} player markets, last pre-game line per book)")


async def build(slug, cfg, c):
    doc = dict(slug=slug, sport=cfg["sport"], label=cfg["label"], builtAt=datetime.now(timezone.utc).isoformat(), sources=[], status={})
    event_ids = []
    if cfg["sport"] == "mlb":
        mlb(cfg, doc)
        event_ids = [cfg["pk"]]
    elif cfg["sport"] == "tennis":
        tennis(cfg, doc)
    else:
        d = get_json(f"{ESPN}/{cfg['path']}/summary?event={cfg['event']}")
        doc["header"] = espn_header(d)
        doc["teamStats"] = espn_team_stats(d, doc["header"]["teams"])
        doc["box"] = espn_box(d)
        doc["lines"] = espn_lines(d)
        doc["leaders"] = [dict(team=l["team"]["id"], cats=[dict(name=x.get("displayName"), leaders=[dict(id=(y.get("athlete") or {}).get("id"), name=(y.get("athlete") or {}).get("displayName"), headshot=((y.get("athlete") or {}).get("headshot") or {}).get("href"), value=y.get("displayValue")) for y in x.get("leaders", [])[:1]]) for x in l.get("leaders", [])]) for l in d.get("leaders", [])]
        series = (d.get("seasonseries") or [None])[0]
        doc["seasonSeries"] = series and dict(summary=series.get("summary"), events=[dict(date=e.get("date"), competitors=[(x.get("team") or {}).get("abbreviation") + " " + str(x.get("score")) for x in e.get("competitors", [])]) for e in series.get("events", [])])
        doc["sources"].append(f"ESPN summary, event {cfg['event']}")
        {"nfl": football, "cfb": football, "nba": nba, "soccer": soccer, "nhl": nhl}[cfg["sport"]](cfg, d, doc)
        if cfg["sport"] == "nhl":
            doc["sources"].append("NHL gamecenter play-by-play + boxscore (shot coordinates)")
        event_ids = [cfg["event"]]
    if event_ids:
        await odds(c, doc, event_ids, doc["header"].get("date"))
    path = os.path.join(OUT, f"game-{slug}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"{slug}: {os.path.getsize(path) // 1024} KB · {', '.join(k for k in doc if k not in ('slug', 'sport', 'label', 'builtAt'))}")


async def main():
    slugs = sys.argv[1:] or list(GAMES)
    c = await asyncpg.connect(DATABASE_URL, statement_cache_size=0)
    try:
        for s in slugs:
            await build(s, GAMES[s], c)
    finally:
        await c.close()


asyncio.run(main())
