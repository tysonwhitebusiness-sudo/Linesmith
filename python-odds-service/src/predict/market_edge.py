"""P11 (E1): the market edge — a sharp book's fair price against a soft book's.

No model. The fair price is a sharp reference's two-sided price with the vig
removed; the edge is how far a soft book's price sits from it. It is shown only
where EVERY gate passes (docs/design/odds-build/P11-edge.md, "The 11 gates"),
and every gate is its own function below so a failure names exactly one rule.

`evaluate()` is pure: it takes markets already read and returns one
`EdgeResult` per (market, side, soft book) with each gate's verdict. `run()`
reads Supabase, evaluates, and writes `market_edges` (what may be shown now),
`market_edge_log` (every edge from the moment it first passes until a gate
first fails) and the `edge_auto_off` flag. TypeScript only renders
`market_edges`; it never computes an edge (O6, tests/scan-no-edge.test.ts).

ONE DEVIATION FROM THE SPEC, measured rather than assumed. Gate 6 says "the
minimum across `devig_two_way`, `devig_power`, `devig_shin` and
`devig_worst_case`". Worst case is not an estimate of the fair price: it puts
the whole margin on the other side, so its fair probability sits BELOW the
sharp book's own raw price on that side, and a soft book can only clear it by
beating the sharp book outright. Both edges the spec requires to reproduce
fail it: GB -4.5 at BetMGM -105 vs Pinnacle -113/+102 is +1.0% multiplicative
and -1.4% worst case; London receptions over at +110 vs Pinnacle -103/-117 is
+1.8% and -3.2%. So the minimum is taken over the three point estimates
(multiplicative, power, Shin), and worst case is logged beside it in
`reference.ev_by_method` for the P13 review to weigh.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from predict.odds_math import american_to_decimal, devig_by

# --------------------------------------------------------------------------- constants (the spec's numbers)

GATE_METHODS = ("multiplicative", "power", "shin")     # gate 6's minimum
LOGGED_METHODS = GATE_METHODS + ("worst_case",)        # logged, not gating (see module docstring)

GAME_LIMIT_FLOOR = 500            # gate 1: Pinnacle extra.limit on game lines
PROP_AGREE_PTS = 0.030            # gate 1: second source within 3.0 pts
EXCHANGE_MAX_SPREAD = 0.04        # gate 1: bid-ask <= 4 cents (prices in dollars)
EXCHANGE_MIN_DEPTH = 1000.0       # gate 1: volume_24h or liquidity >= $1,000
SHARP_MAX_CHECKED_S = 20 * 60     # gate 2: sharp checked <= 20 min
SOFT_MAX_CHECKED_S = 3 * 60       # gate 2: soft checked <= 3 min
RELAY_EXTRA_S = 2 * 60            # gate 2: relay limit = its median + 2 min
RELAY_CHANGE_WINDOW_S = 60 * 60   # gate 2: the relay changed that book on the game within 60 min
FAST_SHARP_MOVE_PTS = 0.015       # gate 2: Kalshi/Polymarket moved <= 1.5 pts since the sharp time
ASSUMED_CDN_AGE_S = 15 * 60       # gate 2: D13's bound on a Pinnacle CDN copy when no Age was recorded
CORROBORATE_S = 3 * 60            # gate 3: another copy checked <= 3 min
CORROBORATE_DEC = 0.05            # gates 3 + 7: 5 cents, decimal
COPIES_CHECKED_WITHIN_S = 2 * 60  # gate 7
PREGAME_MARGIN_S = 60             # gate 5
EV_CAP = 0.08                     # gate 8
OUTLIER_LOW, OUTLIER_HIGH, OUTLIER_MIN_BOOKS = 0.6, 1.6, 5   # gate 8 (D19)
SELF_CHECK_MIN_EVALUATED = 20     # gate 9
SELF_CHECK_EV = 0.05
SELF_CHECK_SHARE = 0.05
SELF_CHECK_CLEAR_RUNS = 3

SHARP_BOOKS = frozenset({"pinnacle", "circa"})
EXCHANGES = frozenset({"kalshi", "polymarket"})
RELAYED_SHARPS = frozenset({"novig", "prophetx"})
# Never a soft book: a price here is a reference, not something to beat.
REFERENCE_BOOKS = SHARP_BOOKS | EXCHANGES | RELAYED_SHARPS | frozenset({"polymarketus"})
NON_PRICE_BOOKS = frozenset({"comparenbet_fair", "anconsensus", "anopen"})

# F6 (lib/odds/sourcePrecedence.ts FIRST_HAND_SOURCES): a source that IS the book.
FIRST_HAND_SOURCES: dict[str, frozenset[str]] = {
    "scraper:draftkings": frozenset({"draftkings"}),
    "scraper:fanduel": frozenset({"fanduel"}),
    "scraper:betmgm": frozenset({"betmgm"}),
    "scraper:betrivers": frozenset({"betrivers"}),
    "scraper:pinnacle": frozenset({"pinnacle"}),
    "scraper:kalshi": frozenset({"kalshi"}),
    "scraper:polymarket": frozenset({"polymarket", "polymarketus"}),
    "scraper:sleeper": frozenset({"sleeper"}),
    "scraper:underdog": frozenset({"underdog"}),
    "scraper:vsin": frozenset({"circa", "westgate", "southpoint", "wynn", "stations", "boomers", "betmgmnv", "caesarsnv"}),
}
# Paid feeds are not relays in P7's sense (it measured scraper relays only);
# their soft quotes take the plain 3-minute rule.
PAID_FEEDS = frozenset({"propline", "sharpapi", "parlayapi", "oddsapiio", "sportsgameodds", "the-odds-api", "espn"})


def is_first_hand(provider: str, book: str) -> bool:
    return book in FIRST_HAND_SOURCES.get(provider, frozenset())


def is_relay(provider: str, book: str) -> bool:
    return provider.startswith("scraper:") and not is_first_hand(provider, book)


def source_name(provider: str) -> str:
    return provider.split(":", 1)[1] if provider.startswith("scraper:") else provider


# --------------------------------------------------------------------------- inputs

@dataclass
class Quote:
    book: str
    provider: str
    side: str
    american: int
    checked_at: datetime                 # max(fetched_at, scraper_checks.last_ok_at)
    since: datetime | None               # changed_at; None = unknown (fails gate 2)
    extra: dict = field(default_factory=dict)
    pulled: bool = False                 # an open prop_odds_pulls / game_line_pulls row
    price_asof: datetime | None = None   # D13: the confirming poll's price copy time (scraper_checks.price_asof)
    history: list[tuple[datetime, int]] = field(default_factory=list)   # (observed_at, american), oldest first

    @property
    def decimal(self) -> float:
        return american_to_decimal(self.american)


@dataclass
class Market:
    kind: str                            # 'prop' | 'game'
    sport: str
    game_id: str
    market: str
    line: float | None                   # a spread's line is the HOME point
    sides: tuple[str, str]
    start: datetime | None
    quotes: list[Quote]
    subject_id: str = ""
    period: str = "fg"
    subject_name: str = ""


@dataclass
class Latency:
    """source_latency, plus the relay activity gate 2's "since, not checked" rule needs."""
    fast: set = field(default_factory=set)                   # {(sport, source, book)} proven_fast
    relay_median_s: dict = field(default_factory=dict)       # {(sport, source, book[, market_group]): median_s}
    relay_last_change: dict = field(default_factory=dict)    # {(provider, book, game_id): datetime}

    def proven_fast(self, sport: str, provider: str, book: str) -> bool:
        return (sport, source_name(provider), book) in self.fast

    def relay_median(self, sport: str, provider: str, book: str, kind: str) -> float | None:
        src, grp = source_name(provider), "props" if kind == "prop" else "game_lines"
        for k in ((sport, src, book, grp), (sport, src, book, "all"), (sport, src, book)):
            if self.relay_median_s.get(k) is not None:
                return self.relay_median_s[k]
        return None


