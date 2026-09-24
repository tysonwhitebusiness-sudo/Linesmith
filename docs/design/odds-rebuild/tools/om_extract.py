"""Track O mockup data: a frozen snapshot of real scraper rows for ATL@GB (TNF
2026-09-24) -- game lines, Drake London props, splits, openers, ladders.
Writes om_raw.json (normalised rows) for om_build.py to shape."""
import os, json, re, sqlite3, sys, time
sys.path.insert(0, r"C:\Users\occy3\Documents\odds-scraper")
from scraper.entities import canonical_book

SP = os.environ.get("OM_WORK", os.path.dirname(os.path.abspath(__file__)))  # where the raw extracts go
c = sqlite3.connect("file:C:/Users/occy3/Documents/odds-scraper/data/scraper.db?mode=ro", uri=True)
GK = "g_0d6074f4601e5e52ec14497a"
links = c.execute("select source, external_id, reversed from game_links where game_key=?", (GK,)).fetchall()
ids = sorted({l[1] for l in links})
t0 = time.time()

GAME_MKTS = {
    "ml": "fg_ml", "sp": "fg_sp", "tot": "fg_tot",
    "1h_ml": "1h_ml", "1h_h2h": "1h_ml", "p1_ml": "1h_ml",
    "1h_sp": "1h_sp", "1h_spreads": "1h_sp", "p1_sp": "1h_sp",
    "1h_tot": "1h_tot", "1h_totals": "1h_tot", "p1_tot": "1h_tot",
    "tt_home": "tt_home", "tt_away": "tt_away",
    "1q_sp": "1q_sp", "1q_spreads": "1q_sp", "1q_tot": "1q_tot", "1q_totals": "1q_tot",
    "1q_ml": "1q_ml", "1q_h2h": "1q_ml",
}
# sources that only carry their own ladder of alt lines (not a main line)
LADDER_SRC = {"betmgm", "betrivers", "kalshi", "polymarket"}


def book_of(src, raw):
    if src == "pinnacle":
        return "pinnacle"
    if src in ("kalshi", "polymarket", "draftkings", "fanduel", "betmgm", "betrivers", "underdog", "sleeper"):
        return src
    k, _ = canonical_book(raw)
    return k


def rows_for(where, args, ix="ix_offers_event_market_book"):
    q = ("select o.id, o.source, o.market, o.side, o.line, o.book, o.price, o.fair_price, o.fair_point, o.depth, "
         "o.prop_market_external_id, sn.fetched_at from offers o INDEXED BY " + ix + " join snapshots sn on sn.id=o.snapshot_id where " + where)
    return c.execute(q, args).fetchall()


out = {"game": {}, "links": links}
g = c.execute("select * from canon_games where game_key=?", (GK,)).fetchone()
out["game"] = {"key": g[0], "home": g[3], "away": g[4], "start": g[5]}

# ---- game lines
game_rows = []
for src, ext, rev in links:
    for m in GAME_MKTS:
        for r in rows_for("o.event_external_id=? and o.source=? and o.market=? and o.prop_market_external_id is null", (ext, src, m)):
            _id, s, mk, side, line, bk, price, fp, fpt, depth, _pm, at = r
            b = book_of(s, bk)
            if not b or price is None:
                continue
            d = json.loads(depth) if depth and depth != "null" else None
            game_rows.append([_id, s, b, GAME_MKTS[mk], side, line, price, fp, fpt, d, at[:19]])
out["game_rows"] = game_rows
print("game rows", len(game_rows), round(time.time() - t0, 1), flush=True)

# latest confirming snapshot per (source) -- 'checked' time
chk = {}
for src in {l[0] for l in links}:
    r = c.execute("select max(fetched_at) from snapshots where source=? and status='ok'", (src,)).fetchone()
    chk[src] = r[0][:19] if r and r[0] else None
out["checked"] = chk

