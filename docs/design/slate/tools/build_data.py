"""Real-data snapshots for the Slate Sheet mockups (docs/design/slate/).

Pulls each sport's slate from the app's own APIs (the Scan snapshot, the
projection routes) and from Postgres (book prices, line history, injuries,
park factors, Statcast, history), and writes one JSON per sport into ../data/.

Every number on the mockup comes from here. Two things are computed here that
production will compute in a Python job (`slate_rankings`, spec §5): the
Spotlight / Specials composites and their factor columns. The composite is the
mean of per-factor percentile ranks, equal weights, stated on the page; the
real weights are for the pre-registered backtest to set.

Run from python-odds-service/ with its venv, with a dev server on the fixed
code (ESPN single dates, 10a1647):

    .venv/Scripts/python.exe ../docs/design/slate/tools/build_data.py --app http://localhost:62975
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
import ssl
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "python-odds-service" / "src"))

import asyncpg  # noqa: E402
import httpx  # noqa: E402
from config import DATABASE_URL  # noqa: E402

OUT = HERE.parent / "data"
ET = ZoneInfo("America/New_York")
ESPN = "https://site.api.espn.com/apis/site/v2/sports"

SPORTS = {
    "mlb": {"label": "MLB", "api": "mlb", "date": "2026-09-19", "lines": "mlb", "inj": "mlb", "proj": "mlb", "unit": "games"},
    "nfl": {"label": "NFL", "api": "nfl", "date": "2026-09-20", "espn": ("football", "nfl"), "lines": "nfl", "inj": "nfl", "proj": "nfl", "unit": "games"},
    "cfb": {"label": "College football", "api": "cfb", "date": "2026-09-19", "espn": ("football", "college-football"), "lines": "cfb", "unit": "games"},
    "epl": {"label": "Premier League", "api": "soccer/epl", "date": "2026-09-19", "espn": ("soccer", "eng.1"), "lines": "soccer", "unit": "matches"},
    "mls": {"label": "MLS", "api": "soccer/mls", "date": "2026-09-19", "espn": ("soccer", "usa.1"), "lines": "soccer", "unit": "matches"},
    "nhl": {"label": "NHL", "api": "nhl", "date": "2026-09-19", "espn": ("hockey", "nhl"), "lines": "nhl", "inj": "nhl", "proj": "nhl", "unit": "games"},
    "nba": {"label": "NBA", "offseason": True, "espn": ("basketball", "nba"), "unit": "games"},
    "atp": {"label": "ATP", "api": "tennis/atp", "date": "2026-09-19", "lines": "tennis", "unit": "matches", "tennis": "atp"},
    "wta": {"label": "WTA", "api": "tennis/wta", "date": "2026-09-19", "lines": "tennis", "unit": "matches", "tennis": "wta"},
    "golf": {"label": "Golf", "api": "golf", "date": "2026-09-19", "unit": "players"},
}

MARKET_LABELS = {
    "total-bases": "Total bases", "hits": "Hits", "home-runs": "Home runs", "rbis": "RBIs", "runs": "Runs",
    "stolen-bases": "Stolen bases", "hits-runs-rbis": "Hits + runs + RBIs", "doubles": "Doubles", "triples": "Triples",
    "singles": "Singles", "walks": "Walks", "batter-strikeouts": "Batter strikeouts", "pitcher-strikeouts": "Pitcher strikeouts",
    "pitcher-outs": "Pitcher outs", "pitcher-hits-allowed": "Hits allowed", "earned-runs": "Earned runs",
    "receptions": "Receptions", "receiving-yards": "Receiving yards", "rushing-yards": "Rushing yards",
    "passing-yards": "Passing yards", "longest-reception": "Longest reception", "longest-rush": "Longest rush",
    "kicking-points": "Kicking points", "pass-attempts": "Pass attempts", "longest-completion": "Longest completion",
    "anytime-td": "Anytime TD", "sacks": "Sacks", "passing-tds": "Passing TDs", "assists": "Assists", "tackles": "Tackles",
    "first-td-scorer": "First TD scorer", "rush-rec-tds": "Rush + rec TDs", "field-goals-made": "Field goals",
    "interceptions-thrown": "Interceptions thrown", "anytime-goalscorer": "Anytime goalscorer",
    "two-plus-goals": "Two+ goals", "first-goalscorer": "First goalscorer", "shots": "Shots", "goals": "Goals",
    "saves": "Saves", "to-win-a-set": "To win a set", "games-won": "Games won", "aces": "Aces",
    "shots-on-goal": "Shots on goal", "points": "Points",
}
YES_NO = {"anytime-td", "first-td-scorer", "anytime-goalscorer", "first-goalscorer", "two-plus-goals", "to-win-a-set"}

BOOK_NAMES = {
    "draftkings": "DraftKings", "fanduel": "FanDuel", "betmgm": "BetMGM", "caesars": "Caesars", "espnbet": "ESPN BET",
    "bet365": "bet365", "betrivers": "BetRivers", "fanatics": "Fanatics", "hardrockbet": "Hard Rock", "bovada": "Bovada",
    "betonline": "BetOnline", "pointsbet": "PointsBet", "pinnacle": "Pinnacle", "betway": "Betway", "unibet": "Unibet",
    "williamhill": "William Hill", "ballybet": "Bally Bet", "betparx": "BetParx", "fliff": "Fliff", "prizepicks": "PrizePicks",
    "underdog": "Underdog", "sleeper": "Sleeper", "betfred": "Betfred", "circasports": "Circa", "novig": "Novig",
    "prophetx": "ProphetX", "lowvig": "LowVig", "mybookie": "MyBookie", "betus": "BetUS", "wynnbet": "WynnBET",
}


def book_name(b: str | None) -> str:
    if not b:
        return ""
    return BOOK_NAMES.get(b.lower().replace("_", "").replace(" ", ""), b.replace("_", " ").title())


def implied(american: int | float | None) -> float | None:
    if american is None:
        return None
    a = float(american)
    if a == 0:
        return None
    return -a / (-a + 100) if a < 0 else 100 / (a + 100)


def fmt_odds(a) -> str:
    if a is None:
        return "—"
    a = int(round(a))
    return f"+{a}" if a > 0 else str(a)


def et_date(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET).date().isoformat()
    except ValueError:
        return None


def et_time(iso: str | None) -> str:
    if not iso:
        return ""
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET)
    return t.strftime("%-I:%M %p") if sys.platform != "win32" else t.strftime("%#I:%M %p")


def pct_ranks(values: list[float | None], higher_better: bool = True) -> list[float | None]:
    """Percentile rank 0..1 of each value among the non-null ones."""
    present = sorted(v for v in values if v is not None)
    n = len(present)
    out = []
    for v in values:
        if v is None or n == 0:
            out.append(None)
            continue
        below = sum(1 for p in present if p < v)
        equal = sum(1 for p in present if p == v)
        r = (below + 0.5 * equal) / n
        out.append(r if higher_better else 1 - r)
    return out


def composite(rows: list[dict], factors: list[tuple[str, bool]]) -> None:
    """Adds `score` (0-100): the mean of per-factor percentile ranks."""
    ranks = {k: pct_ranks([r.get(k) for r in rows], hib) for k, hib in factors}
    for i, r in enumerate(rows):
        vals = [ranks[k][i] for k, _ in factors if ranks[k][i] is not None]
        r["score"] = round(100 * sum(vals) / len(vals), 1) if vals else None
        # each factor's percentile over the WHOLE pool, for the "why" line
        r["pct"] = {k: round(100 * ranks[k][i]) for k, _ in factors if ranks[k][i] is not None}
        r["pool"] = len(rows)


# ---------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------

class Src:
    def __init__(self, app: str):
        self.app = app.rstrip("/")
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(300.0), follow_redirects=True)
        self.db: asyncpg.Connection | None = None

    async def open(self):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        dsn = re.sub(r":5432(/|$)", r":6543\1", DATABASE_URL)
        self.db = await asyncpg.connect(dsn, ssl=ctx, statement_cache_size=0)
        await self.db.execute("set statement_timeout = '180s'")

    async def close(self):
        await self.http.aclose()
        if self.db:
            await self.db.close()

    async def app_json(self, path: str):
        r = await self.http.get(f"{self.app}/api/{path}")
        r.raise_for_status()
        return r.json()

    async def espn_day(self, sport: str, league: str, day: str) -> list[dict]:
        r = await self.http.get(f"{ESPN}/{sport}/{league}/scoreboard", params={"dates": day.replace("-", ""), "limit": 500})
        r.raise_for_status()
        return r.json().get("events") or []

    async def q(self, sql: str, *args):
        return await self.db.fetch(sql, *args)


# ---------------------------------------------------------------------------
# games
# ---------------------------------------------------------------------------

def median(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


async def game_lines(src: Src, sport: str, game_ids: list[str]) -> dict[str, dict]:
    """{game_id: {market: {side: {...}}}} from current per-book lines + first-seen history."""
    if not game_ids:
        return {}
    rows = await src.q(
        "select game_id, market, side, bookmaker, point, american_odds from game_odds_book_lines "
        "where sport = $1 and game_id = any($2::text[])", sport, game_ids)
    hist = await src.q(
        """select event_id, market, side, bookmaker,
                  (array_agg(american_odds order by observed_at))[1] first_price,
                  (array_agg(point order by observed_at))[1] first_point,
                  min(observed_at) first_at
           from game_odds_history where event_id = any($1::text[]) group by 1,2,3,4""", game_ids)
    first = {(h["event_id"], h["market"], h["side"], h["bookmaker"]): h for h in hist}
    out: dict[str, dict] = defaultdict(lambda: defaultdict(dict))
    grouped = defaultdict(list)
    for r in rows:
        grouped[(r["game_id"], r["market"], r["side"])].append(r)
    for (gid, market, side), rs in grouped.items():
        # Invalid odds (|a| < 100) and quotes more than 15 implied points from the
        # median are stale or exchange artefacts (a +10000 moneyline on 2026-09-19),
        # the same rule the props outlier card uses.
        rs = [r for r in rs if r["american_odds"] is not None and abs(r["american_odds"]) >= 100]
        if not rs:
            continue
        med_ip = statistics.median(implied(r["american_odds"]) for r in rs)
        rs = [r for r in rs if abs(implied(r["american_odds"]) - med_ip) <= 0.15]
        pts = [r["point"] for r in rs if r["point"] is not None]
        cons_point = median(pts)
        at_main = [r for r in rs if r["point"] is None or cons_point is None or abs(r["point"] - cons_point) < 0.01] or rs
        # best for the bettor = the lowest implied probability
        best = min((r for r in at_main if implied(r["american_odds"]) is not None), key=lambda r: implied(r["american_odds"]))
        cons_price = median([r["american_odds"] for r in at_main])
        moves = []
        for r in rs:
            f = first.get((gid, market, side, r["bookmaker"]))
            if f and f["first_price"] is not None and implied(f["first_price"]) is not None:
                moves.append(implied(r["american_odds"]) - implied(f["first_price"]))
        pt_moves = []
        for r in rs:
            f = first.get((gid, market, side, r["bookmaker"]))
            if f and f["first_point"] is not None and r["point"] is not None:
                pt_moves.append(r["point"] - f["first_point"])
        out[gid][market][side] = {
            "point": cons_point, "price": cons_price, "bestPrice": best["american_odds"], "bestBook": book_name(best["bookmaker"]),
            "books": len({r["bookmaker"] for r in rs}),
            "movePts": round(100 * median(moves), 1) if moves else None,
            "pointMove": round(median(pt_moves), 1) if pt_moves else None,
        }
    return out


async def injuries_by_team(src: Src, sport: str | None) -> tuple[dict, dict]:
    if not sport:
        return {}, {}
    rows = await src.q(
        "select team_id, team_name, athlete_name, status from injury_report where sport = $1 "
        "and captured_on = (select max(captured_on) from injury_report where sport = $1)", sport)
    by_id, by_name = Counter(), Counter()
    for r in rows:
        by_id[str(r["team_id"])] += 1
        by_name[(r["team_name"] or "").lower()] += 1
    return by_id, by_name


def espn_team(c: dict) -> dict:
    t = c.get("team") or {}
    rec = (c.get("records") or [{}])[0].get("summary") if c.get("records") else None
    rank = (c.get("curatedRank") or {}).get("current")
    return {
        "id": str(t.get("id")), "name": t.get("displayName"), "short": t.get("shortDisplayName") or t.get("displayName"),
        "abbr": t.get("abbreviation"), "logo": t.get("logo"), "record": rec,
        "score": c.get("score") if c.get("score") not in (None, "") else None,
        "rank": rank if rank and 1 <= rank <= 25 else None,
    }


def espn_status(ev: dict) -> tuple[str, str]:
    st = ((ev.get("competitions") or [{}])[0].get("status") or {}).get("type") or {}
    state = st.get("state") or "pre"
    return {"pre": "upcoming", "in": "live", "post": "final"}.get(state, "upcoming"), st.get("shortDetail") or ""


# ---------------------------------------------------------------------------
# props board
# ---------------------------------------------------------------------------

def hist_values(cand: dict) -> list[float]:
    out = []
    for h in cand.get("history") or []:
        try:
            out.append(float(h.get("result")))
        except (TypeError, ValueError):
            pass
    return out


def hit_rate(vals: list[float], line: float, n: int | None) -> tuple[int, int] | None:
    seg = vals[-n:] if n else vals
    if not seg:
        return None
    return sum(1 for v in seg if v > line), len(seg)


def streak(vals: list[float], line: float) -> tuple[str, int]:
    if not vals:
        return ("", 0)
    last = "O" if vals[-1] > line else "U"
    n = 0
    for v in reversed(vals):
        if ("O" if v > line else "U") == last:
            n += 1
        else:
            break
    return last, n


async def props_board(src: Src, key: str, cfg: dict, snap: dict, game_ids: list[str], projections: dict) -> dict:
    if not game_ids:
        return {"markets": [], "rows": [], "outliers": [], "splits": []}
    rows = await src.q(
        """select distinct on (subject_id, market_key, line, side, lower(bookmaker))
                  game_id, subject_id, subject_name, market_key, line, side, bookmaker, american_odds, fetched_at
           from prop_odds where game_id = any($1::text[])
           order by subject_id, market_key, line, side, lower(bookmaker), fetched_at desc""", game_ids)
    cands: dict[tuple[str, str], dict] = {}
    for c in snap.get("candidates") or []:
        k = (str(c["subjectId"]), c["dimension"])
        if k not in cands or c.get("category") in ("over", "yes"):
            cands[k] = c
    subjects = {str(s["subjectId"]): s for s in snap.get("subjects") or []}

    by_prop = defaultdict(list)
    for r in rows:
        by_prop[(r["subject_id"], r["market_key"])].append(r)

    out_rows, outliers, splits = [], [], []
    market_counts = Counter()
    for (sid, market), rs in by_prop.items():
        overs = [r for r in rs if r["side"] in ("over", "yes")]
        unders = [r for r in rs if r["side"] in ("under", "no")]
        if not overs:
            continue
        line_books = Counter(r["line"] for r in overs)
        main_line = max(line_books.items(), key=lambda kv: (kv[1], -(kv[0] or 0)))[0]
        o_main = [r for r in overs if r["line"] == main_line]
        u_main = [r for r in unders if r["line"] == main_line]
        best_o = max(o_main, key=lambda r: -implied(r["american_odds"]))
        best_u = max(u_main, key=lambda r: -implied(r["american_odds"])) if u_main else None
        books = len({r["bookmaker"].lower() for r in o_main})
        market_counts[market] += 1

        cand = cands.get((sid, market))
        meta = (cand or {}).get("subjectMeta") or {}
        subj = subjects.get(sid) or {}
        smeta = subj.get("meta") or {}
        name = (cand or {}).get("subjectName") or subj.get("subjectName") or rs[0]["subject_name"] or sid
        line = main_line if main_line is not None else 0.5
        vals = hist_values(cand) if cand else []
        l5, l10, l15, szn = (hit_rate(vals, line, n) for n in (5, 10, 15, None))
        stk = streak(vals, line)
        h2h = None
        for sp in (cand or {}).get("supportingSplits") or []:
            if sp.get("kind") == "head-to-head" or str(sp.get("label", "")).startswith("vs "):
                st = sp.get("stat") or {}
                if st.get("total"):
                    h2h = [st.get("hits"), st.get("total")]
        proj = projections.get((sid, market))
        prob = proj.get("probability") if proj else meta.get("modelProb")
        base = proj.get("leagueBaseline") if proj else None
        sample = (proj or {}).get("sampleSize") or (cand or {}).get("sampleSize")
        ladder = defaultdict(dict)
        for r in rs:
            ladder[(r["line"], book_name(r["bookmaker"]))][r["side"]] = r["american_odds"]
        row = {
            "id": f"{sid}|{market}", "sid": sid, "name": name, "market": market,
            "team": meta.get("team") or smeta.get("team"), "opp": meta.get("opponent") or smeta.get("opponent"),
            "home": meta.get("isHome"), "face": meta.get("headshotUrl") or smeta.get("headshotUrl"),
            "logo": meta.get("teamLogoUrl") or smeta.get("teamLogoUrl"), "gameId": rs[0]["game_id"],
            "line": main_line, "yesNo": market in YES_NO,
            "over": best_o["american_odds"], "overBook": book_name(best_o["bookmaker"]),
            "under": best_u["american_odds"] if best_u else None, "underBook": book_name(best_u["bookmaker"]) if best_u else None,
            "ip": round(100 * implied(best_o["american_odds"]), 1), "books": books,
            "model": round(100 * prob, 1) if prob is not None and (proj is None or proj.get("hasProbability", True)) else None,
            "proj": round(proj["projection"], 2) if proj and proj.get("projection") is not None else None,
            "delta": (prob - base) if (prob is not None and base is not None) else None,
            "dvp": meta.get("matchupRank"), "conf": None if sample is None else ("Thin" if sample < 20 else "Some" if sample < 100 else "Deep"),
            "l5": l5, "l10": l10, "l15": l15, "szn": szn, "h2h": h2h,
            "streak": [1 if v > line else 0 for v in vals[-5:]], "strk": f"{stk[0]}{stk[1]}" if stk[1] else None,
            "last10": vals[-10:],
            "ladder": sorted([[ln, bk, sides.get("over", sides.get("yes")), sides.get("under", sides.get("no"))] for (ln, bk), sides in ladder.items()],
                             key=lambda x: ((x[0] or 0), x[1])),
        }
        if row["proj"] is not None and main_line is not None:
            row["diff"] = round(row["proj"] - main_line, 2)
        out_rows.append(row)

        # price outliers: one book >= 4 pts better than the median of the others, >= 5 books
        if books >= 5:
            for r in o_main:
                others = [implied(x["american_odds"]) for x in o_main if x is not r]
                med = statistics.median(others)
                gap = 100 * (med - implied(r["american_odds"]))
                # 4..15 points. Above 15 is a stale or exchange quote (Kalshi +9900 against a
                # -156 median, measured 2026-09-19), not a price anyone can take.
                if 4 <= gap <= 15:
                    outliers.append({"name": name, "sid": sid, "face": row["face"], "team": row["team"], "market": market, "line": main_line,
                                     "side": "Over" if not row["yesNo"] else "Yes", "book": book_name(r["bookmaker"]), "price": r["american_odds"],
                                     "median": round(-100 * med / (1 - med)) if med > 0.5 else round(100 * (1 - med) / med), "gap": round(gap, 1), "books": books})
        # line disagreements: the books quote more than one line
        if len(line_books) > 1 and books >= 3 and not row["yesNo"]:
            alt = [(ln, n) for ln, n in line_books.items() if ln != main_line]
            ln, n = max(alt, key=lambda x: x[1])
            alt_books = sorted({book_name(r["bookmaker"]) for r in overs if r["line"] == ln})
            splits.append({"name": name, "sid": sid, "face": row["face"], "team": row["team"], "market": market,
                           "main": main_line, "mainBooks": line_books[main_line], "alt": ln, "altBooks": n, "altList": alt_books[:4]})

    # rank like Scan: delta desc, then projection, within market
    for m in market_counts:
        ms = [r for r in out_rows if r["market"] == m]
        ms.sort(key=lambda r: (r["delta"] is None, -(r["delta"] or 0), -(r["proj"] or 0), -((r["l10"] or [0, 1])[0] / max((r["l10"] or [0, 1])[1], 1)), -r["books"]))
        for i, r in enumerate(ms, 1):
            r["rank"] = i
    out_rows.sort(key=lambda r: (-market_counts[r["market"]], r["market"], r.get("rank", 999)))
    outliers.sort(key=lambda o: -o["gap"])
    splits.sort(key=lambda s: -(s["mainBooks"] + s["altBooks"]))
    markets = [{"key": m, "label": MARKET_LABELS.get(m, m.replace("-", " ").capitalize()), "count": n} for m, n in market_counts.most_common()]
    # keep the page light: first 60 rows per market, ladders on the first 25
    keep = []
    per = Counter()
    for r in out_rows:
        per[r["market"]] += 1
        if per[r["market"]] > 60:
            continue
        if per[r["market"]] > 25:
            r["ladder"] = None
        keep.append(r)
    return {"markets": markets, "rows": keep, "total": len(out_rows), "outliers": outliers[:10], "splits": splits[:10],
            "outlierPool": sum(1 for (sid, m), rs in by_prop.items() if len({r['bookmaker'].lower() for r in rs if r['side'] in ('over', 'yes')}) >= 5)}


async def prop_movers(src: Src, game_ids: list[str], names: dict[str, dict]) -> list[dict]:
    if not game_ids:
        return []
    rows = await src.q(
        """with b as (
             select subject_id, market_key, line, bookmaker,
                    (array_agg(american_odds order by observed_at))[1] f,
                    (array_agg(american_odds order by observed_at desc))[1] l,
                    min(observed_at) first_at,
                    min(observed_at) filter (where true) t0
             from prop_odds_history
             where game_id = any($1::text[]) and side in ('over','yes')
             group by 1,2,3,4)
           select * from b""", game_ids)
    grouped = defaultdict(list)
    for r in rows:
        if r["f"] is None or r["l"] is None:
            continue
        grouped[(r["subject_id"], r["market_key"], r["line"])].append(r)
    out = []
    for (sid, market, line), rs in grouped.items():
        if len(rs) < 3:
            continue
        mv = [100 * (implied(r["l"]) - implied(r["f"])) for r in rs]
        moved = [m for m in mv if abs(m) >= 1]
        if not moved:
            continue
        med = statistics.median(mv)
        same_dir = sum(1 for m in moved if (m > 0) == (med > 0))
        f_med = median([r["f"] for r in rs])
        l_med = median([r["l"] for r in rs])
        n = names.get(sid, {})
        out.append({"sid": sid, "name": n.get("name", sid), "face": n.get("face"), "team": n.get("team"), "market": market, "line": line,
                    "first": round(f_med), "now": round(l_med), "move": round(med, 1), "moved": len(moved), "books": len(rs),
                    "steam": same_dir >= 3 and abs(med) >= 2, "firstAt": min(r["first_at"] for r in rs).isoformat()})
    out.sort(key=lambda m: -abs(m["move"]))
    top = out[:20]
    # hourly median implied for a sparkline
    for m in top:
        pts = await src.q(
            """select date_trunc('hour', observed_at) h, percentile_cont(0.5) within group (order by american_odds) p
               from prop_odds_history where game_id = any($1::text[]) and subject_id = $2 and market_key = $3 and line is not distinct from $4
                 and side in ('over','yes') group by 1 order by 1""", game_ids, m["sid"], m["market"], m["line"])
        m["spark"] = [round(100 * implied(p["p"]), 1) for p in pts if p["p"]][-24:]
    return top


async def game_movers(src: Src, games: list[dict]) -> list[dict]:
    out = []
    for g in games:
        for market, sides in (g.get("lines") or {}).items():
            for side, v in sides.items():
                if v.get("movePts") is None:
                    continue
                label = {"moneyline": "Moneyline", "spread": "Spread", "total": "Total"}.get(market, market)
                who = g["away"]["abbr"] if side == "away" else g["home"]["abbr"] if side == "home" else side.capitalize()
                out.append({"game": f'{g["away"]["abbr"]} @ {g["home"]["abbr"]}', "logoA": g["away"].get("logo"), "logoH": g["home"].get("logo"),
                            "market": label, "side": who, "point": v.get("point"), "pointMove": v.get("pointMove"),
                            "price": v.get("price"), "move": v["movePts"], "books": v["books"]})
    out.sort(key=lambda m: -abs(m["move"]))
    return out[:20]


# ---------------------------------------------------------------------------
# per-sport builders
# ---------------------------------------------------------------------------

async def projections_for(src: Src, sport: str | None) -> dict:
    if not sport:
        return {}
    try:
        d = await src.app_json(f"{sport}/projections")
    except Exception:
        return {}
    out = {}
    for m in d.get("markets") or []:
        for r in m.get("rows") or []:
            out[(str(r["subjectId"]), m["key"])] = {**r, "hasProbability": m.get("hasProbability")}
    return out


async def build_team_sport(src: Src, key: str, cfg: dict) -> dict:
    snap = await src.app_json(cfg["api"])
    day = cfg["date"]
    by_id, by_name = await injuries_by_team(src, cfg.get("inj"))
    games: list[dict] = []
    if key == "mlb":
        pf = {r["venue_name"]: r["factor"] for r in await src.q("select venue_name, factor from park_factors where season = 2026")}
        for g in snap["context"]["other"]["games"]:
            if et_date(g.get("firstPitch")) != day:
                continue
            status = g.get("status") or "pre"
            st = {"pre": "upcoming", "live": "live", "in": "live", "final": "final", "post": "final"}.get(status, "upcoming")
            def side(which):
                t = g[which]
                rec = t.get("record") or {}
                name = g[f"{which}TeamName"]
                stats = {s["key"]: s["value"] for s in g.get(f"{which}StarterStats") or []}
                return {"id": str(t.get("teamId")), "name": name, "abbr": g["matchup"].split("@")[0 if which == "away" else 1].strip(),
                        "logo": f"https://www.mlbstatic.com/team-logos/{t.get('teamId')}.svg",
                        "record": f"{rec.get('wins')}-{rec.get('losses')}" if rec else None,
                        "score": t.get("score"), "starter": g.get(f"{which}Starter"),
                        "starterLine": (f"{stats['era']:.2f} ERA · {int(stats['strikeOuts'])} K" if "era" in stats and "strikeOuts" in stats else None),
                        "injuries": by_name.get(name.lower(), 0)}
            gm = g.get("gameModel") or {}
            w = g.get("weather")
            factor = pf.get(g.get("venue"))
            chips = []
            if factor:
                pct = round((factor - 1) * 100)
                chips.append({"kind": "park", "text": "Park neutral" if pct == 0 else f"Park {'+' if pct > 0 else '−'}{abs(pct)}% runs",
                              "tip": f"{g['venue']}: runs scored here against the league average this season."})
            if w:
                chips.append({"kind": "weather", "text": f"{w.get('tempF')}° · wind {w.get('windMph')} mph {w.get('windDir')} · rain {w.get('rainPct')}%",
                              "tip": g.get("weatherNarrative")})
            games.append({"id": str(g["gamePk"]), "start": g.get("firstPitch"), "time": et_time(g.get("firstPitch")), "status": st,
                          "statusText": g.get("state") if st != "upcoming" else et_time(g.get("firstPitch")),
                          "away": side("away"), "home": side("home"), "venue": g.get("venue"), "chips": chips,
                          "model": {"home": gm.get("homeWinProb"), "away": gm.get("awayWinProb"),
                                    "homeRuns": gm.get("homeExpectedRuns"), "awayRuns": gm.get("awayExpectedRuns")} if gm else None})
    else:
        sport, league = cfg["espn"]
        evs = await src.espn_day(sport, league, day)
        snap_games = {str(g["gamePk"]): g for g in snap["context"]["other"].get("games") or []}
        weather = {}
        for c in snap.get("candidates") or []:
            w = ((c.get("context") or {}).get("weather"))
            gp = str((c.get("subjectMeta") or {}).get("gamePk"))
            if w and gp not in weather:
                weather[gp] = w
        for ev in evs:
            comp = (ev.get("competitions") or [{}])[0]
            cs = comp.get("competitors") or []
            h = next((c for c in cs if c.get("homeAway") == "home"), None)
            a = next((c for c in cs if c.get("homeAway") == "away"), None)
            if not h or not a:
                continue
            st, detail = espn_status(ev)
            away, home = espn_team(a), espn_team(h)
            for t in (away, home):
                t["injuries"] = by_id.get(t["id"], 0) if cfg.get("inj") else None
            venue = comp.get("venue") or {}
            chips = []
            w = weather.get(str(ev["id"]))
            if w and venue.get("indoor") is False:
                chips.append({"kind": "weather", "text": f"{w.get('tempF')}° · wind {w.get('windMph')} mph {w.get('windDir')} · rain {w.get('rainPct')}%",
                              "tip": "Area forecast for the venue's city, not an on-site reading."})
            elif venue.get("indoor") is True:
                chips.append({"kind": "roof", "text": "Indoors"})
            games.append({"id": str(ev["id"]), "start": ev.get("date"), "time": et_time(ev.get("date")), "status": st,
                          "statusText": detail if st != "upcoming" else et_time(ev.get("date")),
                          "away": away, "home": home, "venue": venue.get("fullName"), "chips": chips, "model": None,
                          "inSnapshot": str(ev["id"]) in snap_games})
    ids = [g["id"] for g in games]
    lines = await game_lines(src, cfg["lines"], ids)
    for g in games:
        g["lines"] = lines.get(g["id"]) or {}
    if cfg["lines"] == "soccer":
        # The live per-book feed carries no draw price; the archive has one where
        # the harvester scraped it (measured 2026-09-19: EPL 44 draw rows vs 140 home).
        draws = await src.q("""select event_ref, count(distinct bookmaker) books, percentile_disc(0.5) within group (order by price) price,
                                      max(price) best
                               from odds_archive where market = 'moneyline' and side = 'draw' and event_ref = any($1::text[])
                               group by 1""", ids)
        for d in draws:
            g = next((x for x in games if x["id"] == d["event_ref"]), None)
            if g is not None:
                g["lines"].setdefault("moneyline", {})["draw"] = {"point": None, "price": d["price"], "bestPrice": d["best"],
                                                                   "bestBook": None, "books": d["books"], "movePts": None, "pointMove": None,
                                                                   "source": "archive"}
    games.sort(key=lambda g: (g["start"] or ""))

    projections = await projections_for(src, cfg.get("proj"))
    board = await props_board(src, key, cfg, snap, ids, projections)
    per_game = Counter(r["gameId"] for r in board["rows"])
    total_per_game = Counter()
    for r in board["rows"]:
        total_per_game[r["gameId"]] += 1
    for g in games:
        g["props"] = total_per_game.get(g["id"], 0)

    names = {}
    for r in board["rows"]:
        names[r["sid"]] = {"name": r["name"], "face": r["face"], "team": r["team"]}
    for c in snap.get("candidates") or []:
        names.setdefault(str(c["subjectId"]), {"name": c["subjectName"], "face": (c.get("subjectMeta") or {}).get("headshotUrl"),
                                                "team": (c.get("subjectMeta") or {}).get("team")})
    movers = {"props": await prop_movers(src, ids, names), "games": await game_movers(src, games)}
    books = set()
    for g in games:
        for sides in g["lines"].values():
            for v in sides.values():
                books.add(v["books"])
    return {"snap": snap, "games": games, "board": board, "movers": movers, "projections": projections}


def spotlight_common(board: dict) -> list[dict]:
    rows = [r for r in board["rows"] if r.get("l10") and r["l10"][1] >= 10 and not r["yesNo"]]
    leaders = sorted(rows, key=lambda r: (-(r["l10"][0] / r["l10"][1]), -r["books"]))[:8]
    streaks = [r for r in board["rows"] if r.get("strk") and int(r["strk"][1:]) >= 5 and not r["yesNo"]]
    streaks.sort(key=lambda r: -int(r["strk"][1:]))
    pick = lambda r: {k: r.get(k) for k in ("sid", "name", "face", "team", "opp", "market", "line", "l10", "l15", "szn", "books", "strk", "streak", "over", "overBook")}
    return [
        {"id": "hit-rate", "title": "Hit-rate leaders", "desc": "Best over-rate in the last 10 games at today's main line. Minimum 10 games.",
         "kind": "hitrate", "rows": [pick(r) for r in leaders]},
        {"id": "streaks", "title": "Active streaks", "desc": "Five or more straight overs or unders against today's line.",
         "kind": "streaks", "rows": [pick(r) for r in streaks[:8]]},
    ]


async def mlb_extras(src: Src, built: dict) -> dict:
    snap, games, board = built["snap"], built["games"], built["board"]
    today_ids = {g["id"] for g in games}
    cands = [c for c in snap["candidates"] if str((c.get("subjectMeta") or {}).get("gamePk")) in today_ids]
    batters = {}
    for c in cands:
        m = c.get("subjectMeta") or {}
        if m.get("position") == "P" or c["dimension"].startswith("pitcher") or not m.get("opposingStarterId"):
            continue
        batters.setdefault(str(c["subjectId"]), {"sid": str(c["subjectId"]), "name": c["subjectName"], "face": m.get("headshotUrl"),
                                                 "team": m.get("team"), "opp": m.get("opponent"), "gamePk": str(m.get("gamePk")),
                                                 "bats": m.get("batSide"), "starter": m.get("opposingStarter"), "starterId": m.get("opposingStarterId"),
                                                 "starterStats": {s["key"]: s for s in m.get("opposingStarterStats") or []}})
    ids = list(batters)
    sc = {str(r["player_id"]): json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
          for r in await src.q("select player_id, payload from mlb_statcast_player_season where season = 2026 and role = 'bat' and player_id::text = any($1::text[])", ids)}
    starter_ids = sorted({str(b["starterId"]) for b in batters.values()})
    hands = {}
    r = await src.http.get("https://statsapi.mlb.com/api/v1/people", params={"personIds": ",".join(starter_ids)})
    for p in r.json().get("people") or []:
        hands[str(p["id"])] = (p.get("pitchHand") or {}).get("code")
    pgh = {str(r["athlete_id"]): r for r in await src.q(
        """select athlete_id, sum((stats->>'bat_homeRuns')::numeric) hr, sum((stats->>'bat_plateAppearances')::numeric) pa,
                  sum((stats->>'bat_totalBases')::numeric) tb, count(*) g
           from player_game_history where sport='mlb' and season=2026 and stats ? 'bat_plateAppearances' and athlete_id = any($1::text[]) group by 1""", ids)}
    pf = {r["venue_name"]: r["factor"] for r in await src.q("select venue_name, factor from park_factors where season = 2026")}
    game_by = {g["id"]: g for g in games}
    rows_long, rows_hr, rows_tb, platoon = [], [], [], []
    for sid, b in batters.items():
        p = sc.get(sid) or {}
        g = game_by.get(b["gamePk"]) or {}
        hand = hands.get(str(b["starterId"]))
        park = pf.get(g.get("venue"))
        weather = next((c["text"] for c in g.get("chips", []) if c["kind"] == "weather"), None)
        temp = None
        if weather:
            mt = re.match(r"(-?\d+)°", weather)
            temp = int(mt.group(1)) if mt else None
        ss = b["starterStats"]
        hr_allowed = ss.get("homeRuns", {}).get("value")
        hrs = p.get("hrList") or []
        split = (p.get("splitsByHand") or {}).get(hand or "", {})
        h = pgh.get(sid)
        base = {"sid": sid, "name": b["name"], "face": b["face"], "team": b["team"], "opp": b["opp"], "bats": b["bats"],
                "starter": b["starter"], "hand": hand, "park": round((park - 1) * 100) if park else None, "temp": temp}
        if len(hrs) >= 3:
            d = [x["distance"] for x in hrs if x.get("distance")]
            rows_long.append({**base, "hr": len(hrs), "avgDist": round(sum(d) / len(d)) if d else None, "maxDist": max(d) if d else None,
                              "maxEV": p.get("maxEV"), "barrel": (p.get("percentiles") or {}).get("barrelish"), "starterHr": hr_allowed})
        if h and h["pa"] and h["pa"] >= 150:
            rows_hr.append({**base, "hrPa": round(float(h["hr"]) / float(h["pa"]) * 100, 2), "hrSeason": int(h["hr"]),
                            "vsHandHrPa": round(split["hr"] / split["pa"] * 100, 2) if split.get("pa") else None, "starterHr": hr_allowed})
            rows_tb.append({**base, "tbG": round(float(h["tb"]) / h["g"], 2), "vsHandSlg": split.get("slg")})
        if split.get("pa", 0) >= 60:
            platoon.append({**base, "pa": split["pa"], "xwobacon": split.get("xwobacon"), "slg": split.get("slg"), "kPct": split.get("kPct"),
                            "hrVs": split.get("hr")})
    composite(rows_long, [("avgDist", True), ("maxEV", True), ("barrel", True), ("park", True), ("starterHr", True)])
    composite(rows_hr, [("hrPa", True), ("vsHandHrPa", True), ("starterHr", True), ("park", True)])
    tb_l10 = {r["sid"]: r for r in board["rows"] if r["market"] == "total-bases"}
    for r in rows_tb:
        t = tb_l10.get(r["sid"])
        r["tbL10"] = round(sum(t["last10"]) / len(t["last10"]), 2) if t and t.get("last10") else None
    composite(rows_tb, [("tbL10", True), ("tbG", True), ("vsHandSlg", True), ("park", True)])
    platoon.sort(key=lambda r: -(r["xwobacon"] or 0))

    # pitchers: starters today
    pitch_rows = []
    kproj = {k[0]: v for k, v in built["projections"].items() if k[1] == "pitcher-strikeouts"}
    kline = {r["sid"]: r for r in board["rows"] if r["market"] == "pitcher-strikeouts"}
    for g in games:
        for side, opp in (("away", "home"), ("home", "away")):
            src_g = next(x for x in snap["context"]["other"]["games"] if str(x["gamePk"]) == g["id"])
            pid = str(src_g.get(f"{side}StarterId") or "")
            if not pid:
                continue
            stats = {s["key"]: s["value"] for s in src_g.get(f"{side}StarterStats") or []}
            opp_k = ((src_g.get(opp) or {}).get("forStats") or {}).get("strikeOuts")
            pr = kproj.get(pid)
            pitch_rows.append({"sid": pid, "name": src_g.get(f"{side}Starter"), "team": g[side]["abbr"], "opp": g[opp]["abbr"],
                               "face": f"https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/v1/people/{pid}/headshot/67/current",
                               "k": stats.get("strikeOuts"), "kbb": round(stats["kbbPct"], 1) if stats.get("kbbPct") is not None else None,
                               "whiff": round(stats["whiffPct"], 1) if stats.get("whiffPct") is not None else None,
                               "oppK": round(opp_k, 2) if opp_k else None, "proj": round(pr["projection"], 2) if pr else None,
                               "line": (kline.get(pid) or {}).get("line"), "hand": hands.get(pid)})
    composite(pitch_rows, [("proj", True), ("kbb", True), ("whiff", True), ("oppK", True)])

    parks = []
    hr_allowed = {str(r["team_id"]): r for r in await src.q("select team_id, games_faced, games_with_hr_allowed from team_hr_rate_allowed where season = 2026")}
    for g in games:
        src_g = next(x for x in snap["context"]["other"]["games"] if str(x["gamePk"]) == g["id"])
        f = pf.get(g["venue"])
        a = hr_allowed.get(str(src_g["awayTeamId"])) or {}
        h = hr_allowed.get(str(src_g["homeTeamId"])) or {}
        rate = lambda t: round(100 * t["games_with_hr_allowed"] / t["games_faced"]) if t and t.get("games_faced") else None
        w = next((c["text"] for c in g["chips"] if c["kind"] == "weather"), None)
        parks.append({"game": f'{g["away"]["abbr"]} @ {g["home"]["abbr"]}', "logoA": g["away"]["logo"], "logoH": g["home"]["logo"],
                      "venue": g["venue"], "park": round((f - 1) * 100) if f else None, "awayRate": rate(a), "homeRate": rate(h),
                      "weather": w or "Roof"})
    composite(parks, [("park", True), ("awayRate", True), ("homeRate", True)])

    # receipts: yesterday's real outcomes (the ranking runs daily from S4; these are what it will grade against)
    yday = (date.fromisoformat(SPORTS["mlb"]["date"]) - timedelta(days=1)).isoformat()
    long_y = []
    for r in await src.q("select player_id, payload from mlb_statcast_player_season where season = 2026 and role='bat'"):
        p = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
        for x in p.get("hrList") or []:
            if x.get("date") == yday and x.get("distance"):
                long_y.append({"sid": str(r["player_id"]), "distance": x["distance"], "ev": x.get("ev")})
    long_y.sort(key=lambda x: -x["distance"])
    ids_y = [x["sid"] for x in long_y[:5]]
    k_y = await src.q("""select athlete_id, (stats->>'pit_strikeOuts')::numeric::int k from player_game_history
                         where sport='mlb' and game_date = $1 and stats ? 'pit_strikeOuts' order by 2 desc limit 5""", date.fromisoformat(yday))
    hr_y = await src.q("""select count(*) n from player_game_history where sport='mlb' and game_date=$1 and (stats->>'bat_homeRuns')::numeric > 0""", date.fromisoformat(yday))
    ppl = {}
    want = ids_y + [str(r["athlete_id"]) for r in k_y]
    if want:
        rr = await src.http.get("https://statsapi.mlb.com/api/v1/people", params={"personIds": ",".join(want)})
        ppl = {str(p["id"]): p["fullName"] for p in rr.json().get("people") or []}

    specials = [
        {"id": "longest-hr", "title": "Longest HR of the day", "promo": "Longest home run", "kind": "longhr",
         "rows": sorted(rows_long, key=lambda r: -(r["score"] or 0))[:10],
         "receipts": {"date": yday, "label": "Longest home runs yesterday", "rows": [{"name": ppl.get(x["sid"], x["sid"]), "value": f'{int(x["distance"])} ft', "sub": f'{x["ev"]} mph'} for x in long_y[:5]]}},
        {"id": "hr-of-day", "title": "HR of the day", "promo": "Player to hit a home run", "kind": "hrday",
         "rows": sorted(rows_hr, key=lambda r: -(r["score"] or 0))[:10],
         "receipts": {"date": yday, "label": "Players homered yesterday", "count": hr_y[0]["n"]}},
        {"id": "most-k", "title": "Most strikeouts", "promo": "Most strikeouts on the slate", "kind": "mostk",
         "rows": sorted(pitch_rows, key=lambda r: -(r["score"] or 0))[:10],
         "receipts": {"date": yday, "label": "Most strikeouts yesterday", "rows": [{"name": ppl.get(str(r["athlete_id"]), str(r["athlete_id"])), "value": f'{r["k"]} K'} for r in k_y]}},
        {"id": "most-tb", "title": "Most total bases", "promo": "Most hits / total bases", "kind": "mosttb",
         "rows": sorted(rows_tb, key=lambda r: -(r["score"] or 0))[:10], "receipts": None},
    ]
    spotlights = spotlight_common(board) + [
        {"id": "platoon", "title": "Platoon spots", "desc": "Batters facing the hand they hit best, by xwOBA on contact vs that hand. Minimum 60 PA.",
         "kind": "platoon", "rows": platoon[:8]},
        {"id": "k-spots", "title": "Pitcher strikeout spots", "desc": "Today's starters by projected strikeouts, K-BB% and whiff rate, against the opponent's strikeouts per game.",
         "kind": "kspots", "rows": sorted(pitch_rows, key=lambda r: -(r["proj"] or 0))[:8]},
        {"id": "hr-parks", "title": "HR-friendly parks today", "desc": "Park run factor, each staff's share of games allowing a HR, and the forecast.",
         "kind": "parks", "rows": sorted(parks, key=lambda r: -(r["score"] or 0))},
    ]

    # model card
    picks = await src.q("""select matchup, home_team_name, away_team_name, commence_time, coalesce(ml_final_side, ml_initial_side) side,
                                  coalesce(ml_final_prob, ml_initial_prob) prob, coalesce(ml_final_price, ml_initial_price) price,
                                  coalesce(total_final_side, total_initial_side) tside, coalesce(total_final_prob, total_initial_prob) tprob,
                                  coalesce(total_final_line, total_initial_line) tline, coalesce(total_final_price, total_initial_price) tprice,
                                  ml_outcome, total_outcome, game_id
                           from game_picks where sport='mlb' and commence_time >= $1 and commence_time < $2 order by commence_time""",
                        datetime(2026, 9, 19, 8, tzinfo=timezone.utc), datetime(2026, 9, 20, 8, tzinfo=timezone.utc))
    graded = await src.q("""select date_trunc('day', commence_time at time zone 'America/New_York') d, ml_outcome, total_outcome
                            from game_picks where sport='mlb' and graded_at is not null and commence_time > now() - interval '31 days'""")
    rec = lambda rows, days, col: Counter(r[col] for r in rows if r[col] and r["d"] >= datetime.now() - timedelta(days=days))
    yday_picks = await src.q("""select matchup, coalesce(ml_final_side, ml_initial_side) side, coalesce(ml_final_prob, ml_initial_prob) prob,
                                       coalesce(ml_final_price, ml_initial_price) price, ml_outcome, final_home_score, final_away_score
                                from game_picks where sport='mlb' and commence_time >= $1 and commence_time < $2 and ml_outcome is not null order by commence_time""",
                             datetime(2026, 9, 18, 8, tzinfo=timezone.utc), datetime(2026, 9, 19, 8, tzinfo=timezone.utc))
    cal = await src.q("select market, method, version, fitted_at from model_calibration where sport='mlb' and active order by market")
    model = {
        "today": [{"matchup": p["matchup"], "time": et_time(p["commence_time"].isoformat()), "side": p["side"],
                   "team": p["home_team_name"] if p["side"] == "home" else p["away_team_name"], "prob": p["prob"], "price": p["price"],
                   "ip": round(100 * implied(p["price"]), 1) if p["price"] else None,
                   "total": {"side": p["tside"], "line": p["tline"], "prob": p["tprob"], "price": p["tprice"]} if p["tside"] else None} for p in picks],
        "yesterday": [{"matchup": p["matchup"], "side": p["side"], "prob": p["prob"], "price": p["price"], "outcome": p["ml_outcome"],
                       "score": f'{p["final_away_score"]}–{p["final_home_score"]}'} for p in yday_picks],
        "record": {"7": dict(rec(graded, 7, "ml_outcome")), "30": dict(rec(graded, 30, "ml_outcome"))},
        "calibration": [{"market": c["market"], "method": c["method"], "version": c["version"], "fitted": c["fitted_at"].date().isoformat()} for c in cal],
    }
    return {"spotlights": spotlights, "specials": specials, "model": model}


async def football_extras(src: Src, key: str, built: dict) -> dict:
    board, games = built["board"], built["games"]
    sport = key
    team_abbr = {}
    for g in games:
        team_abbr[g["away"]["id"]] = g["away"]["abbr"]
        team_abbr[g["home"]["id"]] = g["home"]["abbr"]
    opp_of = {}
    for g in games:
        opp_of[g["away"]["id"]] = g["home"]["id"]
        opp_of[g["home"]["id"]] = g["away"]["id"]
    # run defense: RB rushing yards allowed per game, 2025-26 seasons combined for sample
    rb = await src.q("""select opponent_id, avg((stats->>'rushing.rushingYards')::numeric) ry, avg((stats->>'rushing.rushingTouchdowns')::numeric + coalesce((stats->>'receiving.receivingTouchdowns')::numeric,0)) td, count(*) g
                        from team_game_production where sport=$1 and season = 2026 and pos_group = $2 group by 1""", sport, "RB" if key == "nfl" else "all")
    rbd = {str(r["opponent_id"]): r for r in rb}
    # TD scorers: season TDs, team share
    hist = await src.q("""select athlete_id, team_id, count(*) g,
                                 sum(coalesce((stats->>'rushing.rushingTouchdowns')::numeric,0) + coalesce((stats->>'receiving.receivingTouchdowns')::numeric,0)) td,
                                 max((stats->>'receiving.longReception')::numeric) longrec,
                                 avg((stats->>'receiving.longReception')::numeric) avglong
                          from player_game_history where sport=$1 and season in (2025, 2026) group by 1,2""", sport)
    team_td = defaultdict(float)
    for h in hist:
        team_td[str(h["team_id"])] += float(h["td"] or 0)
    names = {}
    for r in board["rows"]:
        names[r["sid"].split(":")[-1]] = r
    today_teams = set(opp_of)
    td_rows, long_rows = [], []
    lines_by_team = {}
    for g in games:
        sp = (g["lines"].get("spread") or {})
        tot = (g["lines"].get("total") or {}).get("over") or {}
        if tot.get("point") is not None and sp.get("home", {}).get("point") is not None:
            total, hs = tot["point"], sp["home"]["point"]
            lines_by_team[g["home"]["id"]] = round((total - hs) / 2, 1)
            lines_by_team[g["away"]["id"]] = round((total + hs) / 2, 1)
    for h in hist:
        tid = str(h["team_id"])
        if tid not in today_teams:
            continue
        r = names.get(str(h["athlete_id"]))
        if not r:
            continue
        opp = opp_of[tid]
        if h["td"] and h["g"] >= 3:
            td_rows.append({"sid": r["sid"], "name": r["name"], "face": r["face"], "team": team_abbr.get(tid), "opp": team_abbr.get(opp),
                            "tdG": round(float(h["td"]) / h["g"], 2), "share": round(100 * float(h["td"]) / team_td[tid]) if team_td[tid] else None,
                            "implied": lines_by_team.get(tid), "oppTdAllowed": round(float(rbd[opp]["td"]), 2) if opp in rbd and rbd[opp]["td"] is not None else None,
                            "g": h["g"]})
        if h["longrec"] and h["g"] >= 3:
            long_rows.append({"sid": r["sid"], "name": r["name"], "face": r["face"], "team": team_abbr.get(tid), "opp": team_abbr.get(opp),
                              "maxLong": int(h["longrec"]), "avgLong": round(float(h["avglong"]), 1) if h["avglong"] else None, "g": h["g"]})
    composite(td_rows, [("tdG", True), ("share", True), ("implied", True), ("oppTdAllowed", True)])
    composite(long_rows, [("avgLong", True), ("maxLong", True)])
    seen = set()
    td_rows = [r for r in sorted(td_rows, key=lambda r: -(r["score"] or 0)) if not (r["sid"] in seen or seen.add(r["sid"]))]
    seen = set()
    long_rows = [r for r in sorted(long_rows, key=lambda r: -(r["score"] or 0)) if not (r["sid"] in seen or seen.add(r["sid"]))]
    rushers = []
    for r in board["rows"]:
        if r["market"] != "rushing-yards":
            continue
        opp_id = next((o for t, o in opp_of.items() if team_abbr.get(t) == r["team"]), None)
        d = rbd.get(opp_id or "")
        rushers.append({**{k: r.get(k) for k in ("sid", "name", "face", "team", "opp", "line", "l10", "over", "overBook")},
                        "oppAllowed": round(float(d["ry"]), 1) if d else None, "oppG": d["g"] if d else None})
    rushers.sort(key=lambda r: -(r["oppAllowed"] or 0))
    spotlights = spotlight_common(board) + [
        {"id": "run-d", "title": "Rushers vs the worst run defenses",
         "desc": ("Rushing yards allowed to running backs per game this season." if key == "nfl"
                  else "Rushing yards allowed per game this season, by team (CFB holds no position split)."),
         "kind": "rushers", "rows": rushers[:8]},
    ]
    if key == "nfl":
        ttp = await src.q("select team_id, games, payload from team_target_profile where season = 2026 and side = 'defense' and pos_group = 'WR'")
        wr_allowed = {}
        for t in ttp:
            p = json.loads(t["payload"]) if isinstance(t["payload"], str) else t["payload"]
            yds = sum(v[2] for v in (p.get("cells") or {}).values())
            deep = sum(v[2] for k, v in (p.get("cells") or {}).items() if k.startswith("deep"))
            wr_allowed[str(t["team_id"])] = (yds / max(t["games"], 1), deep / max(t["games"], 1), t["games"])
        recv = []
        recv_market = "receiving-yards" if any(r["market"] == "receiving-yards" for r in board["rows"]) else "receptions"
        for r in board["rows"]:
            if r["market"] != recv_market:
                continue
            opp_id = next((o for t, o in opp_of.items() if team_abbr.get(t) == r["team"]), None)
            w = wr_allowed.get(opp_id or "")
            recv.append({**{k: r.get(k) for k in ("sid", "name", "face", "team", "opp", "line", "l10", "over", "overBook")},
                         "oppWrYds": round(w[0], 1) if w else None, "oppDeepYds": round(w[1], 1) if w else None})
        recv.sort(key=lambda r: -(r["oppWrYds"] or 0))
        spotlights.append({"id": "pass-d", "title": "Receivers vs the weakest pass defenses",
                           "desc": "Yards allowed to wide receivers per game, and the deep part of it (air yards 20+), from targets this season.",
                           "kind": "receivers", "rows": recv[:8]})
    specials = [
        {"id": "pick3-td", "title": "Pick-3 anytime TD", "promo": "Pick 3 players to score a TD", "kind": "anytd",
         "rows": td_rows[:10], "receipts": None,
         "notHeld": "Red-zone role is not held."},
        {"id": "longest-rec", "title": "Longest reception", "promo": "Longest reception of the day", "kind": "longrec",
         "rows": long_rows[:10], "receipts": None,
         "notHeld": None if key == "nfl" else "CFB has no target or air-yard data; this ranks on reception history only."},
    ]
    if key == "nfl":
        specials.append({"id": "first-td", "title": "First TD scorer", "promo": "First touchdown scorer", "kind": "firsttd",
                         "rows": sorted(td_rows, key=lambda r: -((r["share"] or 0) * (r["implied"] or 0)))[:10], "receipts": None,
                         "notHeld": "Team first-score rate is not held (no scoring order is stored). Ranked on share of team TDs × implied points."})
    return {"spotlights": spotlights, "specials": specials, "model": None}


async def soccer_extras(src: Src, key: str, built: dict) -> dict:
    board, games = built["board"], built["games"]
    sport = "soccer_epl" if key == "epl" else "soccer_mls"
    team_abbr, opp_of = {}, {}
    for g in games:
        team_abbr[g["away"]["id"]] = g["away"]["abbr"]; team_abbr[g["home"]["id"]] = g["home"]["abbr"]
        opp_of[g["away"]["id"]] = g["home"]["id"]; opp_of[g["home"]["id"]] = g["away"]["id"]
    allowed = {str(r["opponent_id"]): r for r in await src.q(
        """select opponent_id, avg((stats->>'totalShots')::numeric) shots, avg((stats->>'totalGoals')::numeric) goals, count(*) g
           from team_game_production where sport=$1 and season = 2026 and pos_group='all' group by 1""", sport)}
    hist = await src.q("""select athlete_id, team_id, count(*) g, sum((stats->>'totalShots')::numeric) sh, sum((stats->>'shotsOnTarget')::numeric) sot,
                                 sum((stats->>'totalGoals')::numeric) gl, sum(case when stats->>'isStarter' in ('true','1','1.0') then 1 else 0 end) starts
                          from player_game_history where sport=$1 and season in (2025, 2026) group by 1,2""", sport)
    names = {r["sid"].split(":")[-1]: r for r in board["rows"]}
    rows = []
    for h in hist:
        tid = str(h["team_id"])
        if tid not in opp_of or h["g"] < 5:
            continue
        r = names.get(str(h["athlete_id"]))
        if not r:
            continue
        opp = allowed.get(opp_of[tid])
        rows.append({"sid": r["sid"], "name": r["name"], "face": r["face"], "team": team_abbr.get(tid), "opp": team_abbr.get(opp_of[tid]),
                     "shG": round(float(h["sh"] or 0) / h["g"], 2), "sotG": round(float(h["sot"] or 0) / h["g"], 2),
                     "glG": round(float(h["gl"] or 0) / h["g"], 2), "starts": int(h["starts"] or 0), "g": h["g"],
                     "oppShots": round(float(opp["shots"]), 1) if opp else None, "oppGoals": round(float(opp["goals"]), 2) if opp else None})
    composite(rows, [("shG", True), ("sotG", True), ("glG", True), ("oppGoals", True)])
    seen = set()
    rows = [r for r in sorted(rows, key=lambda r: -(r["score"] or 0)) if not (r["sid"] in seen or seen.add(r["sid"]))]
    shots = sorted(rows, key=lambda r: -((r["shG"] or 0) + (r["oppShots"] or 0) / 10))[:8]
    spotlights = spotlight_common(board) + [
        {"id": "shots-d", "title": "Shot takers vs the loosest defenses", "desc": "Shots per game (last two seasons) against shots the opponent allows per game this season.",
         "kind": "soccershots", "rows": shots}]
    specials = [{"id": "anytime-gs", "title": "Anytime goalscorer", "promo": "Anytime goalscorer", "kind": "anygoal", "rows": rows[:10],
                 "receipts": None, "notHeld": "Penalty takers and confirmed lineups are not held. xG is not stored."}]
    return {"spotlights": spotlights, "specials": specials, "model": None}


async def build_tennis(src: Src, key: str, cfg: dict) -> dict:
    snap = await src.app_json(cfg["api"])
    games = []
    for g in snap["context"]["other"].get("games") or []:
        if et_date(g.get("firstPitch")) not in (cfg["date"], (date.fromisoformat(cfg["date"]) + timedelta(days=1)).isoformat()):
            continue
        games.append({"id": str(g["gamePk"]), "start": g.get("firstPitch"), "time": et_time(g.get("firstPitch")), "status": "upcoming",
                      "statusText": et_time(g.get("firstPitch")), "away": {"name": g["awayTeamName"], "abbr": g["awayTeamName"].split()[-1]},
                      "home": {"name": g["homeTeamName"], "abbr": g["homeTeamName"].split()[-1]}, "chips": [], "model": None,
                      "round": g.get("round"), "tournament": g.get("tournament") or g.get("eventName")})
    lines = await game_lines(src, "tennis", [g["id"] for g in games])
    for g in games:
        g["lines"] = lines.get(g["id"]) or {}
    games.sort(key=lambda g: g["start"] or "")
    board = await props_board(src, key, cfg, snap, [g["id"] for g in games], {})
    names = {r["sid"]: {"name": r["name"], "face": r["face"], "team": r["team"]} for r in board["rows"]}
    movers = {"props": await prop_movers(src, [g["id"] for g in games], names), "games": await game_movers(src, games)}
    # TennisMyLife serve stats: what the ranking job will fetch and store (spec §5)
    tml = []
    try:
        url = "https://stats.tennismylife.org/data/2026.csv" if key == "atp" else "https://stats.tennismylife.org/data/2026_wta.csv"
        r = await src.http.get(url)
        import csv, io
        rows = list(csv.DictReader(io.StringIO(r.text)))
        agg = defaultdict(lambda: {"ace": 0, "svpt": 0, "m": 0, "aceAg": 0, "rpt": 0, "last": ""})
        for m in rows:
            for side, other in (("w", "l"), ("l", "w")):
                name = m.get(f"{'winner' if side == 'w' else 'loser'}_name")
                try:
                    a, sv = int(m[f"{side}_ace"]), int(m[f"{side}_svpt"])
                    oa, osv = int(m[f"{other}_ace"]), int(m[f"{other}_svpt"])
                except (KeyError, ValueError):
                    continue
                s = agg[name]
                s["ace"] += a; s["svpt"] += sv; s["m"] += 1; s["aceAg"] += oa; s["rpt"] += osv
                s["last"] = max(s["last"], m.get("tourney_date") or "")
        players = set()
        for g in games:
            players.add(g["away"]["name"]); players.add(g["home"]["name"])
        last_date = max((m.get("tourney_date") or "") for m in rows) if rows else None
        for g in games:
            for me, them in ((g["away"]["name"], g["home"]["name"]), (g["home"]["name"], g["away"]["name"])):
                s, o = agg.get(me), agg.get(them)
                if not s or s["m"] < 5 or not s["svpt"]:
                    continue
                tml.append({"name": me, "opp": them, "aceRate": round(100 * s["ace"] / s["svpt"], 1), "aceM": round(s["ace"] / s["m"], 1),
                            "oppAceAg": round(100 * o["aceAg"] / o["rpt"], 1) if o and o["rpt"] else None, "m": s["m"]})
        composite(tml, [("aceRate", True), ("aceM", True), ("oppAceAg", True)])
        tml.sort(key=lambda r: -(r["score"] or 0))
    except Exception as e:  # the page says the archive could not be read
        last_date = None
        print("tml:", e)
    form = await src.q("""select athlete_id, count(*) filter (where (stats->>'match_won')::numeric = 1) w, count(*) n
                          from (select athlete_id, stats, row_number() over (partition by athlete_id order by game_date desc) rn
                                from player_game_history where sport = $1) x where rn <= 10 group by 1""", f"tennis_{key}")
    form_by = {str(r["athlete_id"]): (r["w"], r["n"]) for r in form}
    form_rows = []
    for s in snap.get("subjects") or []:
        sid = str(s["subjectId"])
        f = form_by.get(sid.split(":")[-1])
        if f and f[1] >= 5 and s.get("subjectName") != "TBD":
            form_rows.append({"sid": sid, "name": s["subjectName"], "opp": (s.get("meta") or {}).get("opponent"), "w": f[0], "n": f[1]})
    form_rows.sort(key=lambda r: -r["w"] / r["n"])
    spotlights = [
        {"id": "form", "title": "Form", "desc": "Match wins in the last 10.", "kind": "form", "rows": form_rows[:8]},
        {"id": "serve", "title": "Serve vs return", "desc": f"Ace rate on serve against the opponent's aces conceded on return, 2026 (archive through {last_date or '—'}).",
         "kind": "serve", "rows": tml[:8]},
    ]
    specials = [{"id": "most-aces", "title": "Most aces", "promo": "Most aces of the day", "kind": "aces", "rows": tml[:10], "receipts": None,
                 "notHeld": f"Serve stats come from the TennisMyLife archive, last match {last_date or 'unknown'}; the ranking job will fetch and store it."}]
    upcoming = sorted(et_date(g.get("firstPitch")) for g in snap["context"]["other"].get("games") or [] if et_date(g.get("firstPitch")) and et_date(g.get("firstPitch")) > cfg["date"])
    return {"games": games, "board": board, "movers": movers, "spotlights": spotlights, "specials": specials, "model": None,
            "nextDate": upcoming[0] if upcoming else None}


async def build_golf(src: Src, cfg: dict) -> dict:
    snap = await src.app_json("golf")
    subjects = snap.get("subjects") or []
    ev = snap.get("eventName"), snap.get("eventDetail")
    board = []
    for s in subjects:
        m = s.get("meta") or {}
        board.append({"sid": str(s["subjectId"]), "name": s["subjectName"], "face": m.get("headshotUrl"), "flag": m.get("flagUrl"),
                      "pos": m.get("position"), "total": m.get("totalScore"), "thru": m.get("thru"), "tee": m.get("teeTime"),
                      "rounds": m.get("rounds") or m.get("roundScores")})
    rounds = await src.q("""select espn_id, round, total_strokes, relative_to_par, wind_mph, temp_f, precip_prob from golf_round_scores
                            where event_id = '401850914' order by espn_id, round""")
    by = defaultdict(dict)
    wx = {}
    for r in rounds:
        by[str(r["espn_id"])][r["round"]] = {"strokes": r["total_strokes"], "par": r["relative_to_par"]}
        if r["wind_mph"] is not None:
            wx.setdefault(r["round"], []).append((r["wind_mph"], r["temp_f"], r["precip_prob"]))
    for b in board:
        rid = b["sid"].split(":")[-1]
        b["rounds"] = by.get(rid) or {}
        pars = [v["par"] for v in b["rounds"].values() if v.get("par") is not None]
        if b.get("total") is None and pars:
            b["total"] = int(sum(pars))
    try:
        lines = await src.app_json("golf/lines")
    except Exception:
        lines = None
    weather = {rnd: {"wind": round(statistics.mean(x[0] for x in v)), "temp": round(statistics.mean(x[1] for x in v if x[1] is not None)) if any(x[1] is not None for x in v) else None,
                     "rain": round(statistics.mean(x[2] for x in v if x[2] is not None)) if any(x[2] is not None for x in v) else None}
               for rnd, v in wx.items()}
    movers_r3 = []
    for b in board:
        r = b["rounds"]
        if 2 in r and 3 in r and r[3].get("strokes"):
            movers_r3.append({**b, "r3": r[3]["strokes"], "r3par": r[3]["par"]})
    movers_r3.sort(key=lambda b: b["r3"])
    low = sorted([b for b in board if b["rounds"]], key=lambda b: statistics.mean(v["strokes"] for v in b["rounds"].values() if v.get("strokes")) if any(v.get("strokes") for v in b["rounds"].values()) else 999)
    return {"event": {"name": ev[0], "detail": ev[1]}, "leaderboard": board, "weather": weather, "lines": lines,
            "spotlights": [{"id": "low-today", "title": "Low rounds today", "desc": "Round 3 scores so far.", "kind": "golflow", "rows": movers_r3[:8]}],
            "specials": [{"id": "low-round", "title": "Low round", "promo": "Round leader / low round", "kind": "golfround",
                          "rows": [{"name": b["name"], "face": b["face"], "avg": round(statistics.mean(v["strokes"] for v in b["rounds"].values() if v.get("strokes")), 2),
                                    "best": min(v["strokes"] for v in b["rounds"].values() if v.get("strokes")), "pos": b["pos"]} for b in low[:10]],
                          "receipts": None, "notHeld": "Strokes gained is not held (it needs a field average per round)."}]}


async def build(src: Src, key: str) -> dict:
    cfg = SPORTS[key]
    base = {"key": key, "label": cfg["label"], "date": cfg.get("date"), "unit": cfg["unit"],
            "builtAt": datetime.now(timezone.utc).isoformat()}
    if cfg.get("offseason"):
        cal = (await src.http.get(f"{ESPN}/{cfg['espn'][0]}/{cfg['espn'][1]}/scoreboard")).json()
        dates = [d for d in ((cal.get("leagues") or [{}])[0].get("calendar") or []) if isinstance(d, str)]
        evs = cal.get("events") or []
        return {**base, "offseason": {"next": dates[0] if dates else None, "firstGames": [
            {"name": e.get("name"), "date": e.get("date"), "time": et_time(e.get("date"))} for e in evs[:6]]}}
    if key == "golf":
        return {**base, **await build_golf(src, cfg)}
    if cfg.get("tennis"):
        t = await build_tennis(src, key, cfg)
        return {**base, **{k: v for k, v in t.items()}}
    built = await build_team_sport(src, key, cfg)
    if key == "mlb":
        extras = await mlb_extras(src, built)
    elif key in ("nfl", "cfb"):
        extras = await football_extras(src, key, built)
    elif key in ("epl", "mls"):
        extras = await soccer_extras(src, key, built)
    else:
        extras = {"spotlights": spotlight_common(built["board"]), "specials": [], "model": None}
    return {**base, "games": built["games"], "board": built["board"], "movers": built["movers"], **extras}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", default="http://localhost:3000")
    ap.add_argument("sports", nargs="*", default=list(SPORTS))
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    src = Src(a.app)
    await src.open()
    try:
        for key in a.sports:
            print(f"[{key}] building…", flush=True)
            data = await build(src, key)
            path = OUT / f"slate-{key}.json"
            path.write_text(json.dumps(data, default=str, separators=(",", ":")), encoding="utf-8")
            print(f"[{key}] {path.stat().st_size // 1024} KB", flush=True)
    finally:
        await src.close()


if __name__ == "__main__":
    asyncio.run(main())
