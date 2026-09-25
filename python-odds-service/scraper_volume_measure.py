"""What would the scraper bridge write to Supabase? (P4 of the odds build, L0.)

    python scraper_volume_measure.py [--since ISO] [--until ISO] [--gap ISO/ISO ...] [--out results.json]

Read-only on the scraper's scraper.db and the bridge's bridge.db (P3's links).
Every offer row in the window is one price CHANGE (the scraper writes on
change), classified on four independent axes:

1. price: bridgeable_book(book_key) (P2); otherwise `non-price`.
2. matched: a game offer whose canonical game is linked and whose market
   parses (game_market); a prop offer whose game is linked, whose player is
   linked and whose label maps (prop_market_key with the roster position).
   Rows of covered-league games the app cannot see yet (P3 links only games
   from now - 6 h, the app loaders' horizon) are `estimated`: counted at the
   sport's measured link rate (P3), and reported separately from `strict`.
3. flap: the scraper counts flaps per poll (snapshots.flaps, same rule as
   FLAP_WINDOW_SECONDS); they are excluded pro rata within each source.
4. time: pre-game if the snapshot is before the canonical game's start.

Source class: first-hand (the ten FIRST_HAND sources), relay-duplicate (an
aggregator row for a book some first-hand source also delivers) or relay-only.

The window defaults to the current UTC day; rows/day are normalised by the
hours the scraper was actually collecting (--gap excludes outages).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from scraper_markets import bridgeable_book, game_market, prop_label_status, prop_market_key  # noqa: E402
from scraper_match import SCRAPER_TO_APP_SPORT  # noqa: E402

SCRAPER_DB = r"C:\Users\occy3\Documents\odds-scraper\data\scraper.db"
STATE_DB = r"C:\Users\occy3\Documents\odds-scraper\data\bridge.db"
FIRST_HAND = frozenset({"pinnacle", "kalshi", "polymarket", "draftkings", "fanduel", "betmgm", "betrivers",
                        "sleeper", "underdog", "vsin"})
SHARP_BOOKS = frozenset({"pinnacle", "circa", "kalshi", "polymarket", "polymarketus", "novig", "prophetx",
                         "betfairexchange", "matchbook", "smarkets"})  # option E: Pinnacle + the exchanges (+Circa)
# P3's measured link rates (2026-09-24, P3-matching.md Result): games = linked / (linked + name misses);
# players = linked share of prop rows. Used only for `estimated` rows.
GAME_LINK_RATE = {"nfl": 1.0, "cfb": 171 / 432, "mlb": 12 / 14, "nba": 1.0, "nhl": 1.0, "soccer_mls": 16 / 24,
                  "soccer_epl": 16 / 24, "tennis_atp": 5 / 12, "tennis_wta": 4 / 7}
PLAYER_LINK_RATE = {"nfl": 0.996, "cfb": 0.894, "mlb": 0.983, "soccer_mls": 0.958, "soccer_epl": 0.958,
                    "tennis_atp": 1.0, "tennis_wta": 0.833, "nhl": 0.0, "nba": 0.9}


# ---------------------------------------------------------------------------
# Pure pieces (tested hermetically in src/test_scraper_volume.py)
# ---------------------------------------------------------------------------
def flap_flags(changes: list[tuple[float, tuple]], window_s: float = 600.0) -> list[bool]:
    """For one key's change sequence [(t, value), ...] in time order: True for
    a change that returns the key to the value it held before the previous
    change, within window_s of that previous change (the scraper's rule)."""
    out = []
    for i, (t, v) in enumerate(changes):
        out.append(i >= 2 and v == changes[i - 2][1] and t - changes[i - 1][0] <= window_s)
    return out


def source_class(source: str, book_key: str | None, first_hand_books: frozenset) -> str:
    if source in FIRST_HAND:
        return "first-hand"
    return "relay-duplicate" if book_key in first_hand_books else "relay-only"


def phase(fetched_at: str | None, start_utc: str | None) -> str:
    """'pre' unless the snapshot is at or after the game's start (same text format)."""
    return "in" if (fetched_at and start_utc and fetched_at >= start_utc) else "pre"


# ---------------------------------------------------------------------------
# The measurement
# ---------------------------------------------------------------------------
def _ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _read_rows(sc: sqlite3.Connection, lo: int, hi: int) -> list[tuple]:
    """Group the window's offers by (source, book, kind, game_key, market, stat,
    player, phase) with row and distinct-key counts. Offers are read by an id
    range scan and each prop market is looked up once through a temp table and
    the external_id index (a per-row correlated lookup made the first version
    take over an hour on one day)."""
    first = sc.execute("SELECT min(id) FROM offers WHERE snapshot_id = (SELECT min(snapshot_id) FROM offers WHERE snapshot_id >= ?)", (lo,)).fetchone()
    last = sc.execute("SELECT max(id) FROM offers WHERE snapshot_id = (SELECT max(snapshot_id) FROM offers WHERE snapshot_id <= ?)", (hi,)).fetchone()
    if not first or not last or first[0] is None or last[0] is None:
        return []
    snap_at = dict(sc.execute("SELECT id, fetched_at FROM snapshots WHERE id BETWEEN ? AND ?", (lo, hi)))
    offers = sc.execute(
        "SELECT source, book_key, event_external_id, prop_market_external_id, market, side, book, line, snapshot_id "
        "FROM offers WHERE id BETWEEN ? AND ? AND snapshot_id BETWEEN ? AND ?", (first[0], last[0], lo, hi)).fetchall()
    want = {(o[0], o[3]) for o in offers if o[3] is not None}
    sc.execute("CREATE TEMP TABLE IF NOT EXISTS want_pm (source TEXT, external_id TEXT)")
    sc.execute("DELETE FROM want_pm")
    sc.executemany("INSERT INTO want_pm VALUES (?, ?)", list(want))
    pm = {}
    for src, ext, parent, stat, player in sc.execute(
            "SELECT w.source, w.external_id, p.parent_external_id, p.stat, p.player_norm FROM want_pm w "
            "JOIN prop_markets p ON p.external_id = w.external_id AND p.source = w.source ORDER BY p.id"):
        pm[(src, ext)] = (parent, stat, player)          # the newest version wins
    links = {(src, ext): key for src, ext, key in sc.execute("SELECT source, external_id, game_key FROM game_links")}
    starts = {k: st for k, st in sc.execute("SELECT game_key, start_utc FROM canon_games")}
    groups: dict = defaultdict(int)
    group_keys: dict = defaultdict(set)
    for source, book_key, event, pmx, market, side, book, line, snap in offers:
        if pmx is None:
            kind, stat, player = "g", None, None
            game_key = links.get((source, event))
        else:
            kind = "p"
            parent, stat, player = pm.get((source, pmx), (None, None, None))
            game_key = links.get((source, parent)) if parent else None
        ph = phase(snap_at.get(snap), starts.get(game_key)) if game_key else "pre"
        g = (source, book_key, kind, game_key, market, stat, player, ph)
        groups[g] += 1
        group_keys[g].add(hash((source, event, pmx, market, side, book, line)))
    return [(*g, n, len(group_keys[g])) for g, n in groups.items()]


def measure(scraper_db: str, state_db: str, since: datetime, until: datetime) -> dict:
    sc = sqlite3.connect(f"file:{scraper_db}?mode=ro", uri=True, timeout=60)
    st = sqlite3.connect(f"file:{state_db}?mode=ro", uri=True, timeout=60)
    lo, hi = sc.execute("SELECT min(id), max(id) FROM snapshots WHERE fetched_at >= ? AND fetched_at < ?",
                        (_ts(since), _ts(until))).fetchone()
    flaps = dict(sc.execute("SELECT source, COALESCE(sum(flaps), 0) FROM snapshots WHERE id BETWEEN ? AND ? GROUP BY source",
                            (lo, hi)).fetchall())
    canon = {k: (s, l) for k, s, l in sc.execute("SELECT game_key, sport, league_key FROM canon_games")}
    glinks = {k: gid for k, gid in st.execute("SELECT game_key, app_game_id FROM game_links")}
    plinks = {(s, p, g): pos for s, p, g, pos in st.execute("SELECT source, player_norm, app_game_id, position FROM player_links")}
    rows = _read_rows(sc, lo, hi)
    first_hand_books = frozenset(b for src, b, *_ in rows if src in FIRST_HAND and b)
    reconcile = dict(sc.execute("SELECT source, count(*) FROM offers WHERE snapshot_id BETWEEN ? AND ? GROUP BY source",
                                (lo, hi)).fetchall())
    sc.close()
    st.close()

    per_source = defaultdict(int)
    for r in rows:
        per_source[r[0]] += r[8]
    flap_rate = {s: min(1.0, flaps.get(s, 0) / n) for s, n in per_source.items() if n}

    # tally[(kind, cls, phase, match, sport)] = rows (de-flapped, weighted); keys likewise
    tally = defaultdict(float)
    keys = defaultdict(float)
    by_book = defaultdict(float)   # (kind, cls, book, source, phase) -> matched de-flapped rows
    totals = defaultdict(float)
    for source, book, kind, game_key, market, stat, player, ph, n, nkeys in rows:
        totals["rows"] += n
        f = n * flap_rate.get(source, 0.0)
        totals["flaps"] += f
        live = n - f
        if not bridgeable_book(book):
            totals["non-price"] += live
            continue
        sl = canon.get(game_key) if game_key else None
        app = SCRAPER_TO_APP_SPORT.get(sl) if sl else None
        if game_key is None:
            match, weight = "unmatched-no-game", 0.0
        elif app is None:
            match, weight = "no-app-sport", 0.0
        elif kind == "g":
            if not game_market(market or ""):
                match, weight = "unmatched-market", 0.0
            elif game_key in glinks:
                match, weight = "strict", 1.0
            else:
                match, weight = "estimated", GAME_LINK_RATE.get(app, 0.0)
        else:
            status = prop_label_status(source, stat or "")
            if status not in ("mapped", "position"):
                match, weight = "unmatched-market", 0.0
            elif game_key in glinks:
                pos = plinks.get((source, player, glinks[game_key]), "missing")
                if pos == "missing":
                    match, weight = "unmatched-player", 0.0
                elif prop_market_key(source, stat or "", pos) is None:
                    match, weight = "unmatched-market", 0.0
                else:
                    match, weight = "strict", 1.0
            else:
                match, weight = "estimated", GAME_LINK_RATE.get(app, 0.0) * PLAYER_LINK_RATE.get(app, 0.0)
        cls = source_class(source, book, first_hand_books)
        sharp = book in SHARP_BOOKS
        tally[(kind, cls, ph, match, app or "-", sharp)] += live * weight if match in ("strict", "estimated") else live
        if match in ("strict", "estimated"):
            by_book[(kind, cls, book, source, ph)] += live * weight
            keys[(kind, cls)] += nkeys * weight
            totals["unmatched-weight"] += live * (1 - weight)   # estimated rows that would not link
        else:
            totals[match] += live
    return {"snapshot_ids": [lo, hi], "rows": rows, "tally": tally, "keys": keys, "totals": totals, "by_book": by_book,
            "per_source": dict(per_source), "reconcile": reconcile, "flaps": flaps, "first_hand_books": sorted(first_hand_books)}


async def db_sizes() -> dict:
    import db

    pool = await db.get_pool()
    out = {"db_bytes": await pool.fetchval("SELECT pg_database_size(current_database())")}
    for t in ("game_odds_history", "prop_odds"):
        r = await pool.fetchrow("SELECT pg_total_relation_size($1::regclass) AS b, "
                                "(SELECT reltuples FROM pg_class WHERE oid = $1::regclass) AS n", t)
        out[t] = {"bytes": int(r["b"]), "rows": float(r["n"]), "bytes_per_row": round(r["b"] / max(r["n"], 1), 1)}
    # P5: prop history is the compact, partitioned prop_price_history (it was
    # prop_odds_history, 345 B/row, when P4 ran this). Summed over partitions.
    import price_history as ph
    async with pool.acquire() as conn:
        z = await ph.table_size(conn, ph.PROP_TABLE)
    out["prop_history"] = {"bytes": z["bytes"], "rows": float(z["rows"]),
                           "bytes_per_row": round(z["bytes"] / max(z["rows"], 1), 1)}
    return out


def project(tally: dict, keys: dict, hours: float, sizes: dict, cap_gb: float = 8.0) -> dict:
    per_day = 24.0 / hours
    B_PROP = sizes["prop_history"]["bytes_per_row"]
    B_GAME = sizes["game_odds_history"]["bytes_per_row"]
    B_CUR = sizes["prop_odds"]["bytes_per_row"]

    def rows_per_day(pred, kind):
        return sum(v for (k, cls, ph, m, app, sharp), v in tally.items()
                   if k == kind and m in ("strict", "estimated") and pred(cls, ph, sharp)) * per_day

    opts = {
        "A": lambda c, p, s: True,
        "B": lambda c, p, s: c != "relay-duplicate",
        "D": lambda c, p, s: c != "relay-duplicate" and p == "pre",
        "E": lambda c, p, s: c != "relay-duplicate" and (p == "pre" or s),
    }
    db_gb = sizes["db_bytes"] / 1e9
    out = {}
    for name, pred in opts.items():
        pr, gr = rows_per_day(pred, "p"), rows_per_day(pred, "g")
        hist_gb = (pr * B_PROP + gr * B_GAME) * 10 / 1e9
        cur_keys = sum(v for (k, cls), v in keys.items() if name == "A" or cls != "relay-duplicate")
        cur_gb = cur_keys * B_CUR / 1e9
        out[name] = {"prop_rows_day": round(pr), "game_rows_day": round(gr), "history_gb_10d": round(hist_gb, 2),
                     "current_state_gb": round(cur_gb, 2)}
    # C: B, but relay-only history keeps 3 days
    rel_p = rows_per_day(lambda c, p, s: c == "relay-only", "p")
    rel_g = rows_per_day(lambda c, p, s: c == "relay-only", "g")
    b = out["B"]
    c_hist = b["history_gb_10d"] - (rel_p * B_PROP + rel_g * B_GAME) * 7 / 1e9
    out["C"] = {**b, "history_gb_10d": round(c_hist, 2)}
    for name, o in out.items():
        added = o["history_gb_10d"] + o["current_state_gb"]
        daily = (o["prop_rows_day"] * B_PROP + o["game_rows_day"] * B_GAME) / 1e9
        o["db_after_gb"] = round(db_gb + added, 2)
        o["headroom_gb"] = round(cap_gb - db_gb - added, 2)
        o["days_to_cap"] = None if o["headroom_gb"] >= 0 else round((cap_gb - db_gb - o["current_state_gb"]) / daily, 1) if daily else None
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    now = datetime.now(timezone.utc)
    ap.add_argument("--since", default=now.strftime("%Y-%m-%dT00:00:00+00:00"))
    ap.add_argument("--until", default=now.isoformat())
    ap.add_argument("--gap", action="append", default=[], help="START/END (ISO) of an outage to exclude from the hours")
    ap.add_argument("--out")
    a = ap.parse_args()
    since, until = datetime.fromisoformat(a.since), datetime.fromisoformat(a.until)
    gaps = [tuple(datetime.fromisoformat(x) for x in g.split("/")) for g in a.gap]
    hours = (until - since).total_seconds() / 3600 - sum((e - s).total_seconds() / 3600 for s, e in gaps)
    t0 = datetime.now(timezone.utc)
    m = measure(SCRAPER_DB, STATE_DB, since, until)
    sizes = asyncio.run(db_sizes())
    proj = project(m["tally"], m["keys"], hours, sizes)
    # Two measured variants beyond the spec's A-E:
    #  B1 = B with ONE relay per relay-only book (the relay carrying most of that book's rows);
    #  F  = first-hand sources only.
    per_day_f = 24.0 / hours
    bp, bg = sizes["prop_history"]["bytes_per_row"], sizes["game_odds_history"]["bytes_per_row"]
    relay = defaultdict(lambda: defaultdict(float))
    fh = defaultdict(float)
    for (k, cls, book, src, ph), v in m["by_book"].items():
        if cls == "relay-only":
            relay[(k, book)][src] += v
        elif cls == "first-hand":
            fh[k] += v
    b1 = {"p": fh["p"], "g": fh["g"]}
    relay_sources = defaultdict(int)
    for (k, book), srcs in relay.items():
        b1[k] += max(srcs.values())
        relay_sources[len(srcs)] += 1
    db_gb = sizes["db_bytes"] / 1e9
    cur = proj["B"]["current_state_gb"]
    for name, pr, gr in (("B1", b1["p"], b1["g"]), ("F", fh["p"], fh["g"])):
        pr, gr = pr * per_day_f, gr * per_day_f
        hist = (pr * bp + gr * bg) * 10 / 1e9
        proj[name] = {"prop_rows_day": round(pr), "game_rows_day": round(gr), "history_gb_10d": round(hist, 2),
                      "current_state_gb": cur, "db_after_gb": round(db_gb + hist + cur, 2),
                      "headroom_gb": round(8.0 - db_gb - hist - cur, 2),
                      "gb_per_day": round((pr * bp + gr * bg) / 1e9, 3)}
    top_relays = sorted(((k, b, sum(s.values()) * per_day_f, len(s)) for (k, b), s in relay.items()), key=lambda x: -x[2])[:15]
    per_day = 24.0 / hours
    classes = defaultdict(float)
    for (k, cls, ph, match, app, sharp), v in m["tally"].items():
        classes[f"{'prop' if k == 'p' else 'game'}|{cls}|{ph}|{match}"] += v * per_day
    sports = defaultdict(float)
    for (k, cls, ph, match, app, sharp), v in m["tally"].items():
        if match in ("strict", "estimated"):
            sports[app] += v * per_day
    recon_ok = m["per_source"] == m["reconcile"]
    res = {"window": [a.since, a.until], "gaps": a.gap, "active_hours": round(hours, 2),
           "seconds": round((datetime.now(timezone.utc) - t0).total_seconds(), 1),
           "offer_rows": int(m["totals"]["rows"]), "rows_per_day": round(m["totals"]["rows"] * per_day),
           "flaps_per_day": round(m["totals"]["flaps"] * per_day),
           "non_price_per_day": round(m["totals"]["non-price"] * per_day),
           "unmatched_per_day": {k: round(m["totals"][k] * per_day) for k in
                                 ("unmatched-no-game", "no-app-sport", "unmatched-market", "unmatched-player", "unmatched-weight")},
           "classes_per_day": {k: round(v) for k, v in sorted(classes.items())},
           "matched_per_day_by_sport": {k: round(v) for k, v in sorted(sports.items(), key=lambda x: -x[1])},
           "db": sizes, "options": proj, "reconciled": recon_ok,
           "reconcile_diff": {s: (m["per_source"].get(s), m["reconcile"].get(s)) for s in set(m["reconcile"]) | set(m["per_source"])
                              if m["per_source"].get(s) != m["reconcile"].get(s)},
           "first_hand_books": m["first_hand_books"],
           "relay_only_books_by_relay_count": dict(relay_sources),
           "top_relay_only_books_per_day": [[k, b, round(v), n] for k, b, v, n in top_relays]}
    print(json.dumps(res, indent=1, default=str))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=1, default=str)


if __name__ == "__main__":
    main()