@dataclass
class Gate:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Reference:
    fair: dict[str, dict[str, float]]    # method -> {side: prob}
    sharp_pair: dict[str, Quote]         # side -> quote (the price-time anchor)
    price_time: datetime
    price_time_basis: str
    second: dict | None
    label: str                           # 'pinnacle' | 'circa' | 'exchange_pair'

    def as_json(self) -> dict:
        a, b = self.sharp_pair.values()
        return {
            "source": self.label,
            "book": a.book, "provider": a.provider,
            "prices": {q.side: q.american for q in (a, b)},
            "limit": min(_limit(a) or 0, _limit(b) or 0) or None,
            "checked_at": _iso(min(a.checked_at, b.checked_at)),
            "since": _iso(_max_since(a, b)),
            "price_time": _iso(self.price_time), "price_time_basis": self.price_time_basis,
            "fair_by_method": {m: {s: round(p, 5) for s, p in v.items()} for m, v in self.fair.items()},
            "second": self.second,
        }


@dataclass
class EdgeResult:
    market: Market
    side: str
    gates: list[Gate]
    soft: Quote | None = None
    reference: Reference | None = None
    fair: float | None = None
    ev: float | None = None
    edge_pts: float | None = None
    method: str | None = None
    ev_by_method: dict = field(default_factory=dict)
    single_source: bool = True

    @property
    def passed(self) -> bool:
        return all(g.ok for g in self.gates)

    def passes_through(self, last_gate: int) -> bool:
        """Gates 1..last_gate all pass (gate 9's self-check reads gates 1-8)."""
        return all(g.ok for g in self.gates if _gate_no(g.name) <= last_gate)

    @property
    def first_failure(self) -> str | None:
        return next((g.name for g in self.gates if not g.ok), None)

    def key(self) -> tuple:
        m = self.market
        return (m.kind, m.game_id, m.subject_id, m.period, m.market, self.side, m.line, self.soft.book if self.soft else "")


# --------------------------------------------------------------------------- helpers

def _iso(t: datetime | None) -> str | None:
    return t.isoformat() if t else None


def _limit(q: Quote) -> float | None:
    v = (q.extra or {}).get("limit")
    return float(v) if isinstance(v, (int, float)) else None


def _max_since(a: Quote, b: Quote) -> datetime | None:
    return max(a.since, b.since) if a.since and b.since else None


def _gate_no(name: str) -> int:
    return int(name.split("_", 1)[0][1:])


