"""Current quotes, history, openers, moves and steam for one market -- the
state the Track O components render. Shared by om_build.py."""
import collections, datetime as dt

LADDER = {"kalshi", "polymarket", "betmgm", "betrivers"}   # direct feeds that carry a ladder, not a main line
RELAY_PRI = ["comparenbet", "theoddsgap", "actionnetwork", "4codds", "scoresandodds", "steezanomics", "mbodds",
             "oddstrader", "vsin", "betmonitor", "livesportsodds"]
NOT_A_BOOK = {"comparenbet_fair", "anconsensus", "anopen", "4c", "4cx", "3et", "sharpbookc", "sharpag", "apex",
              "vertex", "amapola", "buckeye", "pph", "playersfantasy", "hard", "predictfun"}
used_books = set()


def ts(s):
    return dt.datetime.fromisoformat(s[:19]).replace(tzinfo=dt.timezone.utc)


def dec(a):
    return 1 + (a / 100 if a > 0 else 100 / -a)


def prob(a):
    return 1 / dec(a)


def _d(r):
    return r[6] if isinstance(r[6], dict) else {}


def _alive(rows_last, evk, keep):
    out = {}
    for k, r in rows_last.items():
        if not keep(k):
            continue
        evs = sorted(e for e in evk.get(k, []) if e[0] >= r[5])
        if evs and evs[-1][1] == "pulled":
            continue
        out[k] = r
    return out


SIDES = [None]


def _far(line, center, side=None):
    """a variant line relayed under the main key: far from the consensus, or a
    spread on the wrong side of it (a BAL +1.5 run line when the market is -1.5)."""
    if center is None or line is None or center == 0:
        return False
    sides = SIDES[0]
    spread = sides == ("home", "away")
    v = line if not spread or side in (None, sides[0]) else -line
    if spread and abs(center) >= 1 and v * center < 0:
        return True
    return abs(v - center) > max(3.0, abs(center) * 0.25)


def _series(rows, sides, center):
    """main-line pairs over time from one source's change rows -> [t, lineA, pA, pB, lineB]."""
    a, b = sides
    state, series = {}, []
    for r in sorted(rows, key=lambda r: r[5]):
        if _d(r).get("alt") is True or _far(r[3], center, r[2]):
            continue
        state[r[2]] = (r[3], r[4])
        if a in state and b in state:
            la, pa = state[a]
            lb, pb = state[b]
            if la is not None and lb is not None and abs(abs(la) - abs(lb)) > 0.01:
                continue
            pt = [r[5][:16], la, round(pa), round(pb), lb]
            if not series or series[-1][1:] != pt[1:]:
                if series and series[-1][0] == pt[0]:
                    series[-1] = pt
                else:
                    series.append(pt)
    return series


