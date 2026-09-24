"""Track O mockup data, part 2: today's MLB slate (2026-09-24 ET) -- main-line
game prices per book over time, splits, openers, pulls, and pitcher strikeout
props; plus one finished game (2026-09-23 TOR@BAL late) for closing-line research."""
import os, json, re, sqlite3, sys, time
sys.path.insert(0, r"C:\Users\occy3\Documents\odds-scraper")
from scraper.entities import canonical_book

SP = os.environ.get("OM_WORK", os.path.dirname(os.path.abspath(__file__)))  # where the raw extracts go
c = sqlite3.connect("file:C:/Users/occy3/Documents/odds-scraper/data/scraper.db?mode=ro", uri=True)
t0 = time.time()
MK = {"ml": "ml", "sp": "sp", "tot": "tot", "rl": "sp", "spreads": "sp", "totals": "tot", "h2h": "ml"}


def book_of(src, raw):
    if src in ("pinnacle", "kalshi", "polymarket", "draftkings", "fanduel", "betmgm", "betrivers", "underdog", "sleeper"):
        return src
    return canonical_book(raw)[0]


games = c.execute("select game_key, away_name, home_name, start_utc from canon_games where sport='baseball' and league_key='mlb' "
                  "and ((start_utc between '2026-09-24 15:00' and '2026-09-25 09:00') or game_key='g_39fd0a9df1515949b088a734') order by start_utc").fetchall()
out = {"games": []}
for gk, away, home, start in games:
    links = c.execute("select source, external_id, reversed from game_links where game_key=?", (gk,)).fetchall()
    if len(links) < 5:
        continue
    rows = []
    for src, ext, rev in links:
        for m in MK:
            for r in c.execute("select o.source,o.side,o.line,o.book,o.price,o.fair_price,o.depth,sn.fetched_at from offers o INDEXED BY ix_offers_event_market_book join snapshots sn "
                               "on sn.id=o.snapshot_id where o.event_external_id=? and o.source=? and o.market=? and o.prop_market_external_id is null",
                               (ext, src, m)):
                s, side, line, bk, price, fp, depth, at = r
                b = book_of(s, bk)
                if not b or price is None:
                    continue
                d = None
                if s in ("pinnacle", "kalshi", "polymarket", "draftkings") and depth and depth != "null":
                    d = json.loads(depth)
                    d = {k: d[k] for k in ("alt", "limit", "yes_bid", "yes_ask", "volume_24h", "open_interest", "bid", "ask", "liquidity") if k in d}
                rows.append([s, b, MK[m], side, line, price, fp, d, at[:19]])
    ids = [l[1] for l in links]
    q = ",".join("?" * len(ids))
    splits = [list(r) for r in c.execute(f"select at, source, kind, book, market, side, line, pct_bets, pct_money, count, count_total "
                                         f"from splits where event_external_id in ({q}) and prop_market_external_id is null order by id", ids)]
    ref = []
    for i in ids:
        ref += [list(r) for r in c.execute("select at, source, kind, subject, data from reference_data where subject=? or subject like ?", (i, i + "|%"))]
    ev = [list(r) for r in c.execute(f"select at, source, event, reason, market, side, book, line, price, prev_price from offer_events "
                                     f"where at > datetime('now','-30 hours') and prop_market_external_id is null and event_external_id in ({q})", ids)]
    # pitcher strikeouts props
    kprops = []
    for pm, src, stat, line, player in c.execute(
            f"select external_id, source, stat, min(line), min(player) from prop_markets where parent_external_id in ({q}) group by external_id, source, stat", ids).fetchall():
        if not stat or not re.search(r"strikeout|pitcher_k|\bks?\b|so$", stat, re.I) or re.search(r"batter|hitter", stat, re.I):
            continue
        for r in c.execute("select o.side,o.line,o.book,o.price,sn.fetched_at from offers o INDEXED BY ix_offers_prop_market_external_id join snapshots sn on sn.id=o.snapshot_id "
                           "where o.prop_market_external_id=?", (pm,)):
            side, ln, bk, price, at = r
            b = book_of(src, bk)
            if b and price is not None:
                kprops.append([src, b, player, stat, side, ln if ln is not None else line, price, at[:19]])
    out["games"].append({"key": gk, "away": away, "home": home, "start": start, "links": links, "rows": rows,
                         "splits": splits, "ref": ref, "events": ev, "kprops": kprops})
    print(away, "@", home, len(rows), "rows", len(splits), "splits", len(ev), "events", len(kprops), "k", round(time.time() - t0, 1), flush=True)
json.dump(out, open(SP + r"\om_mlb_raw.json", "w"), default=str)
print("done", round(time.time() - t0, 1))
