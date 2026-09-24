"""Track O mockup data, part 3: every rostered player's props for ATL @ GB, for
the game page's props card. Stat names differ per source; STAT_MAP folds them
into one market key (the same job B0's label map does in the app).
Writes om_props_raw.json. Needs espn_nfl_rosters.json in OM_WORK."""
import os, json, re, sqlite3, sys, time, unicodedata
sys.path.insert(0, r"C:\Users\occy3\Documents\odds-scraper")
from scraper.entities import canonical_book

SP = os.environ.get("OM_WORK", os.path.dirname(os.path.abspath(__file__)))
c = sqlite3.connect("file:C:/Users/occy3/Documents/odds-scraper/data/scraper.db?mode=ro", uri=True)
GK = "g_0d6074f4601e5e52ec14497a"

STAT_MAP = {
    "pass_yds": ["Passing Yards", "PassingYards", "passing_yards", "player_pass_yds", "Passing Yds", "Total Passing Yards", "Pass Yards"],
    "pass_tds": ["Passing Touchdowns", "player_pass_tds", "Passing TDs", "passing_tds", "Total Touchdown Passes", "passing_touchdowns",
                 "Pass TDs", "Touchdown Passes", "TouchdownPass"],
    "completions": ["Pass Completions", "Completions", "player_pass_completions", "Passing Completions", "Total Pass Completions", "pass_completions"],
    "pass_att": ["Passing Attempts", "Pass Attempts", "player_pass_attempts", "Total Pass Attempts", "passing_attempts"],
    "ints": ["Interceptions Thrown", "player_pass_interceptions", "Total Interceptions", "interceptions", "Interceptions", "INTs Thrown"],
    "rush_yds": ["Rushing Yards", "RushingYards", "rushing_yards", "player_rush_yds", "Rushing Yds", "Total Rushing Yards", "Rush Yards"],
    "rush_att": ["Rushing Attempts", "Rush Attempts", "player_rush_attempts", "Total Rush Attempts", "rushing_attempts"],
    "rec_yds": ["Receiving Yards", "ReceivingYards", "Reception Yards", "receiving_yards", "player_reception_yds", "Receiving Yds", "Total Receiving Yards"],
    "receptions": ["Receptions", "Total Receptions", "receptions", "player_receptions"],
    "longest_rec": ["Longest Reception", "player_receiving_longestReception", "longest_reception", "Yards of Longest Reception"],
    "anytime_td": ["player_touchdowns", "Anytime TD", "anytime_touchdowns", "touchdowns", "Touchdown", "Touchdowns", "Total Touchdowns", "Rush + Rec TDs"],
    "rush_rec_yds": ["Rush + Rec Yards", "Rushing and Reception Yards", "RushingReceivingYards", "Rushing & Receiving Yards",
                     "Rushing + Receiving Yards", "Rushing + Receiving Yds", "player_rushing+receiving_yards", "rushing_and_receiving_yards"],
    "pass_rush_yds": ["Total Passing + Rushing Yards", "Passing & Rushing Yards", "Passing + Rushing Yards", "player_passing+rushing_yards",
                      "passing_and_rushing_yards", "Pass + Rush Yards"],
    "targets": ["player_receiving_targets", "Targets"],
    "tackles_ast": ["player_tackles_assists", "Tackles + Assists", "tackles_and_assists", "Defensive Tackles (both solo & assists)"],
    "sacks": ["player_defense_sacks", "Sacks", "sacks"],
}
STAT = {s: k for k, v in STAT_MAP.items() for s in v}
DIRECT = ("pinnacle", "kalshi", "polymarket", "draftkings", "fanduel", "betmgm", "betrivers", "underdog", "sleeper")


def norm(n):
    n = unicodedata.normalize("NFD", n or "")
    n = "".join(ch for ch in n if unicodedata.category(ch) != "Mn").lower()
    n = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", n)
    return " ".join(re.sub(r"[^a-z ]", "", n).split())


roster = json.load(open(os.path.join(SP, "espn_nfl_rosters.json")))
rn = {norm(k): k for k in roster}
ids = [r[0] for r in c.execute("select external_id from game_links where game_key=?", (GK,))]
q = ",".join("?" * len(ids))
t0 = time.time()
pms = c.execute(f"select external_id, source, stat, min(line), min(coalesce(player_norm, player)) from prop_markets "
                f"where parent_external_id in ({q}) group by external_id, source, stat", ids).fetchall()
out = {}
for pm, src, stat, line, player in pms:
    mk = STAT.get((stat or "").strip())
    who = rn.get(norm(player))
    if not mk or not who or src == "betmonitor":
        continue
    if mk == "anytime_td" and line not in (None, 0.5):
        continue
    rows = out.setdefault(who, [])
    for side, ln, bk, price, depth, at in c.execute(
            "select o.side, o.line, o.book, o.price, o.depth, sn.fetched_at from offers o INDEXED BY ix_offers_prop_market_external_id "
            "join snapshots sn on sn.id=o.snapshot_id where o.prop_market_external_id=?", (pm,)):
        if price is None:
            continue
        b = src if src in DIRECT else canonical_book(bk)[0]
        d = json.loads(depth) if depth and depth not in ("null",) else None
        if isinstance(d, dict):
            d = {k: d[k] for k in ("alt", "limit", "yes_bid", "yes_ask", "volume_24h", "open_interest", "mult") if k in d}
        else:
            d = None
        rows.append([src, b, (side or "").lower(), 0.5 if mk == "anytime_td" else (ln if ln is not None else line), price, at[:19], d, mk])
print(len(out), "players", sum(len(v) for v in out.values()), "rows", round(time.time() - t0, 1))
json.dump({"players": out, "roster": {k: roster[k] for k in out}}, open(os.path.join(SP, "om_props_raw.json"), "w"))