# ---- pulled events for this game (last 36 h)
pulled = []
q = ",".join("?" * len(ids))
for r in c.execute(f"select at, source, event, reason, market, side, book, line, price, prev_price, prop_market_external_id "
                   f"from offer_events where at > datetime('now','-36 hours') and event_external_id in ({q})", ids):
    pulled.append([r[0][:19], *r[1:]])
out["offer_events"] = pulled
print("offer_events", len(pulled), round(time.time() - t0, 1), flush=True)

# ---- splits + reference
out["splits"] = [list(r) for r in c.execute(
    f"select at, source, kind, book, market, side, line, pct_bets, pct_money, count, count_total, popularity, "
    f"prop_market_external_id, detail from splits where event_external_id in ({q}) order by id", ids)]
subj = [f"{i}|%" for i in ids if i.startswith("vsin")]
ref = []
for s in subj:
    ref += [list(r) for r in c.execute("select at, source, kind, subject, data from reference_data where subject like ?", (s,))]
for i in ids:
    ref += [list(r) for r in c.execute("select at, source, kind, subject, data from reference_data where subject=? or subject like ?", (i, i + "|%"))]
ref += [list(r) for r in c.execute("select at, source, kind, subject, data from reference_data where kind='nfl_power_rating' and subject in ('Atlanta Falcons','Green Bay Packers')")]
ref += [list(r) for r in c.execute("select at, source, kind, subject, data from reference_data where kind='nfl_referee' order by id desc limit 40")]
out["reference"] = ref
print("splits", len(out["splits"]), "ref", len(ref), flush=True)

# ---- Drake London props (+ a second player for the props table)
PROP_MKTS = [
    ("rec_yds", re.compile(r"^(player_reception_yds|receiving ?yards|receivingyards|reception yards|receiving yds|total receiving yards|receiving_yards)$", re.I)),
    ("receptions", re.compile(r"^(player_receptions|receptions|total receptions)$", re.I)),
    ("longest_rec", re.compile(r"^(player_receiving_longestReception|longest reception|longest_reception|yards of longest reception)$", re.I)),
    ("anytime_td", re.compile(r"^(player_touchdowns|anytime td|touchdowns|total touchdowns|anytime_touchdowns|touchdown|rush \+ rec tds)$", re.I)),
    ("targets", re.compile(r"^(player_receiving_targets|targets)$", re.I)),
    ("rush_rec_yds", re.compile(r"^(player_rushing\+receiving_yards|rush \+ rec yards|rushing_and_receiving_yards)$", re.I)),
]


def prop_mkt(stat):
    for k, rx in PROP_MKTS:
        if stat and rx.match(stat.strip()):
            return k
    return None


props = {}
for who in ("drake london", "bijan robinson", "josh jacobs", "jordan love", "michael penix"):
    pms = c.execute(f"select external_id, source, stat, min(line), min(player) from prop_markets where parent_external_id in ({q}) "
                    f"and lower(coalesce(player_norm, player)) like ? group by external_id, source, stat", ids + [f"%{who}%"]).fetchall()
    prow = []
    stats = {}
    for pm, src, stat, line, player in pms:
        mk = prop_mkt(stat)
        stats[(src, stat)] = mk
        if not mk:
            continue
        for r in rows_for("o.prop_market_external_id=?", (pm,), "ix_offers_prop_market_external_id"):
            _id, s, _mk, side, ln, bk, price, fp, fpt, depth, _pm, at = r
            b = book_of(s, bk)
            if not b or price is None:
                continue
            d = json.loads(depth) if depth and depth != "null" else None
            prow.append([_id, s, b, mk, side, ln if ln is not None else line, price, fp, fpt, d, at[:19], pm])
    props[who] = {"rows": prow, "stats": [[k[0], k[1], v] for k, v in stats.items()]}
    print(who, len(pms), "markets", len(prow), "rows", round(time.time() - t0, 1), flush=True)
out["props"] = props

json.dump(out, open(SP + r"\om_raw.json", "w"), default=str)
print("done", round(time.time() - t0, 1))