def _pair(quotes: list[Quote], book: str, sides: tuple[str, str], provider_ok) -> dict[str, Quote] | None:
    """The book's two-sided price at this line from one provider (the F6-preferred provider that has both)."""
    by_provider: dict[str, dict[str, Quote]] = {}
    for q in quotes:
        if q.book == book and q.side in sides and provider_ok(q):
            by_provider.setdefault(q.provider, {})[q.side] = q
    full = [p for p in by_provider.values() if len(p) == 2]
    if not full:
        return None
    return max(full, key=lambda p: (is_first_hand(next(iter(p.values())).provider, book),
                                    min(q.checked_at for q in p.values())))


def _fair(pair: dict[str, Quote], sides: tuple[str, str], methods=LOGGED_METHODS) -> dict[str, dict[str, float]] | None:
    a, b = pair[sides[0]], pair[sides[1]]
    out = {}
    for m in methods:
        r = devig_by(m, a.decimal, b.decimal)
        if r is None:
            return None
        out[m] = {sides[0]: r[0], sides[1]: r[1]}
    return out


def price_time(q: Quote) -> tuple[datetime, str]:
    """D13, exact: the latest moment our copy of the sharp price is known true.

    1. `price_asof` — the latest confirming poll's price copy time (fetch less
       the CDN Age of the request that carried the prices; the bridge writes
       it to `scraper_checks.price_asof`), or the row's own since if later.
       Pinnacle's copies measured median 636 s old (p90 856 s), so this is
       usually ~10 minutes before the fetch, and it is the real number.
    2. A header on the row (`extra.last_modified` / `extra.cache_age_s`).
    3. A first-hand source with no CDN (Circa via VSiN): its check time.
    4. Nothing recorded (a bridge not yet on the new code): the latest of the
       row's own since and D13's bound (checked - 15 min). This is the ONLY
       place the 15-minute assumption survives.
    """
    if q.price_asof is not None:
        t = max(q.price_asof, q.since) if q.since else q.price_asof
        return min(t, q.checked_at), "copy_age"
    ex = q.extra or {}
    lm = ex.get("last_modified")
    if lm:
        try:
            t = datetime.fromisoformat(str(lm).replace("Z", "+00:00"))
            return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)), "last_modified"
        except ValueError:
            pass
    age = ex.get("cache_age_s")
    if isinstance(age, (int, float)) and age >= 0:
        return q.checked_at - timedelta(seconds=age), "cache_age"
    if is_first_hand(q.provider, q.book) and q.book != "pinnacle":
        return q.checked_at, "checked"            # a first-hand non-CDN source (Circa via VSiN)
    bound = q.checked_at - timedelta(seconds=ASSUMED_CDN_AGE_S)
    if q.since and q.since > bound:
        return q.since, "since"
    return bound, "assumed_max_cdn_age"


def price_at(q: Quote, t: datetime) -> int | None:
    """The quote's price as it stood at `t`: its last history row at or before
    t, else the current price if it has not changed since t."""
    before = [p for at, p in q.history if at <= t]
    if before:
        return before[-1]
    if q.since is not None and q.since <= t:
        return q.american
    return None


def moved_since(q: Quote, t: datetime) -> bool:
    if q.since is None or q.since > t:
        return True
    return any(at > t for at, _ in q.history)


def _exchange_ok(pair: dict[str, Quote]) -> tuple[bool, str]:
    """Gate 1: an exchange counts only with a tight, liquid book."""
    spreads, depth = [], []
    for q in pair.values():
        ex = q.extra or {}
        for bid, ask in (("yes_bid", "yes_ask"), ("bid", "ask")):
            if isinstance(ex.get(bid), (int, float)) and isinstance(ex.get(ask), (int, float)):
                spreads.append(ex[ask] - ex[bid])
        for k in ("volume_24h", "liquidity"):
            if isinstance(ex.get(k), (int, float)):
                depth.append(float(ex[k]))
    if not spreads:
        return False, "no bid/ask recorded"
    if min(spreads) > EXCHANGE_MAX_SPREAD + 1e-9:
        return False, f"spread {min(spreads) * 100:.0f}c > 4c"
    if not depth or max(depth) < EXCHANGE_MIN_DEPTH:
        return False, f"depth ${max(depth) if depth else 0:,.0f} < $1,000"
    return True, ""


# --------------------------------------------------------------------------- gate 1: reference

def _second_sources(m: Market, lat: Latency) -> list[tuple[str, dict[str, Quote], dict]]:
    """Kalshi, Polymarket (first-hand, with a tight liquid book), Novig and
    ProphetX (relayed; only when P7 proved that relay fast)."""
    out = []
    for book in sorted(EXCHANGES | RELAYED_SHARPS | {"polymarketus"}):
        def ok(q, book=book):
            if book in EXCHANGES or book == "polymarketus":
                return is_first_hand(q.provider, book) or lat.proven_fast(m.sport, q.provider, book)
            return lat.proven_fast(m.sport, q.provider, book)
        pair = _pair(m.quotes, book, m.sides, ok)
        if not pair:
            continue
        if book in EXCHANGES or book == "polymarketus":
            good, _ = _exchange_ok(pair)
            if not good:
                continue
        fair = _fair(pair, m.sides, ("multiplicative",))
        if fair:
            out.append((book, pair, fair["multiplicative"]))
    return out


