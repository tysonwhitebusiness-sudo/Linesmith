"""P7 (T0) — measure, never assume, how late each odds source is.

    python scraper_timing.py --days 3 [--write] [--sports nfl,mlb]

Laptop, read-only on the odds-scraper's scraper.db; linked games only (P3's
bridge.db). Each row's PRICE TIME is the P6 rule (`source_ts_ms`, else
`fetched_at - Age`, else `fetched_at`), taken from `scraper_bridge.map_offer`
so this measures exactly the times the bridge writes.

  A. relay delay — for each first-hand book, every change of its MAIN line;
     for each relay carrying that book on the same (game, period, market,
     side, point), the first time the relay shows the same new price within
     60 min. A relay that never does is a miss. Only keys the relay carries
     at all count (a relay that does not quote a market is not "late" on it).
  B. follow lag — a Pinnacle move is a main-line point move, or a >= 10-cent
     price change whose no-vig probability moves >= 1.5 points. Each other
     book, at its best-timed source, is timed to its first change in the
     SAME direction on that market within 60 min; the other direction is
     not following.
  C. sharp self-consistency — Circa via VSiN against Circa via comparenbet on
     the same price, and 4codds' Novig / ProphetX age at fetch (the only
     bound where no first-hand copy exists).

Proven fast (T0.3) — may serve as the sharp reference: first-hand Pinnacle,
Kalshi, Polymarket; a relay with median <= 120 s, hit rate >= 90%, n >= 30
for that book and sport; Circa via VSiN only by C.

Scope as built (P7 Result): game lines. Pinnacle quotes almost no props in
scraper.db (22 prop rows of 744 in a measured hour), so a props follow lag has
nothing to follow; the relay delay is a property of the relay, not the market.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sqlite3
import statistics
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

FIRST_HAND = ("draftkings", "fanduel", "betmgm", "betrivers", "pinnacle", "kalshi", "polymarket")
SHARP_FIRST_HAND = frozenset({"pinnacle", "kalshi", "polymarket"})
RELAYS = ("comparenbet", "4codds", "steezanomics", "oddstrader", "scoresandodds", "actionnetwork", "theoddsgap",
          "betmonitor", "mbodds")
WINDOW_S = 3600
PROVEN_MEDIAN_S, PROVEN_HIT, PROVEN_N = 120.0, 0.90, 30
MOVE_CENTS, MOVE_NOVIG = 10, 0.015
CIRCA_RATE_MIN = 0.5
REFERENCE_SIDE = {"sp": "home", "ml": "home", "ml3": "home", "tot": "over"}


# ---------------------------------------------------------------------------
# Pure pieces (test_scraper_timing.py)
# ---------------------------------------------------------------------------
def cents(a: int, b: int) -> int:
    """The distance between two American prices in cents: -110 -> -120 is 10;
    +105 -> -105 is 10 (the run from +100 to -100 is zero)."""
    if (a > 0) == (b > 0):
        return abs(a - b)
    return abs(a) - 100 + abs(b) - 100


def implied(american: float) -> float:
    return 100 / (american + 100) if american > 0 else -american / (-american + 100)


def novig(p_side: int | None, p_other: int | None) -> float | None:
    if p_side is None or p_other is None:
        return None
    a, b = implied(p_side), implied(p_other)
    return a / (a + b)


def summarize(values: list[float]) -> dict:
    if not values:
        return {"n": 0, "median_s": None, "p25_s": None, "p75_s": None, "p90_s": None}
    v = sorted(values)

    def q(p):
        k = (len(v) - 1) * p
        lo, hi = math.floor(k), math.ceil(k)
        return v[lo] + (v[hi] - v[lo]) * (k - lo)
    return {"n": len(v), "median_s": round(q(0.5), 1), "p25_s": round(q(0.25), 1), "p75_s": round(q(0.75), 1),
            "p90_s": round(q(0.9), 1)}


def relay_delays(first_hand: list[tuple[datetime, int]], relay: list[tuple[datetime, int]],
                 window: float = WINDOW_S) -> tuple[list[float], int]:
    """Measure A for one (book, key). `first_hand`: the book's own main-line
    changes; `relay`: the relay's rows for the same key, both (time, price),
    time-ordered. -> (delays in s, misses)."""
    delays, misses = [], 0
    for t, p in first_hand:
        hit = next((tr for tr, pr in relay if pr == p and tr >= t and (tr - t).total_seconds() <= window), None)
        if hit is None:
            misses += 1
        else:
            delays.append((hit - t).total_seconds())
    return delays, misses


@dataclass
class State:
    """A book's main line on one (game, period, market) at a moment."""
    t: datetime
    line: float | None                      # the main line id (home-perspective point for spreads)
    prices: dict = field(default_factory=dict)   # side -> American price at the main line