def market_state(rows, events, now, checked, sides):
    """rows: [src, book, side, line, price, t, depth]."""
    SIDES[0] = tuple(sides)
    evk = collections.defaultdict(list)
    for t, src, kind, book, side, line in events:
        evk[(src, book, side, line)].append((t, kind))
    last = {}
    by_src_book = collections.defaultdict(list)
    for r in rows:
        src, book, side, line, price, t, depth = r
        if book in NOT_A_BOOK or book is None:
            continue
        k = (src, book, side, line)
        if k not in last or t >= last[k][5]:
            last[k] = r
        by_src_book[(src, book)].append(r)
    srcs = collections.defaultdict(set)
    for (src, book) in by_src_book:
        srcs[book].add(src)

    def fresh(p, lim):
        return checked.get(p) and (now - ts(checked[p])).total_seconds() < lim

    newest = {}
    for (src, book, side, line), r in last.items():
        if side == sides[0] and line is not None and src not in LADDER and not _d(r).get("alt"):
            if book not in newest or r[5] > newest[book][5]:
                newest[book] = r
    ls = sorted(r[3] for r in newest.values())
    center = ls[len(ls) // 2] if ls else None

    def main_source(book):
        s = srcs[book]
        if book in s and book not in LADDER and fresh(book, 1800):
            return book
        for p in RELAY_PRI:
            if p in s and fresh(p, 3600):
                return p
        return book if book in s else sorted(s)[0]

    cur, hist, opens, moves = [], {}, {}, []
    for book in srcs:
        p = main_source(book)
        live = _alive(last, evk, lambda k: k[0] == p and k[1] == book)
        live = {k: r for k, r in live.items() if (now - ts(r[5])).total_seconds() < 30 * 3600}
        pairs = collections.defaultdict(dict)
        for (src, b, side, line), r in live.items():
            if p not in LADDER and (_d(r).get("alt") is True or _far(line, center, side)):
                continue
            pairs[abs(line) if line is not None else None][side] = r
        full = [v for v in pairs.values() if len(v) == 2]
        main = {}
        if p in LADDER:
            if full:
                main = min(full, key=lambda v: abs(prob(v[sides[0]][4]) - 0.5))
        else:
            cands = full or list(pairs.values())
            if cands:
                main = max(cands, key=lambda v: max(r[5] for r in v.values()))

        def emit(r, src, kind):
            d = _d(r)
            x = {k: d[k] for k in ("limit", "yes_bid", "yes_ask", "yes_bid_size", "yes_ask_size", "volume_24h",
                                   "open_interest", "bid", "ask", "bid_size", "ask_size", "liquidity",
                                   "yes_bids", "no_bids", "bids", "asks", "fantasy", "mult", "last") if k in d and d[k] is not None}
            a2 = int((now - ts(checked[src])).total_seconds()) if checked.get(src) else None
            cur.append([book, r[2], r[3], round(r[4], 2), r[5][:16], src, a2, kind, x or None])

        for r in main.values():
            emit(r, p, "main")
        mains = set(id(r) for r in main.values())
        for src in srcs[book]:
            if src in LADDER or src in ("pinnacle", "draftkings", "sleeper", "underdog"):
                for k, r in _alive(last, evk, lambda k: k[0] == src and k[1] == book).items():
                    if (now - ts(r[5])).total_seconds() > 30 * 3600 or id(r) in mains:
                        continue
                    emit(r, src, "alt")
        if not any(c[0] == book for c in cur):
            continue
        used_books.add(book)
        series = _series(by_src_book[(p, book)], sides, center) if p not in LADDER else []
        for rp in RELAY_PRI:
            if rp != p and (rp, book) in by_src_book:
                older = _series(by_src_book[(rp, book)], sides, center)
                if series:
                    older = [x for x in older if x[0] < series[0][0]]
                series = older + series
                break
        firsts = [(_series(by_src_book[(src, book)], sides, center) or [None])[0] for src in srcs[book] if src not in LADDER]
        firsts = [f for f in firsts if f]
        if firsts:
            opens[book] = min(firsts, key=lambda x: x[0])
        if series:
            hist[book] = series[-300:]
            for i in range(1, len(series)):
                if series[i][1] != series[i - 1][1]:
                    moves.append([series[i][0], book, series[i - 1][1], series[i][1]])
    moves.sort()
    clusters = []
    for m in moves:
        d = 1 if (m[3] or 0) > (m[2] or 0) else -1
        for c in clusters:
            if c["dir"] == d and (ts(m[0]) - ts(c["t"])).total_seconds() <= 2700 and m[1] not in c["books"]:
                c["books"].append(m[1]); c["times"].append(m[0]); c["to"].append(m[3])
                break
        else:
            clusters.append({"t": m[0], "dir": d, "books": [m[1]], "times": [m[0]], "from": m[2], "to": [m[3]]})
    steam = [c for c in clusters if len(c["books"]) >= 3]
    return {"cur": cur, "hist": hist, "open": opens, "moves": moves[-250:], "steam": steam[-15:], "center": center}
