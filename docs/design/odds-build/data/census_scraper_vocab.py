"""Read-only vocabulary census of the scraper DB for the P2 spec."""
import json, sqlite3, sys, time

OUT = sys.argv[1] if len(sys.argv) > 1 else "vocab.json"
c = sqlite3.connect("file:C:/Users/occy3/Documents/odds-scraper/data/scraper.db?mode=ro", uri=True)
t = time.time()
# The two hours before the newest snapshot (the 2026-09-24 census used 15:38-17:38 UTC).
last = c.execute("select max(fetched_at) from snapshots").fetchone()[0]
start = c.execute("select datetime(?, '-2 hours')", (last,)).fetchone()[0]
lo = c.execute("select min(id) from snapshots where fetched_at >= ?", (start,)).fetchone()[0]
hi = c.execute("select max(id) from snapshots").fetchone()[0]
out = {"snap_range": [lo, hi]}
out["game_markets"] = c.execute(
    "select source, market, count(*) from offers where snapshot_id between ? and ? "
    "and prop_market_external_id is null group by 1, 2 order by 3 desc", (lo, hi)).fetchall()
print("game markets", time.time() - t, flush=True)
out["prop_offer_markets"] = c.execute(
    "select source, market, count(*) from offers where snapshot_id between ? and ? "
    "and prop_market_external_id is not null group by 1, 2 order by 3 desc", (lo, hi)).fetchall()
print("prop offer markets", time.time() - t, flush=True)
out["book_keys"] = c.execute(
    "select source, book, book_key, count(*) from offers where snapshot_id between ? and ? group by 1, 2, 3 order by 4 desc",
    (lo, hi)).fetchall()
print("books", time.time() - t, flush=True)
day0 = c.execute("select date(?)", (last,)).fetchone()[0]
pm_lo = c.execute("select min(id) from prop_markets where first_seen_at >= ?", (day0,)).fetchone()[0]
out["prop_stats"] = c.execute(
    "select source, stat, count(*) from prop_markets where id >= ? group by 1, 2 order by 3 desc", (pm_lo,)).fetchall()
print("stats", time.time() - t, flush=True)
out["unresolved"] = c.execute("select kind, source, raw_value, count from unresolved order by count desc limit 400").fetchall()
json.dump(out, open(OUT, "w"), default=str)
print("done", time.time() - t)