def pinnacle_moves(states: list[State], market: str) -> list[tuple[datetime, int, str]]:
    """Measure B's moves: (time, direction +1/-1, 'point'|'price')."""
    ref = REFERENCE_SIDE.get(market, "over")
    out = []
    for prev, cur in zip(states, states[1:]):
        if cur.line is not None and prev.line is not None and cur.line != prev.line:
            out.append((cur.t, 1 if cur.line > prev.line else -1, "point"))
            continue
        if cur.line != prev.line:
            continue
        a, b = prev.prices.get(ref), cur.prices.get(ref)
        if a is None or b is None or a == b or cents(a, b) < MOVE_CENTS:
            continue
        other = [s for s in cur.prices if s != ref]
        if not other:
            continue
        n0, n1 = novig(a, prev.prices.get(other[0])), novig(b, cur.prices.get(other[0]))
        if n0 is None or n1 is None or abs(n1 - n0) < MOVE_NOVIG:
            continue
        out.append((cur.t, 1 if n1 > n0 else -1, "price"))
    return out


def follow_lag(move: tuple[datetime, int, str], states: list[State], market: str,
               window: float = WINDOW_S) -> float | None:
    """The first change by another book in the SAME direction as a Pinnacle
    move, within the window; a change the other way is not following."""
    t0, direction, kind = move
    ref = REFERENCE_SIDE.get(market, "over")
    prev = None
    for s in states:
        if s.t <= t0:
            prev = s
            continue
        if (s.t - t0).total_seconds() > window:
            return None
        if prev is not None:
            if kind == "point" and s.line is not None and prev.line is not None and s.line != prev.line:
                if (1 if s.line > prev.line else -1) == direction:
                    return (s.t - t0).total_seconds()
            elif kind == "price" and s.line == prev.line:
                a, b = prev.prices.get(ref), s.prices.get(ref)
                if a is not None and b is not None and a != b and (1 if implied(b) > implied(a) else -1) == direction:
                    return (s.t - t0).total_seconds()
        prev = s
    return None


def proven_fast(source: str, book: str, median_s: float | None, hit_rate: float | None, n: int) -> bool:
    """T0.3: first-hand sharp, or a relay fast, reliable and measured enough."""
    if source == book and book in SHARP_FIRST_HAND:
        return True
    if source == book:
        return False
    return (median_s is not None and hit_rate is not None and median_s <= PROVEN_MEDIAN_S
            and hit_rate >= PROVEN_HIT and n >= PROVEN_N)


def circa_proven(median_vsin_minus_cnb_s: float | None, rate_ratio: float | None) -> bool:
    """Circa via VSiN: at most 120 s behind the comparenbet copy (or ahead of
    it), and updating at >= 50% of Pinnacle's rate on the same games."""
    return (median_vsin_minus_cnb_s is not None and rate_ratio is not None
            and median_vsin_minus_cnb_s <= PROVEN_MEDIAN_S and rate_ratio >= CIRCA_RATE_MIN)


# ---------------------------------------------------------------------------
# Loading (scraper.db, bridge.db)
# ---------------------------------------------------------------------------
def generic(sport: str) -> str:
    return "soccer" if sport.startswith("soccer") else "tennis" if sport.startswith("tennis") else sport


