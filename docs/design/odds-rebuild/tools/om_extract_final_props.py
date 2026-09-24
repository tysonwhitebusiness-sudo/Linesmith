"""Track O mockup data, part 4: the finished game's player props against the box
score -- TOR @ BAL, 2026-09-23 game 2 (22:35 UTC, BAL 4-2, MLB gamePk 824784).
Close per book = the last price each source recorded before first pitch.
Box score from MLB's public stats API. Writes om_final_props_raw.json."""
import os, json, re, sqlite3, sys, unicodedata, urllib.request
sys.path.insert(0, r"C:\Users\occy3\Documents\odds-scraper")
from scraper.entities import canonical_book

SP = os.environ.get("OM_WORK", os.path.dirname(os.path.abspath(__file__)))
GK, START, PK = "g_39fd0a9df1515949b088a734", "2026-09-23 22:35:00", 824784
c = sqlite3.connect("file:C:/Users/occy3/Documents/odds-scraper/data/scraper.db?mode=ro", uri=True)

STAT = {"Hits": "hits", "Total Bases": "total_bases", "TOTAL BASES": "total_bases", "Home Runs": "home_runs",
        "TOTAL HOME RUNS": "home_runs", "Player To Hit A Home Run": "home_runs", "RBIs": "rbis", "Runs": "runs",
        "Walks": "walks", "Singles": "singles", "Doubles": "doubles", "Player Doubles": "doubles",
        "player_batting_triples": "triples", "H+R+RBI": "hrr", "player_batting_runs+rbi": "runs_rbi",
        "Stolen Bases": "stolen_bases", "player_pitching_hits": "p_hits", "player_pitching_basesOnBalls": "p_walks",
        "Outs": "p_outs"}


def norm(n):
    n = unicodedata.normalize("NFD", n or "")
    n = "".join(ch for ch in n if unicodedata.category(ch) != "Mn").lower()
    n = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", n)
    return re.sub(r"[^a-z]", "", n)


# ---- box score
box = json.load(urllib.request.urlopen(urllib.request.Request(
    f"https://statsapi.mlb.com/api/v1/game/{PK}/boxscore", headers={"User-Agent": "Mozilla/5.0"}), timeout=30))
players = {}
for side in ("away", "home"):
    t = box["teams"][side]
    abbr = t["team"].get("abbreviation") or ("TOR" if side == "away" else "BAL")
    for p in t["players"].values():
        b, pi = p.get("stats", {}).get("batting", {}), p.get("stats", {}).get("pitching", {})
        if not b and not pi:
            continue
        name = p["person"]["fullName"]
        players[norm(name)] = {
            "name": name, "id": p["person"]["id"], "team": abbr, "pos": p.get("position", {}).get("abbreviation"),
            "played": bool(b.get("plateAppearances") or pi.get("battersFaced")),
            "res": {"hits": b.get("hits"), "total_bases": b.get("totalBases"), "home_runs": b.get("homeRuns"),
                    "rbis": b.get("rbi"), "runs": b.get("runs"), "walks": b.get("baseOnBalls"),
                    "singles": (b.get("hits") or 0) - (b.get("doubles") or 0) - (b.get("triples") or 0) - (b.get("homeRuns") or 0) if b else None,
                    "doubles": b.get("doubles"), "triples": b.get("triples"), "stolen_bases": b.get("stolenBases"),
                    "hrr": (b.get("hits") or 0) + (b.get("runs") or 0) + (b.get("rbi") or 0) if b else None,
                    "runs_rbi": (b.get("runs") or 0) + (b.get("rbi") or 0) if b else None,
                    "p_hits": pi.get("hits"), "p_walks": pi.get("baseOnBalls"), "p_outs": pi.get("outs")},
            "line": (f"{b.get('hits', 0)}-{b.get('atBats', 0)}" + (f", {b['homeRuns']} HR" if b.get("homeRuns") else "") +
                     (f", {b['rbi']} RBI" if b.get("rbi") else "")) if b else (f"{pi.get('inningsPitched')} IP, {pi.get('hits')} H, {pi.get('earnedRuns')} ER, {pi.get('strikeOuts')} K" if pi else ""),
        }
print(len(players), "players in the box score")

# ---- closing prices
ids = [r[0] for r in c.execute("select external_id from game_links where game_key=?", (GK,))]
q = ",".join("?" * len(ids))
pms = c.execute(f"select external_id, source, stat, min(line), min(coalesce(player_norm, player)) from prop_markets "
                f"where parent_external_id in ({q}) group by external_id, source, stat", ids).fetchall()
close = {}   # (player, mk, line, side, book) -> [price, at, src]
for pm, src, stat, line, player in pms:
    mk = STAT.get(stat)
    if not mk or not player:
        continue
    who = players.get(norm(player))
    if not who:   # priced but never appeared: a did-not-play, kept (the ResultMark shows it)
        who = players[norm(player)] = {"name": " ".join(w.capitalize() for w in player.split()), "id": None, "team": None,
                                       "pos": None, "played": False, "res": {}, "line": "did not play"}
    for side, ln, bk, price, at in c.execute(
            "select o.side, o.line, o.book, o.price, sn.fetched_at from offers o INDEXED BY ix_offers_prop_market_external_id "
            "join snapshots sn on sn.id=o.snapshot_id where o.prop_market_external_id=? and sn.fetched_at < ?", (pm, START)):
        if price is None:
            continue
        ln = ln if ln is not None else line
        if ln is None:
            ln = 0.5 if mk == "home_runs" else None
        if ln is None:
            continue
        side = {"yes": "over", "no": "under"}.get((side or "").lower(), (side or "").lower())
        b = canonical_book(bk)[0] if bk else src
        k = (who["name"], mk, ln, side, b)
        if k not in close or at > close[k][1]:
            close[k] = [price, at[:16], src]
out = [[*k, *v] for k, v in close.items()]
print(len(out), "closing prices")
json.dump({"players": list(players.values()), "close": out}, open(os.path.join(SP, "om_final_props_raw.json"), "w"))