def gate_reference(m: Market, lat: Latency) -> tuple[Gate, Reference | None]:
    name = "g1_reference"

    def sharp_ok(book):
        return lambda q: is_first_hand(q.provider, book) or lat.proven_fast(m.sport, q.provider, book)

    pin = _pair(m.quotes, "pinnacle", m.sides, sharp_ok("pinnacle"))
    if m.kind == "game":
        if pin:
            lim = min(_limit(q) or 0 for q in pin.values())
            if lim >= GAME_LIMIT_FLOOR:
                return Gate(name, True, f"pinnacle limit ${lim:,.0f}"), _reference(m, pin, "pinnacle", None)
            circa_fallback = f"pinnacle limit ${lim:,.0f} < ${GAME_LIMIT_FLOOR}"
        else:
            circa_fallback = "no pinnacle two-sided at this line"
        circa = _pair(m.quotes, "circa", m.sides,
                      lambda q: q.provider == "scraper:vsin" and lat.proven_fast(m.sport, q.provider, "circa"))
        if circa:
            return Gate(name, True, "circa via vsin (proven fast)"), _reference(m, circa, "circa", None)
        return Gate(name, False, circa_fallback), None

    seconds = _second_sources(m, lat)
    if pin:
        fair = _fair(pin, m.sides, ("multiplicative",))
        if fair:
            p = fair["multiplicative"][m.sides[0]]
            for book, pair, f2 in seconds:
                if abs(f2[m.sides[0]] - p) <= PROP_AGREE_PTS + 1e-9:
                    second = {"book": book, "provider": next(iter(pair.values())).provider,
                              "fair": round(f2[m.sides[0]], 5), "side": m.sides[0]}
                    return Gate(name, True, f"pinnacle + {book} agree"), _reference(m, pin, "pinnacle", second)
            return Gate(name, False, "pinnacle with no agreeing second source"), None
    for i in range(len(seconds)):
        for j in range(i + 1, len(seconds)):
            (b1, p1, f1), (b2, p2, f2) = seconds[i], seconds[j]
            if abs(f1[m.sides[0]] - f2[m.sides[0]]) <= PROP_AGREE_PTS + 1e-9:
                ref = _reference(m, p1, "exchange_pair", {"book": b2, "provider": next(iter(p2.values())).provider,
                                                          "fair": round(f2[m.sides[0]], 5), "side": m.sides[0]},
                                 floor_pair=p2)
                return Gate(name, True, f"{b1} + {b2} agree"), ref
    return Gate(name, False, "no pinnacle two-sided at this line and no two agreeing sharp sources"), None


def _reference(m: Market, pair: dict[str, Quote], label: str, second: dict | None, floor_pair=None) -> Reference | None:
    fair = _fair(pair, m.sides)
    if fair is None:
        return None
    if floor_pair:   # two non-Pinnacle sources: each side's fair is the lower of the two (conservative)
        other = _fair(floor_pair, m.sides)
        if other is None:
            return None
        fair = {k: {s: min(fair[k][s], other[k][s]) for s in m.sides} for k in fair}
    times = [price_time(q) for q in pair.values()]
    t, basis = min(times, key=lambda x: x[0])
    return Reference(fair=fair, sharp_pair=pair, price_time=t, price_time_basis=basis, second=second, label=label)


# --------------------------------------------------------------------------- gates 2-8

def gate_time(m: Market, side: str, soft: Quote, ref: Reference, lat: Latency, now: datetime,
              fast_pairs: dict | None = None) -> Gate:
    """D13, exactly: the soft price as it stood at the sharp price time, shown
    only if nothing moved since, and the checked-age limits still hold."""
    name = "g2_time"
    t = ref.price_time
    sharp_checked = min(q.checked_at for q in ref.sharp_pair.values())
    if (now - sharp_checked).total_seconds() > SHARP_MAX_CHECKED_S:
        return Gate(name, False, f"sharp checked {(now - sharp_checked).total_seconds() / 60:.0f} min ago > 20")
    if price_at(soft, t) is None:
        return Gate(name, False, "soft price at the sharp price time unknown")
    if moved_since(soft, t):
        return Gate(name, False, "soft book moved after the sharp price time")
    age = (now - soft.checked_at).total_seconds()
    if is_relay(soft.provider, soft.book):
        med = lat.relay_median(m.sport, soft.provider, soft.book, m.kind)
        if med is None:
            return Gate(name, False, f"relay {soft.provider} has no measured delay for {soft.book}")
        if age > med + RELAY_EXTRA_S:
            return Gate(name, False, f"relay checked {age:.0f}s ago > median {med:.0f}s + 2 min")
        last = lat.relay_last_change.get((soft.provider, soft.book, m.game_id))
        if last is None or (now - last).total_seconds() > RELAY_CHANGE_WINDOW_S:
            return Gate(name, False, f"relay showed no {soft.book} change on this game in 60 min")
    elif age > SOFT_MAX_CHECKED_S:
        return Gate(name, False, f"soft checked {age:.0f}s ago > 3 min")
    # Fast sharp sources (Kalshi/Polymarket, same line) must not have moved.
    for book, pair in (fast_pairs if fast_pairs is not None else _fast_pairs(m)).items():
        if not pair or not any(moved_since(q, t) for q in pair.values()):
            continue
        then = {s: price_at(q, t) for s, q in pair.items()}
        if any(v is None for v in then.values()):
            return Gate(name, False, f"{book} changed since the sharp price time and its earlier price is unknown")
        f_then = devig_by("multiplicative", american_to_decimal(then[m.sides[0]]), american_to_decimal(then[m.sides[1]]))
        f_now = _fair(pair, m.sides, ("multiplicative",))
        if f_then is None or f_now is None:
            return Gate(name, False, f"{book} unpriceable")
        moved = abs(f_now["multiplicative"][m.sides[0]] - f_then[0])
        if moved > FAST_SHARP_MOVE_PTS + 1e-9:
            return Gate(name, False, f"{book} moved {moved * 100:.1f} pts since the sharp price time")
    return Gate(name, True)