def load_game(scraper, game_key: str, game_ref, since: str, policy) -> list:
    """Every game-line row of one canonical game since `since`, mapped by the
    bridge's own map_offer: (source, row: GameLineInput, alt flag, fetched_at)."""
    from scraper_bridge import Offer, map_offer, parse_ts
    out = []
    for src, ext, srev in scraper.execute("SELECT source, external_id, reversed FROM game_links WHERE game_key = ?",
                                          (game_key,)).fetchall():
        g = type(game_ref)(game_ref.app_sport, game_ref.app_game_id, bool(srev) != game_ref.reversed,
                           game_ref.app_start)
        for r in scraper.execute(
                "SELECT o.id, o.snapshot_id, o.source, s.endpoint, o.event_external_id, o.market, o.side, o.line, "
                "o.book, o.book_key, o.price, o.source_ts_ms, o.depth, s.fetched_at, s.cache_age_s "
                "FROM offers o INDEXED BY ix_offers_event_external_id JOIN snapshots s ON s.id = o.snapshot_id "
                "WHERE o.event_external_id = ? AND o.source = ? AND o.prop_market_external_id IS NULL "
                "AND s.fetched_at >= ? ORDER BY o.id", (ext, src, since)):
            depth = None
            if r[12] and r[12] != "null":
                try:
                    depth = json.loads(r[12])
                except ValueError:
                    pass
            o = Offer(id=r[0], snapshot_id=r[1], source=r[2], endpoint=r[3], event_external_id=r[4],
                      prop_market_external_id=None, market=r[5], side=r[6], line=r[7], book=r[8], book_key=r[9],
                      price=r[10], price_alt=None, source_ts_ms=r[11], depth=depth, fetched_at=parse_ts(r[13]),
                      cache_age_s=r[14])
            m = map_offer(o, game=g, game_miss=None, prop=None, player=None, policy=policy)
            if m.kind == "game":
                alt = depth.get("alt") if isinstance(depth, dict) else None
                out.append((o.source, m.row, alt, o.id))
    out.sort(key=lambda x: x[3])
    return out


