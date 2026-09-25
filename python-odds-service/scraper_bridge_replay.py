"""The P6 replay test (P6-bridge.md "Tests"): the bridge against a copy of
scraper.db limited to one recorded hour, writing to the live Supabase under
provider `scraper-test:*` with the real game links, then checked and cleaned.

    python scraper_bridge_replay.py [--hours-ago 1.25] [--max-offers 20000] [--keep]
    python scraper_bridge_replay.py --cleanup-only

1. COPY: snapshots fetched in the hour, their offers / offer_events / splits /
   reference_data, the prop markets and events they name, and every
   game_links / canon_games row -> a scratch SQLite. bridge.db -> a scratch
   copy with no cursors, so the run starts at id 0.
2. RUN: `scraper_bridge_run.py --replay-db … --provider-prefix scraper-test
   --from-start --until-idle --no-match --cycle-log …` in its own process.
3. COUNT, independently: this file re-derives what must have been written from
   the copy, cycle by cycle over the bridge's logged read bounds, with its own
   implementation of §4's rule (a change counts once a later ok/unchanged
   snapshot of its endpoint re-reads it, a newer change replaces it, A->B->A
   within 600 s is a flap, a pull drops it). It shares only `map_offer`.
   Asserts, against what is actually in Supabase:
     * prop_odds current rows    == expected current prop keys
     * prop_price_history rows   == expected forwarded changes, row for row,
       including observed_at == the source's own time (D23)
     * game_lines current rows   == expected current game keys
     * scraper_unmatched_prices  == expected unmatched keys
4. UNMATCHED LIFECYCLE (live): an unmatched row is upserted with every field;
   its next change updates it (since moves); a mapped write with the row's key
   deletes it IN THE SAME TRANSACTION (a hook that raises rolls both back).
5. CLEANUP: every scraper-test row in every table the bridge writes; then
   asserts zero remain. Runs even when a check fails (unless --keep).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))
os.environ.setdefault("DB_POOL_MAX_SIZE", "1")
os.environ.setdefault("DB_APPLICATION_NAME", "scraper_bridge_replay")

import db  # noqa: E402
from bridge_state import DEFAULT_PATH as STATE_DB  # noqa: E402
from scraper_bridge import FLAP_WINDOW_SECONDS, Offer, Policy, map_offer, parse_ts, source_rank  # noqa: E402

SCRAPER_DB = r"C:\Users\occy3\Documents\odds-scraper\data\scraper.db"
PREFIX = "scraper-test"
FAILS: list[str] = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + str(detail)) if detail else ''}", flush=True)
    if not cond:
        FAILS.append(name)


def ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# 1. The copy
# ---------------------------------------------------------------------------
def build_copy(path: str, h0: datetime, h1: datetime) -> dict:
    if os.path.exists(path):
        os.remove(path)
    c = sqlite3.connect(f"file:{path}", uri=True)
    c.execute(f"ATTACH DATABASE 'file:{SCRAPER_DB}?mode=ro' AS src")
    for name, sql in c.execute("SELECT name, sql FROM src.sqlite_master WHERE type = 'table' AND sql IS NOT NULL").fetchall():
        c.execute(sql)
    t0 = time.time()

    def step(name):
        c.commit()
        print(f"  copy: {name} ({time.time() - t0:.0f}s)", flush=True)
    mx = c.execute("SELECT max(id) FROM src.snapshots").fetchone()[0]
    s_lo = c.execute("SELECT min(id) FROM src.snapshots WHERE id > ? AND fetched_at >= ?", (mx - 60000, ts(h0))).fetchone()[0]
    s_hi = c.execute("SELECT max(id) FROM src.snapshots WHERE id >= ? AND fetched_at < ?", (s_lo, ts(h1))).fetchone()[0]
    c.execute("INSERT INTO snapshots SELECT * FROM src.snapshots WHERE id BETWEEN ? AND ?", (s_lo, s_hi))
    c.execute("INSERT INTO offers SELECT * FROM src.offers WHERE snapshot_id BETWEEN ? AND ?", (s_lo, s_hi))
    step("snapshots + offers")
    c.execute("INSERT INTO offer_events SELECT * FROM src.offer_events WHERE at >= ? AND at < ? "
              "AND snapshot_id BETWEEN ? AND ?", (ts(h0 - timedelta(minutes=5)), ts(h1 + timedelta(minutes=5)), s_lo, s_hi))
    c.execute("INSERT INTO splits SELECT * FROM src.splits WHERE snapshot_id BETWEEN ? AND ?", (s_lo, s_hi))
    c.execute("INSERT INTO reference_data SELECT * FROM src.reference_data WHERE snapshot_id BETWEEN ? AND ?", (s_lo, s_hi))
    step("offer_events, splits, reference_data")
    c.execute("CREATE TEMP TABLE pm_ids AS SELECT DISTINCT source, prop_market_external_id AS x FROM offers "
              "WHERE prop_market_external_id IS NOT NULL UNION SELECT DISTINCT source, prop_market_external_id FROM "
              "offer_events WHERE prop_market_external_id IS NOT NULL UNION SELECT DISTINCT source, "
              "prop_market_external_id FROM splits WHERE prop_market_external_id IS NOT NULL")
    # INDEXED BY: the planner otherwise drives these through the per-SOURCE index and
    # scans millions of prop markets (measured: > 10 min for one hour's copy).
    # The newest row per id only: comparenbet keeps up to ~21k rows per prop id (one per line and
    # change; measured 2026-09-25), and the bridge reads only the newest.
    c.execute("INSERT INTO prop_markets SELECT p.* FROM src.prop_markets p WHERE p.id IN ("
              "SELECT max(q.id) FROM src.prop_markets q INDEXED BY ix_prop_markets_external_id "
              "WHERE q.external_id IN (SELECT x FROM pm_ids) AND q.source || '|' || q.external_id IN "
              "(SELECT source || '|' || x FROM pm_ids) GROUP BY q.source, q.external_id)")
    step("prop_markets")
    c.execute("CREATE TEMP TABLE ev_ids AS SELECT DISTINCT source, event_external_id AS x FROM offers")
    # the latest row per event only (~300 per event in scraper.db; labels read the latest)
    c.execute("INSERT INTO events SELECT e.* FROM src.events e WHERE e.id IN (SELECT max(e2.id) FROM src.events e2 "
              "INDEXED BY ix_events_external_id WHERE e2.external_id IN (SELECT x FROM ev_ids) GROUP BY e2.source, "
              "e2.external_id)")
    c.execute("INSERT INTO game_links SELECT * FROM src.game_links")
    c.execute("INSERT INTO canon_games SELECT * FROM src.canon_games")
    step("events, game_links, canon_games")
    for sql, in c.execute("SELECT sql FROM src.sqlite_master WHERE type = 'index' AND sql IS NOT NULL").fetchall():
        c.execute(sql)
    step("indexes")
    n = {t: c.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
         for t in ("snapshots", "offers", "offer_events", "splits", "reference_data", "prop_markets")}
    c.execute("DETACH DATABASE src")
    c.close()
    return {"snapshots": [s_lo, s_hi], **n}


def copy_state(path: str) -> None:
    src = sqlite3.connect(STATE_DB, timeout=60)
    dst = sqlite3.connect(path)
    src.backup(dst)
    src.close()
    dst.close()
    from bridge_state import open_state
    dst = open_state(path)                 # the schema the bridge expects, whatever the live file's age
    dst.execute("DELETE FROM cursors")
    dst.execute("DELETE FROM opener_seeded")
    dst.commit()
    dst.close()


# ---------------------------------------------------------------------------
# 3. The independent count
# ---------------------------------------------------------------------------
def expected(copy_path: str, state_path: str, cycle_log: str) -> dict:
    from scraper_bridge_run import Resolver
    policy = Policy.load(os.path.join(HERE, "scraper_bridge_policy.json"))
    sc = sqlite3.connect(copy_path)
    st = sqlite3.connect(state_path)
    res = Resolver(sc, st)
    res.reload_links()
    cycles = [json.loads(line) for line in open(cycle_log, encoding="utf-8")]
    pending: dict = {}       # key -> (value, snap, endpoint, at, mapped)
    fwd: dict = {}
    current: dict = {}       # key -> value (rows that exist in the app's current tables)
    history: list = []       # forwarded prop changes that make a history row
    latest_ok: dict = {}

    def mapped(o, game, miss):
        prop, _ = res.prop(o.source, o.prop_market_external_id)
        player = res.player(o.source, prop, game.app_game_id) if game else None
        return map_offer(o, game=game, game_miss=miss, prop=prop, player=player, policy=policy,
                         provider_prefix=PREFIX)

    for cy in cycles:
        lo, hi = cy["from"], cy["to"]
        rows = sc.execute("SELECT o.id, o.snapshot_id, o.source, s.endpoint, o.event_external_id, "
                          "o.prop_market_external_id, o.market, o.side, o.line, o.book, o.book_key, o.price, "
                          "o.price_alt, o.source_ts_ms, o.depth, s.fetched_at, s.cache_age_s FROM offers o "
                          "JOIN snapshots s ON s.id = o.snapshot_id WHERE o.id > ? AND o.id <= ?",
                          (lo["offers"], hi["offers"])).fetchall()
        offers = [Offer(id=r[0], snapshot_id=r[1], source=r[2], endpoint=r[3], event_external_id=r[4],
                        prop_market_external_id=r[5], market=r[6], side=r[7], line=r[8], book=r[9], book_key=r[10],
                        price=r[11], price_alt=r[12], source_ts_ms=r[13],
                        depth=json.loads(r[14]) if r[14] and r[14] != "null" else None, fetched_at=parse_ts(r[15]),
                        cache_age_s=r[16]) for r in rows]
        res.prime_events({(o.source, o.event_external_id) for o in offers})
        res.prime_props({(o.source, o.prop_market_external_id) for o in offers if o.prop_market_external_id})
        for o in sorted(offers, key=lambda x: (source_rank(x.source), x.id)):
            if o.book_key == "anopen":
                continue
            game, miss = res.game(o.source, o.event_external_id)
            m = mapped(o, game, miss)
            if m.kind == "skip":
                continue
            p = pending.get(m.key)
            if p is not None and fwd.get(m.key) == m.value and (o.fetched_at - p[3]).total_seconds() <= FLAP_WINDOW_SECONDS:
                del pending[m.key]
            elif p is None and fwd.get(m.key) == m.value:
                pass
            else:
                pending[m.key] = (m.value, o.snapshot_id, (o.source, o.endpoint), o.fetched_at, m)
        evs = sc.execute("SELECT snapshot_id, at, source, endpoint, event, event_external_id, prop_market_external_id, "
                         "market, side, book, line, price FROM offer_events WHERE id > ? AND id <= ?",
                         (lo["offer_events"], hi["offer_events"])).fetchall()
        res.prime_events({(e[2], e[5]) for e in evs if e[5]})
        res.prime_props({(e[2], e[6]) for e in evs if e[6]})
        for snap, at, source, endpoint, event, ev, pm, market, side, book, line, price in evs:
            if event != "pulled" or not ev:
                continue
            bk = res.book_key(source, ev, market, book) if book else None
            o = Offer(id=0, snapshot_id=snap or 0, source=source, endpoint=endpoint or "", event_external_id=ev,
                      prop_market_external_id=pm, market=market or "", side=side, line=line, book=book, book_key=bk,
                      price=price if price else 100.0, price_alt=None, source_ts_ms=None, depth=None,
                      fetched_at=parse_ts(at))
            game, miss = res.game(source, ev)
            m = mapped(o, game, miss)
            if m.kind not in ("prop", "game"):
                continue
            pending.pop(m.key, None)
            fwd.pop(m.key, None)
            current.pop(m.key, None)
        for sid, source, endpoint, status in sc.execute(
                "SELECT id, source, endpoint, status FROM snapshots WHERE id > ? AND id <= ?",
                (lo["snapshots"], hi["snapshots"])):
            if status in ("ok", "unchanged"):
                latest_ok[(source, endpoint)] = sid
        for key in list(pending):
            v, snap, ep, at, m = pending[key]
            if latest_ok.get(ep, 0) > snap:
                if m.kind == "prop" and current.get(key) != v:
                    r = m.row
                    history.append((r.provider_id, r.game_id, r.subject_id, r.market_key,
                                    None if r.line is None else round(r.line, 3), r.side, r.bookmaker, v,
                                    r.changed_at))
                fwd[key] = v
                current[key] = v
                del pending[key]
    kinds = Counter(k[0] for k in current)
    return {"prop_current": kinds["p"], "game_current": kinds["g"], "unmatched": kinds["u"], "history": history}


async def actual() -> dict:
    pool = await db.get_pool()
    like = PREFIX + ":%"
    prop_current = await pool.fetchval("SELECT count(*) FROM prop_odds WHERE provider_id LIKE $1", like)
    game_current = await pool.fetchval("SELECT count(*) FROM game_lines WHERE source LIKE $1", like)
    unmatched = await pool.fetchval("SELECT count(*) FROM scraper_unmatched_prices WHERE source LIKE $1", like)
    rows = await pool.fetch(
        """SELECT s.provider_id, g.game_id, sub.subject_id, m.name AS market, h.line, sd.name AS side, b.name AS book,
                  h.price, h.observed_at
             FROM prop_price_history h
             JOIN odds_sources s ON s.id = h.source JOIN odds_games g ON g.id = h.game
             JOIN odds_subjects sub ON sub.id = h.subject JOIN odds_markets m ON m.id = h.market
             JOIN odds_books b ON b.id = h.book JOIN odds_sides sd ON sd.id = h.side
            WHERE s.provider_id LIKE $1""", like)
    history = [(r["provider_id"], r["game_id"], r["subject_id"], r["market"],
                None if r["line"] is None else round(float(r["line"]), 3), r["side"], r["book"], r["price"],
                r["observed_at"]) for r in rows]
    return {"prop_current": prop_current, "game_current": game_current, "unmatched": unmatched, "history": history}


# ---------------------------------------------------------------------------
# 4. The unmatched lifecycle, live
# ---------------------------------------------------------------------------
async def unmatched_lifecycle() -> None:
    print("unmatched lifecycle (live)")
    pool = await db.get_pool()
    src, key = f"{PREFIX}:lifecycle", "lifecycle|ev|pm|rushing_yards|over|DraftKings|74.5"
    t0 = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=10)
    row = db.UnmatchedPriceInput(source=src, scraper_key=key, event="A @ B", market="rushing_yards", player="P Q",
                                 book="draftkings", line=74.5, side="over", price=-110.0, checked=t0, since=t0,
                                 reason="unmatched-player")
    await db.write_scraper_unmatched([row])
    r = await pool.fetchrow("SELECT * FROM scraper_unmatched_prices WHERE source = $1 AND scraper_key = $2", src, key)
    check("upserted with every field", r is not None and (r["event"], r["market"], r["player"], r["book"], r["line"],
          r["side"], r["price"], r["checked"], r["since"], r["reason"]) == ("A @ B", "rushing_yards", "P Q", "draftkings",
          74.5, "over", -110.0, t0, t0, "unmatched-player"), dict(r) if r else None)
    t1 = t0 + timedelta(minutes=2)
    await db.write_scraper_unmatched([db.UnmatchedPriceInput(**{**row.__dict__, "price": -125.0, "checked": t1,
                                                                 "since": t1})])
    t2 = t1 + timedelta(minutes=1)
    await db.write_scraper_unmatched([db.UnmatchedPriceInput(**{**row.__dict__, "price": -125.0, "checked": t2,
                                                                 "since": t2})])
    r = await pool.fetchrow("SELECT price, since, checked FROM scraper_unmatched_prices WHERE source = $1 "
                            "AND scraper_key = $2", src, key)
    check("the next change updates it (since moves with the price, not with a re-reading)",
          (r["price"], r["since"], r["checked"]) == (-125.0, t1, t2), dict(r))

    mapped = db.PropOddsInput(provider_id=src, game_id="lifecycle-game", subject_id="lifecycle-subject",
                              subject_name="P Q", market_key="rushing-yards", line=74.5, side="over",
                              bookmaker="draftkings", american_odds=-125, decimal_odds=1.8, observed_at=t2,
                              changed_at=t1)

    async def boom(conn, rows):
        await db.delete_scraper_unmatched(conn, [(src, key)])
        raise RuntimeError("abort inside the transaction")
    try:
        await db.write_prop_odds([mapped], in_tx=boom)
    except RuntimeError:
        pass
    n_u = await pool.fetchval("SELECT count(*) FROM scraper_unmatched_prices WHERE source = $1", src)
    n_p = await pool.fetchval("SELECT count(*) FROM prop_odds WHERE provider_id = $1", src)
    check("a failing hook rolls BOTH back (unmatched kept, mapped not written)", (n_u, n_p) == (1, 0), (n_u, n_p))

    async def hook(conn, rows):
        await db.delete_scraper_unmatched(conn, [(src, key)])
    await db.write_prop_odds([mapped], in_tx=hook)
    n_u = await pool.fetchval("SELECT count(*) FROM scraper_unmatched_prices WHERE source = $1", src)
    n_p = await pool.fetchval("SELECT count(*) FROM prop_odds WHERE provider_id = $1", src)
    check("once the key maps: unmatched deleted and mapped written together", (n_u, n_p) == (0, 1), (n_u, n_p))


# ---------------------------------------------------------------------------
# 5. Cleanup
# ---------------------------------------------------------------------------
CLEANUP = [
    ("prop_price_history", "source IN (SELECT id FROM odds_sources WHERE provider_id LIKE $1)"),
    ("game_lines_history", "source IN (SELECT id FROM odds_sources WHERE provider_id LIKE $1)"),
    ("prop_odds", "provider_id LIKE $1"),
    ("prop_odds_pulls", "provider_id LIKE $1"),
    ("game_lines", "source LIKE $1"),
    ("game_line_pulls", "source LIKE $1"),
    ("game_odds_book_lines", "source LIKE $1"),
    ("market_splits", "source LIKE $1"),
    ("exchange_books", "contract_id LIKE $1"),
    ("game_reference", "source LIKE $1"),
    ("scraper_checks", "source LIKE $1"),
    ("scraper_unmatched_prices", "source LIKE $1"),
    ("market_openers", "bookmaker LIKE 'scrapertest%' AND $1 = $1"),
    ("odds_sources", "provider_id LIKE $1"),
]


async def cleanup() -> dict:
    pool = await db.get_pool()
    like = PREFIX + ":%"
    out = {}
    for table, where in CLEANUP:
        async with pool.acquire(timeout=30.0) as conn:
            await conn.execute("SET statement_timeout = '120s'")
            res = await conn.execute(f"DELETE FROM {table} WHERE {where}", like)
            await conn.execute("RESET statement_timeout")
        out[table] = int(res.split()[-1])
    left = {}
    for table, where in CLEANUP:
        left[table] = await pool.fetchval(f"SELECT count(*) FROM {table} WHERE {where}", like)
    return {"deleted": out, "left": left}


# ---------------------------------------------------------------------------
async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--hours-ago", type=float, default=1.25, help="the hour starts this long ago")
    ap.add_argument("--max-offers", type=int, default=20000)
    ap.add_argument("--keep", action="store_true", help="leave the scraper-test rows (inspect by hand)")
    ap.add_argument("--cleanup-only", action="store_true")
    ap.add_argument("--reuse-copy", action="store_true", help="keep the last run's hour copy (skips ~200 s)")
    ap.add_argument("--workdir", default=os.path.join(tempfile.gettempdir(), "scraper_bridge_replay"))
    a = ap.parse_args()
    if a.cleanup_only:
        print(json.dumps(await cleanup(), indent=1))
        return 0
    os.makedirs(a.workdir, exist_ok=True)
    copy_path, state_path = os.path.join(a.workdir, "replay.db"), os.path.join(a.workdir, "replay_state.db")
    cycle_log = os.path.join(a.workdir, "cycles.jsonl")
    if os.path.exists(cycle_log):
        os.remove(cycle_log)
    h0 = datetime.now(timezone.utc) - timedelta(hours=a.hours_ago)
    h1 = h0 + timedelta(hours=1)
    t = time.time()
    if a.reuse_copy and os.path.exists(copy_path):
        rc = sqlite3.connect(copy_path)
        lo, hi = rc.execute("SELECT min(fetched_at), max(fetched_at) FROM snapshots").fetchone()
        info = {"reused": True, "offers": rc.execute("SELECT count(*) FROM offers").fetchone()[0]}
        rc.close()
        h0, h1 = parse_ts(lo), parse_ts(hi)
    else:
        info = build_copy(copy_path, h0, h1)
    print(f"hour: {h0:%Y-%m-%d %H:%M} .. {h1:%H:%M} UTC", flush=True)
    copy_state(state_path)
    print(f"copy built in {time.time() - t:.0f}s: {info}", flush=True)
    report = {"hour": [h0.isoformat(), h1.isoformat()], "copy": info}
    try:
        print(f"leftovers from an earlier run: {(await cleanup())['deleted']}", flush=True)
        t = time.time()
        bridge_log = os.path.join(a.workdir, "bridge.log")
        with open(bridge_log, "w", encoding="utf-8") as fh:
            proc = subprocess.run([sys.executable, "-u", os.path.join(HERE, "scraper_bridge_run.py"), "--replay-db",
                                   copy_path, "--state-db", state_path, "--provider-prefix", PREFIX, "--from-start",
                                   "--until-idle", "--no-match", "--max-offers", str(a.max_offers), "--cycle-log",
                                   cycle_log], cwd=HERE, stdout=fh, stderr=subprocess.STDOUT)
        report["run_seconds"] = round(time.time() - t)
        out = open(bridge_log, encoding="utf-8", errors="replace").read()
        proc.stdout = out
        print(out[-6000:], flush=True)
        check("the bridge ran to idle", proc.returncode == 0 and "Traceback" not in out, f"exit {proc.returncode}")
        try:
            status = json.loads(proc.stdout[proc.stdout.rindex("\n{") + 1:])
        except ValueError:
            status = {}
        report["bridge_status"] = status

        print("independent count vs Supabase", flush=True)
        exp = expected(copy_path, state_path, cycle_log)
        act = await actual()
        for k in ("prop_current", "game_current", "unmatched"):
            check(f"{k}: {act[k]} written == {exp[k]} expected", act[k] == exp[k])
        ce, ca = Counter(exp["history"]), Counter(act["history"])
        check(f"prop_price_history: {len(act['history'])} rows == {len(exp['history'])} expected, row for row "
              f"(times included)", ce == ca,
              f"missing {list((ce - ca).elements())[:3]} extra {list((ca - ce).elements())[:3]}")
        report["counts"] = {k: (act[k], exp[k]) for k in ("prop_current", "game_current", "unmatched")}
        report["history_rows"] = (len(act["history"]), len(exp["history"]))
        await unmatched_lifecycle()
    finally:
        if not a.keep:
            c = await cleanup()
            report["cleanup"] = c
            check("cleanup: no scraper-test row left anywhere", not any(c["left"].values()), c["left"])
    report["fails"] = FAILS
    print(json.dumps(report, indent=1, default=str))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