def gate_corroboration(soft: Quote, copies: list[Quote], now: datetime) -> tuple[Gate, bool]:
    fresh = [c for c in copies if c is not soft and (now - c.checked_at).total_seconds() <= CORROBORATE_S]
    if not fresh:
        return Gate("g3_corroboration", True, "single_source"), True
    bad = [c for c in fresh if abs(c.decimal - soft.decimal) > CORROBORATE_DEC + 1e-9]
    if bad:
        return Gate("g3_corroboration", False, f"{bad[0].provider} has {bad[0].american} vs {soft.american}"), False
    return Gate("g3_corroboration", True, f"{len(fresh)} other copies agree"), False


def gate_settled(soft: Quote, ref: Reference) -> Gate:
    if soft.book in NON_PRICE_BOOKS or soft.provider.endswith("comparenbet_fair"):
        return Gate("g4_settled", False, "a fair-price feed, not a book")
    if soft.pulled:
        return Gate("g4_settled", False, f"{soft.book} has an open pull")
    if any(q.pulled for q in ref.sharp_pair.values()):
        return Gate("g4_settled", False, "the sharp price has an open pull")
    return Gate("g4_settled", True)


def gate_pregame(m: Market, now: datetime) -> Gate:
    if m.start is None:
        return Gate("g5_pregame", False, "start time unknown")
    if now >= m.start - timedelta(seconds=PREGAME_MARGIN_S):
        return Gate("g5_pregame", False, "within 60 s of the start")
    return Gate("g5_pregame", True)


def conservative(soft: Quote, ref: Reference, side: str) -> tuple[float, float, str, dict]:
    """Gate 6's numbers: (ev, edge_pts, method, ev_by_method) at the minimum
    over the point-estimate methods; worst case rides along in ev_by_method."""
    dec = soft.decimal
    evs = {m: ref.fair[m][side] * dec - 1 for m in ref.fair}
    method = min(GATE_METHODS, key=lambda m: evs[m])
    edge = min(ref.fair[m][side] for m in GATE_METHODS) - 1 / dec
    return evs[method], edge, method, evs


def gate_conservative(ev: float, edge: float) -> Gate:
    if ev > 0 and edge > 0:
        return Gate("g6_conservative", True)
    return Gate("g6_conservative", False, f"min EV {ev * 100:+.2f}%")


def gate_copies(soft: Quote, copies: list[Quote]) -> Gate:
    for c in copies:
        if c is soft:
            continue
        if abs((c.checked_at - soft.checked_at).total_seconds()) <= COPIES_CHECKED_WITHIN_S \
                and abs(c.decimal - soft.decimal) > CORROBORATE_DEC + 1e-9:
            return Gate("g7_copies", False, f"{c.provider} copy {c.american} vs {soft.american}")
    return Gate("g7_copies", True)


def _fast_pairs(m: Market) -> dict[str, dict[str, Quote]]:
    out = {}
    for book in ("kalshi", "polymarket", "polymarketus"):
        pair = _pair(m.quotes, book, m.sides, lambda q, b=book: is_first_hand(q.provider, b))
        if pair:
            out[book] = pair
    return out


def _implied_by_book(m: Market, side: str) -> dict[str, float]:
    implied = {}
    for q in m.quotes:
        if q.side == side and q.book not in NON_PRICE_BOOKS:
            implied.setdefault(q.book, 1 / q.decimal)    # one per book
    return implied


def gate_cap_outlier(m: Market, side: str, soft: Quote, ev: float, implied: dict | None = None) -> Gate:
    if ev > EV_CAP:
        return Gate("g8_cap_outlier", False, f"capped: EV {ev * 100:.1f}% > 8% (probable data error)")
    implied = implied if implied is not None else _implied_by_book(m, side)
    if len(implied) >= OUTLIER_MIN_BOOKS:
        med = statistics.median(implied.values())
        mine = 1 / soft.decimal
        if mine < OUTLIER_LOW * med or mine > OUTLIER_HIGH * med:
            return Gate("g8_cap_outlier", False, f"outlier: implied {mine:.3f} vs median {med:.3f}")
    return Gate("g8_cap_outlier", True)


# --------------------------------------------------------------------------- evaluate

def preferred(copies: list[Quote]) -> Quote:
    """F6: first-hand beats a relay, then the later `since`, then the later `checked`."""
    floor = datetime.min.replace(tzinfo=timezone.utc)
    return max(copies, key=lambda q: (is_first_hand(q.provider, q.book), q.since or floor, q.checked_at))