def timelines(rows: list):
    """-> changes[(source, book, period, market)] = list of (t, side, point, price, is_main)
          states[(source, book, period, market)]  = list[State] after every change."""
    from scraper_bridge import choose_main, line_id
    cur: dict = defaultdict(dict)
    alt: dict = defaultdict(dict)
    changes: dict = defaultdict(list)
    states: dict = defaultdict(list)
    for source, r, alt_flag, _id in rows:
        k = (source, r.bookmaker, r.period, r.market)
        cur[k][(r.side, r.point)] = r.american_odds
        alt[k][(r.side, r.point)] = alt_flag
        flagged = {sp: v for sp, v in cur[k].items() if alt[k].get(sp) is False}
        pool = flagged or {sp: v for sp, v in cur[k].items() if alt[k].get(sp) is not True}
        main = choose_main(pool, r.market) if pool else None
        t = r.changed_at
        is_main = line_id(r.market, r.side, r.point) == main
        changes[k].append((t, r.side, r.point, r.american_odds, is_main))
        prices = {s: v for (s, p), v in cur[k].items() if line_id(r.market, s, p) == main}
        states[k].append(State(t, main, prices))
    return changes, states


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------
def measure(scraper_db: str, state_db: str, days: float, sports: set | None) -> dict:
    from scraper_bridge import GameRef, Policy, parse_ts
    policy = Policy.load(os.path.join(HERE, "scraper_bridge_policy.json"))
    scraper = sqlite3.connect(f"file:{scraper_db}?mode=ro", uri=True, timeout=60)
    state = sqlite3.connect(state_db, timeout=60)
    now = datetime.now(timezone.utc)
    since_dt = now - timedelta(days=days)
    since = since_dt.strftime("%Y-%m-%d %H:%M:%S")
    games = [(k, sp, gid, bool(rev), parse_ts(st)) for k, sp, gid, rev, st in state.execute(
        "SELECT game_key, app_sport, app_game_id, reversed, app_start FROM game_links")]
    games = [g for g in games if g[4] is not None and g[4] >= since_dt - timedelta(days=1)
             and (sports is None or generic(g[1]) in sports)]

    A = defaultdict(lambda: {"delays": [], "misses": 0})          # (sport, relay, book) -> ...
    self_changes = defaultdict(int)                                # (sport, book) -> first-hand changes
    moves_by_game = []                                             # (sport, pin states, all states by (src, book))
    circa = defaultdict(list)                                      # sport -> signed delays (vsin - cnb)
    circa_matched = defaultdict(lambda: [0, 0])
    rates = defaultdict(lambda: [0, 0])                            # sport -> [circa vsin changes, pinnacle changes]
    ages = defaultdict(list)                                       # (sport, book) -> 4codds age at fetch
    t0 = time.time()
    for i, (key, app_sport, gid, rev, start) in enumerate(games):
        rows = load_game(scraper, key, GameRef(app_sport, gid, rev, start), since, policy)
        if not rows:
            continue
        sport = generic(app_sport)
        for source, r, _alt, _id in rows:
            if source == "4codds" and r.bookmaker in ("novig", "prophetx") and r.observed_at and r.changed_at:
                ages[(sport, r.bookmaker)].append((r.observed_at - r.changed_at).total_seconds())
        changes, states = timelines(rows)
        by_key: dict = defaultdict(list)          # (source, book, period, market, side, point) -> [(t, price)]
        for (source, book, period, market), ch in changes.items():
            for t, side, point, price, _m in ch:
                by_key[(source, book, period, market, side, point)].append((t, price))
        # A
        for (source, book, period, market), ch in changes.items():
            if source != book or book not in FIRST_HAND:
                continue
            fh = defaultdict(list)
            for t, side, point, price, is_main in ch:
                if is_main:
                    fh[(side, point)].append((t, price))
                    self_changes[(sport, book)] += 1
            for relay in RELAYS:
                for (side, point), series in fh.items():
                    rs = by_key.get((relay, book, period, market, side, point))
                    if not rs:
                        continue
                    d, miss = relay_delays(series, rs)
                    A[(sport, relay, book)]["delays"] += d
                    A[(sport, relay, book)]["misses"] += miss
        # C: Circa, VSiN vs comparenbet, same key and price, nearest in time
        for (source, book, period, market, side, point), series in by_key.items():
            if source == "vsin" and book == "circa":
                other = by_key.get(("comparenbet", "circa", period, market, side, point)) or []
                for t, p in series:
                    near = [(tr - t).total_seconds() for tr, pr in other
                            if pr == p and abs((tr - t).total_seconds()) <= WINDOW_S]
                    circa_matched[sport][1] += 1
                    if near:
                        circa_matched[sport][0] += 1
                        circa[sport].append(-min(near, key=abs))    # vsin - cnb
        pin_games = {(p, m) for (s, b, p, m) in changes if s == "pinnacle"}
        for (s, b, p, m), ch in changes.items():
            if (p, m) in pin_games:
                if s == "vsin" and b == "circa":
                    rates[sport][0] += sum(1 for c in ch if c[4])
                if s == "pinnacle":
                    rates[sport][1] += sum(1 for c in ch if c[4])
        moves_by_game.append((sport, states))
        if i % 25 == 0:
            print(f"  {i + 1}/{len(games)} games, {time.time() - t0:.0f}s", flush=True)

    # Best-timed source per (sport, book): first-hand if any, else the relay
    # with the lowest A median over all its books in that sport.
    relay_median = {}
    for (sport, relay, book), v in A.items():
        relay_median.setdefault((sport, relay), []).extend(v["delays"])
    relay_median = {k: statistics.median(v) for k, v in relay_median.items() if v}

    B = defaultdict(lambda: {"lags": [], "moves": 0})             # (sport, source, book) -> ...
    for sport, states in moves_by_game:
        pin = {(p, m): st for (s, b, p, m), st in states.items() if s == "pinnacle" and b == "pinnacle"}
        by_book = defaultdict(dict)
        for (s, b, p, m), st in states.items():
            if b != "pinnacle":
                by_book[(b, p, m)][s] = st
        for (b, p, m), per_source in by_book.items():
            if (p, m) not in pin:
                continue
            if b in per_source:
                best = b
            else:
                cands = [s for s in per_source if (sport, s) in relay_median]
                best = min(cands, key=lambda s: relay_median[(sport, s)]) if cands else \
                    max(per_source, key=lambda s: len(per_source[s]))
            st = per_source[best]
            if not st:
                continue
            for mv in pinnacle_moves(pin[(p, m)], m):
                if not (st[0].t <= mv[0]):
                    continue                      # the book was not quoting yet
                B[(sport, best, b)]["moves"] += 1
                lag = follow_lag(mv, st, m)
                if lag is not None:
                    B[(sport, best, b)]["lags"].append(lag)
    return {"A": A, "self": self_changes, "B": B, "circa": circa, "circa_matched": circa_matched, "rates": rates,
            "ages": ages, "window": (since_dt, now), "games": len(games)}