def evaluate(markets: list[Market], latency: Latency, now: datetime) -> list[EdgeResult]:
    out: list[EdgeResult] = []
    for m in markets:
        g1, ref = gate_reference(m, latency)
        if ref is None:
            for side in m.sides:
                out.append(EdgeResult(market=m, side=side, gates=[g1 if not g1.ok else Gate(g1.name, False, "unpriceable")]))
            continue
        fast = _fast_pairs(m)
        for side in m.sides:
            implied = _implied_by_book(m, side)
            by_book: dict[str, list[Quote]] = {}
            for q in m.quotes:
                if q.side == side and q.book not in REFERENCE_BOOKS:
                    by_book.setdefault(q.book, []).append(q)
            for book, copies in sorted(by_book.items()):
                soft = preferred(copies)
                ev, edge, method, evs = conservative(soft, ref, side)
                g3, single = gate_corroboration(soft, copies, now)
                gates = [g1, gate_time(m, side, soft, ref, latency, now, fast), g3, gate_settled(soft, ref),
                         gate_pregame(m, now), gate_conservative(ev, edge), gate_copies(soft, copies),
                         gate_cap_outlier(m, side, soft, ev, implied)]
                out.append(EdgeResult(market=m, side=side, gates=gates, soft=soft, reference=ref,
                                      fair=min(ref.fair[k][side] for k in GATE_METHODS), ev=ev, edge_pts=edge,
                                      method=method, ev_by_method=evs, single_source=single))
    return out


def self_check(results: list[EdgeResult], state: dict | None) -> dict:
    """Gate 9. Returns the new `edge_auto_off` value. Trips when >= 20
    market-sides were evaluated and more than 5% of those passing gates 1-8
    have EV > 5%; clears after 3 consecutive runs under the threshold."""
    state = dict(state or {"on": False})
    evaluated = len({(r.key()[:-1]) for r in results})
    passing = [r for r in results if r.passes_through(8)]
    hot = [r for r in passing if (r.ev or 0) > SELF_CHECK_EV]
    tripped = evaluated >= SELF_CHECK_MIN_EVALUATED and passing and len(hot) / len(passing) > SELF_CHECK_SHARE
    now = datetime.now(timezone.utc).isoformat()
    if tripped:
        return {"on": True, "clean_runs": 0, "at": now,
                "reason": f"{len(hot)} of {len(passing)} passing edges above 5% EV ({evaluated} market-sides evaluated)"}
    if state.get("on"):
        clean = int(state.get("clean_runs", 0)) + 1
        if clean >= SELF_CHECK_CLEAR_RUNS:
            return {"on": False, "clean_runs": clean, "at": now, "reason": f"cleared after {clean} clean runs"}
        return {**state, "clean_runs": clean}
    return {**state, "on": False}      # unchanged, so a quiet run writes nothing


def apply_self_check(results: list[EdgeResult], auto_off: dict) -> None:
    """Record gate 9 on every result, so the log and the counts say why nothing shows."""
    for r in results:
        r.gates.append(Gate("g9_self_check", not auto_off.get("on"), auto_off.get("reason") or ""))


# --------------------------------------------------------------------------- run(): read, evaluate, write

GAME_SIDE_PAIRS = ({"home", "away"}, {"over", "under"}, {"yes", "no"}, {"odd", "even"})
SIDE_ORDER = ("home", "over", "yes", "odd", "away", "under", "no", "even")
_STARTS_TTL_S = 10 * 60
_starts_cache: dict = {"at": None, "starts": {}}


def side_line(m: Market, side: str) -> float | None:
    """The line as that side reads it: a spread's away side is the home point negated."""
    if m.kind == "game" and m.market == "sp" and side == "away" and m.line is not None:
        return -m.line
    return m.line


async def game_starts(now: datetime) -> dict[str, tuple[str, datetime]]:
    """{game_id: (generic sport, start)} from the schedules the worker already
    reads (scoreboards only, no rosters), cached 10 minutes. A game missing
    here has an unknown start and fails gate 5."""
    if _starts_cache["at"] and (now - _starts_cache["at"]).total_seconds() < _STARTS_TTL_S:
        return _starts_cache["starts"]
    import httpx
    import game_context as gc
    out: dict[str, tuple[str, datetime]] = {}

    def put(sport, gid, iso):
        if gid and iso:
            try:
                t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
                out[str(gid)] = (sport, t if t.tzinfo else t.replace(tzinfo=timezone.utc))
            except ValueError:
                pass

    try:
        for g in await gc.load_mlb_games():
            put("mlb", g.game_id, g.game_date)
    except Exception as e:
        print(f"[market_edge] mlb starts: {type(e).__name__}: {e}", flush=True)
    async with httpx.AsyncClient() as client:
        for key, sport in (("nfl", "nfl"), ("cfb", "cfb"), ("nba", "nba"), ("soccer_epl", "soccer"), ("soccer_mls", "soccer")):
            try:
                es, el = gc._ESPN_SPORT_CONFIG[key]
                for g in await gc._fetch_espn_scoreboard(client, es, el, 3):
                    if not g.get("isFinal"):
                        put(sport, g["gameId"], g.get("date"))
            except Exception as e:
                print(f"[market_edge] {key} starts: {type(e).__name__}: {e}", flush=True)
        try:
            for g in await gc._fetch_nhl_week(client, now.strftime("%Y-%m-%d")):
                put("nhl", g["gameId"], g.get("date"))
        except Exception as e:
            print(f"[market_edge] nhl starts: {type(e).__name__}: {e}", flush=True)
    _starts_cache.update(at=now, starts=out)
    return out


def _quote(r) -> Quote:
    import json
    extra = r["extra"]
    if isinstance(extra, str):
        extra = json.loads(extra)
    return Quote(book=r["bookmaker"], provider=r["provider"], side=r["side"], american=int(r["american_odds"]),
                 checked_at=r["checked_at"], since=r["changed_at"], extra=extra or {}, pulled=bool(r["pulled"]),
                 price_asof=r["price_asof"])


def build_markets(game_rows, prop_rows, starts) -> list[Market]:
    groups: dict[tuple, list] = {}
    for r in game_rows:
        pt = r["point"]
        line = -pt if (r["market"] == "sp" and r["side"] == "away" and pt is not None) else pt
        groups.setdefault(("game", r["sport"], r["game_id"], "", r["period"], r["market"], line), []).append(r)
    draws = {(r["game_id"], r["period"], r["market"]) for r in game_rows if r["side"] == "draw"}
    for r in prop_rows:
        sport = starts.get(r["game_id"], ("", None))[0]
        groups.setdefault(("prop", sport, r["game_id"], r["subject_id"], "fg", r["market_key"], r["line"]), []).append(r)
    out = []
    for (kind, sport, gid, subject, period, market, line), rows in groups.items():
        if kind == "game" and (gid, period, market) in draws:
            continue            # a three-way market has no two-sided de-vig
        sides = {r["side"] for r in rows}
        if kind == "game":
            pair = next((p for p in GAME_SIDE_PAIRS if p <= sides), None)
        else:
            pair = {"over", "under"} if {"over", "under"} <= sides else None
        if not pair:
            continue
        quotes = [_quote(r) for r in rows if r["side"] in pair]
        # Gate 1 for a game line needs Pinnacle or Circa; an exchange-only line cannot pass.
        if not any(q.book in (SHARP_BOOKS if kind == "game" else REFERENCE_BOOKS) for q in quotes):
            continue
        out.append(Market(kind=kind, sport=sport, game_id=gid, market=market, line=line,
                          sides=tuple(sorted(pair, key=SIDE_ORDER.index)),
                          start=starts.get(gid, (None, None))[1], quotes=quotes, subject_id=subject, period=period,
                          subject_name=next((r["subject_name"] for r in rows if kind == "prop" and r["subject_name"]), "")))
    return out


async def _read(pool, game_ids: list[str]):
    lat_rows = await pool.fetch("SELECT sport, measure, source, book, market_group, median_s, proven_fast FROM source_latency")
    # A game line is read only at a line a reference prices: Pinnacle first-hand,
    # Circa via VSiN once P7 proves it fast, or a first-hand exchange (gate 2's
    # fast sharp sources ride along at the same line).
    ref_books = ["pinnacle", "kalshi", "polymarket", "polymarketus"] + (
        ["circa"] if any(r["proven_fast"] and r["source"] == "vsin" and r["book"] == "circa" for r in lat_rows) else [])
    checked = "greatest(x.fetched_at, c.last_ok_at)"
    lk = "CASE WHEN {t}.market = 'sp' AND {t}.side = 'away' THEN -{t}.point ELSE {t}.point END"
    game_rows = await pool.fetch(f"""
        WITH ref AS (SELECT DISTINCT r.game_id, r.period, r.market, {lk.format(t='r')} AS lk FROM game_lines r
                      WHERE r.game_id = ANY($1::text[]) AND r.bookmaker = ANY($2::text[]))
        SELECT x.sport, x.game_id, x.period, x.market, x.side, x.point, x.bookmaker, x.source AS provider,
               x.american_odds, x.changed_at, x.extra, {checked} AS checked_at, c.price_asof,
               EXISTS (SELECT 1 FROM game_line_pulls p WHERE p.returned_at IS NULL AND p.sport = x.sport
                         AND p.game_id = x.game_id AND p.period = x.period AND p.market = x.market AND p.side = x.side
                         AND p.bookmaker = x.bookmaker AND p.source = x.source
                         AND p.point IS NOT DISTINCT FROM x.point) AS pulled
          FROM game_lines x
          JOIN ref ON ref.game_id = x.game_id AND ref.period = x.period AND ref.market = x.market
                  AND ref.lk IS NOT DISTINCT FROM {lk.format(t='x')}
          LEFT JOIN scraper_checks c ON c.source = x.source AND c.game_id = x.game_id
         WHERE x.game_id = ANY($1::text[]) AND {checked} > now() - interval '2 hours'""",
                                 game_ids, ref_books)
    # A prop market is read only where a reference could exist: Pinnacle, or a
    # first-hand exchange. Novig/ProphetX arrive only relayed and no relay is
    # proven fast yet (P7), so a market they alone price cannot pass gate 1.
    prop_rows = await pool.fetch(f"""
        WITH ref AS (SELECT DISTINCT game_id, subject_id, market_key, line FROM prop_odds
                      WHERE game_id = ANY($1::text[])
                        AND (bookmaker = 'pinnacle' OR provider_id IN ('scraper:kalshi', 'scraper:polymarket')))
        SELECT x.game_id, x.subject_id, x.subject_name, x.market_key, x.line, x.side, x.bookmaker, x.provider_id AS provider,
               x.american_odds, x.changed_at, x.extra, {checked} AS checked_at, c.price_asof,
               EXISTS (SELECT 1 FROM prop_odds_pulls p WHERE p.returned_at IS NULL AND p.provider_id = x.provider_id
                         AND p.game_id = x.game_id AND p.subject_id = x.subject_id AND p.market_key = x.market_key
                         AND p.side = x.side AND p.bookmaker = x.bookmaker
                         AND p.line IS NOT DISTINCT FROM x.line) AS pulled
          FROM prop_odds x
          JOIN ref ON ref.game_id = x.game_id AND ref.subject_id = x.subject_id AND ref.market_key = x.market_key
                  AND ref.line IS NOT DISTINCT FROM x.line
          LEFT JOIN scraper_checks c ON c.source = x.provider_id AND c.game_id = x.game_id
         WHERE {checked} > now() - interval '2 hours'""", game_ids)
    relay = await pool.fetch("""
        SELECT source AS provider, bookmaker, game_id, max(changed_at) AS last FROM game_lines
         WHERE game_id = ANY($1::text[]) AND source LIKE 'scraper:%' GROUP BY 1, 2, 3
        UNION ALL
        SELECT provider_id, bookmaker, game_id, max(changed_at) FROM prop_odds
         WHERE game_id = ANY($1::text[]) AND provider_id LIKE 'scraper:%' GROUP BY 1, 2, 3""", game_ids)
    lat = Latency()
    for r in lat_rows:
        if r["proven_fast"]:
            lat.fast.add((r["sport"], r["source"], r["book"]))
        if r["measure"] == "relay_delay" and r["median_s"] is not None:
            lat.relay_median_s[(r["sport"], r["source"], r["book"], r["market_group"])] = r["median_s"]
    for r in relay:
        if r["last"]:
            k = (r["provider"], r["bookmaker"], r["game_id"])
            lat.relay_last_change[k] = max(r["last"], lat.relay_last_change.get(k, r["last"]))
    return game_rows, prop_rows, lat