def rows_for(result: dict) -> list[dict]:
    ws, we = result["window"]
    out = []

    def row(sport, measure, source, book, group, n, hit, s, fast):
        out.append({"sport": sport, "measure": measure, "source": source, "book": book, "market_group": group,
                    "n": n, "hit_rate": None if hit is None else round(hit, 3), "median_s": s["median_s"],
                    "p25_s": s["p25_s"], "p75_s": s["p75_s"], "p90_s": s["p90_s"], "proven_fast": fast,
                    "window_start": ws, "window_end": we})
    for (sport, book), n in sorted(result["self"].items()):
        row(sport, "relay_delay", book, book, "game_lines", n, 1.0, summarize([0.0] * n),
            proven_fast(book, book, 0.0, 1.0, n))
    for (sport, relay, book), v in sorted(result["A"].items()):
        n = len(v["delays"]) + v["misses"]
        hit = len(v["delays"]) / n if n else None
        s = summarize(v["delays"])
        row(sport, "relay_delay", relay, book, "game_lines", n, hit, s, proven_fast(relay, book, s["median_s"], hit, n))
    for (sport, source, book), v in sorted(result["B"].items()):
        s = summarize(v["lags"])
        row(sport, "follow_lag", source, book, "game_lines", v["moves"],
            len(v["lags"]) / v["moves"] if v["moves"] else None, s, False)
    for sport, d in sorted(result["circa"].items()):
        s = summarize(d)
        matched, total = result["circa_matched"][sport]
        circa_n, pin_n = result["rates"][sport]
        ratio = circa_n / pin_n if pin_n else None
        row(sport, "sharp_consistency", "vsin", "circa", "game_lines", len(d), matched / total if total else None, s,
            circa_proven(s["median_s"], ratio))
        out[-1]["rate_ratio"] = ratio
    for (sport, book), a in sorted(result["ages"].items()):
        row(sport, "sharp_consistency", "4codds", book, "game_lines", len(a), None, summarize(a), False)
    return out


def print_table(rows: list[dict]) -> None:
    print("\nsport  measure            source        book          n     hit   median  p25    p75    p90   fast")
    for r in rows:
        print(f"{r['sport']:6} {r['measure']:18} {r['source']:13} {r['book']:13} {r['n']:5} "
              f"{'' if r['hit_rate'] is None else format(r['hit_rate'], '.2f'):5} "
              f"{'' if r['median_s'] is None else format(r['median_s'], '.0f'):>7} "
              f"{'' if r['p25_s'] is None else format(r['p25_s'], '.0f'):>6} "
              f"{'' if r['p75_s'] is None else format(r['p75_s'], '.0f'):>6} "
              f"{'' if r['p90_s'] is None else format(r['p90_s'], '.0f'):>6}  {'YES' if r['proven_fast'] else ''}"
              + (f"  rate ratio {r['rate_ratio']:.2f}" if r.get("rate_ratio") is not None else ""))


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--days", type=float, default=3)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--sports", help="comma-separated generic sports (default: all)")
    ap.add_argument("--scraper-db", default=r"C:\Users\occy3\Documents\odds-scraper\data\scraper.db")
    ap.add_argument("--state-db", default=r"C:\Users\occy3\Documents\odds-scraper\data\bridge.db")
    ap.add_argument("--json", help="also write the rows here")
    a = ap.parse_args()
    t = time.time()
    result = measure(a.scraper_db, a.state_db, a.days, set(a.sports.split(",")) if a.sports else None)
    rows = rows_for(result)
    print(f"{result['games']} linked games, {len(rows)} rows, {time.time() - t:.0f}s")
    print_table(rows)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=1, default=str)
    if a.write:
        os.environ.setdefault("DB_POOL_MAX_SIZE", "1")
        import db
        n = await db.write_source_latency([{k: v for k, v in r.items() if k != "rate_ratio"} for r in rows])
        print(f"source_latency: {n} rows written")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