async def _attach_exchange_history(pool, results: list[EdgeResult]) -> list[Market]:
    """Gate 2's second pass: the markets where a fast sharp source moved after
    the sharp price time and its earlier price is needed."""
    import price_history as ph
    need = {id(r.market): r for r in results
            if r.reference and any(g.name == "g2_time" and "earlier price is unknown" in g.detail for g in r.gates)}
    if not need:
        return []
    ms = list({id(r.market): r.market for r in need.values()}.values())
    since = min(r.reference.price_time for r in need.values()) - timedelta(minutes=30)
    props, lines = await ph.read_recent_changes(pool, sorted({m.game_id for m in ms}),
                                                ["kalshi", "polymarket", "polymarketus"], since)
    hist: dict[tuple, list] = {}
    for h in props:
        hist.setdefault(("prop", h["game_id"], h["subject_id"], h["market_key"], h["line"], h["side"],
                         h["bookmaker"], h["provider_id"]), []).append((h["observed_at"], h["american_odds"]))
    for h in lines:
        hist.setdefault(("game", h["game_id"], "", h["market"], h["point"], h["side"],
                         h["bookmaker"], h["source"]), []).append((h["observed_at"], h["american_odds"]))
    for m in ms:
        for q in m.quotes:
            if q.book in ("kalshi", "polymarket", "polymarketus"):
                q.history = hist.get((m.kind, m.game_id, m.subject_id, m.market, side_line(m, q.side), q.side,
                                      q.book, q.provider), [])
    return ms


async def run(now: datetime | None = None) -> dict:
    import time
    import db
    t0 = time.monotonic()
    now = now or datetime.now(timezone.utc)
    pool = await db.get_pool()
    starts = await game_starts(now)
    upcoming = sorted(g for g, (_, st) in starts.items() if now < st < now + timedelta(days=4))
    game_rows, prop_rows, lat = await _read(pool, upcoming) if upcoming else ([], [], Latency())
    t_read = time.monotonic() - t0
    markets = build_markets(game_rows, prop_rows, starts)
    results = evaluate(markets, lat, now)
    redo = await _attach_exchange_history(pool, results)
    if redo:
        ids = {id(m) for m in redo}
        results = [r for r in results if id(r.market) not in ids] + evaluate(redo, lat, now)
    flags = await db.read_app_flags(["edge_display", "edge_auto_off"])
    auto_off = self_check(results, flags.get("edge_auto_off"))
    apply_self_check(results, auto_off)
    display = bool((flags.get("edge_display") or {}).get("enabled", True)) and not auto_off.get("on")
    written = await db.write_market_edges(results, displayed=display, now=now)
    if auto_off != flags.get("edge_auto_off"):
        await db.write_app_flag("edge_auto_off", auto_off, "python:marketEdgeJob")
    by_gate: dict[str, int] = {}
    for r in results:
        f = r.first_failure
        if f:
            by_gate[f] = by_gate.get(f, 0) + 1
    return {"games": len(upcoming), "markets": len(markets), "evaluated": len(results),
            "passing": sum(r.passed for r in results), "first_failure_by_gate": by_gate,
            "auto_off": bool(auto_off.get("on")), "displayed": display, **written,
            "read_s": round(t_read, 2), "runtime_s": round(time.monotonic() - t0, 2)}
