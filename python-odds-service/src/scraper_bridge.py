"""The scraper bridge's pure logic (P6 of the odds build, 2026-09-25).

The odds-scraper (a separate repo on the operator's laptop) writes every price
change it sees to its own SQLite `scraper.db`. The bridge
(`scraper_bridge_run.py`) reads that, maps each row to the app's ids and keys,
holds each change for a second reading, and writes the confirmed changes
through the shared `db.write_*` functions. This module is everything in that
sequence that needs no database: mapping one offer, the hold buffer, the D24
policy and the main-line choice. `test_scraper_bridge.py` covers it.

Measured facts it rests on (P6-bridge.md "Facts", re-read 2026-09-25):

  * `offers.price` is American and may be fractional (Kalshi 354.55).
  * A spread's point is PER SIDE: Pinnacle writes home -1.5 at 197 and away
    +1.5 at -229 in one snapshot. So a game whose orientation is reversed
    against the app's swaps the SIDE and keeps the point: the point belongs to
    the team, and the team keeps it. (The spec said "negate the point" as well;
    doing both would hand each team the other's number. Corrected in the P6
    changelog, 2026-09-25.)
  * `snapshots.fetched_at` is naive UTC text.
"""
from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from db import ExchangeBookInput, GameLineInput, PropOddsInput, UnmatchedPriceInput, canonical_prop_side
from entity_resolution import canonical_bookmaker
from scraper_markets import bridgeable_book, game_market, prop_label_status, prop_market_key

FLAP_WINDOW_SECONDS = 600          # the scraper's own flap window (config.FLAP_WINDOW_SECONDS)

# Source priority within a cycle (§2 step 1): the first-hand books first, then
# the aggregators. Keys never cross sources, so this orders writes only.
SOURCE_PRIORITY = ["pinnacle", "kalshi", "polymarket", "vsin", "draftkings", "fanduel", "betmgm", "betrivers",
                   "sleeper", "underdog"]
AGGREGATOR_PRIORITY = ["actionnetwork", "comparenbet", "4codds", "oddstrader", "theoddsgap", "betexplorer",
                       "scoresandodds", "livesportsodds", "oddsrun", "mbodds", "bestfightodds", "proboxingodds",
                       "betmonitor", "oddsmeter"]

EXTRA_KEYS = ("limit", "version", "yes_bid", "yes_ask", "no_bid", "no_ask", "yes_bid_size", "yes_ask_size",
              "bid", "ask", "bid_size", "ask_size", "volume_24h", "open_interest", "liquidity", "mult", "fantasy",
              "one_sided", "yes_only", "ticker")
PICKEM_SOURCES = frozenset({"sleeper", "underdog"})
EXCHANGES = frozenset({"kalshi", "polymarket"})
LADDER_LEVELS = 10

UNMATCHED_REASONS = ("unmatched-game", "unmatched-player", "unmapped-market", "unmapped-game-market", "no-app-sport")


def source_rank(source: str) -> int:
    if source in SOURCE_PRIORITY:
        return SOURCE_PRIORITY.index(source)
    if source in AGGREGATOR_PRIORITY:
        return len(SOURCE_PRIORITY) + AGGREGATOR_PRIORITY.index(source)
    return 100


# ---------------------------------------------------------------------------
# Prices and times
# ---------------------------------------------------------------------------
def to_american(price: float) -> int:
    """Round half away from zero; a value inside (-100, 100) after rounding is
    not an American price (the schema's sanity check) and becomes ±100."""
    a = int(math.copysign(math.floor(abs(price) + 0.5), price))
    if -100 < a < 100:
        a = -100 if price < 0 else 100
    return a


def to_decimal(price: float) -> float:
    """From the UNROUNDED price, so a fractional Kalshi or Sleeper price keeps
    its precision in `decimal_odds`."""
    return 1 + price / 100 if price > 0 else 1 + 100 / -price


def implied(american: float) -> float:
    return 100 / (american + 100) if american > 0 else -american / (-american + 100)


def parse_ts(value) -> datetime | None:
    """SQLite text (naive UTC) or ISO -> aware UTC."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def since_time(source_ts_ms: int | None, fetched_at: datetime, cache_age_s: int | None) -> datetime:
    """"Since" (D23): the source's own per-price time where it has one; else the
    fetch less the CDN copy's Age (Pinnacle, D13); else the fetch. Never later
    than the fetch — a source clock ahead of ours would otherwise date a change
    after we saw it, and the history table refuses that (observed <= recorded)."""
    if source_ts_ms:
        ts = datetime.fromtimestamp(source_ts_ms / 1000, timezone.utc)
        return min(ts, fetched_at)
    if cache_age_s:
        return fetched_at - timedelta(seconds=cache_age_s)
    return fetched_at


def extra_from(depth: dict | None, price_alt: float | None, source: str) -> dict | None:
    if not isinstance(depth, dict):          # some sources store a list there
        depth = None
    out = {k: depth[k] for k in EXTRA_KEYS if depth and depth.get(k) is not None}
    if source in PICKEM_SOURCES and price_alt is not None:
        out["multiplier"] = price_alt
    return out or None


# ---------------------------------------------------------------------------
# Orientation
# ---------------------------------------------------------------------------
_SIDE_SWAP = {"home": "away", "away": "home"}


def swap_side(side: str | None) -> str | None:
    return _SIDE_SWAP.get(side, side)


def swap_market(typ: str) -> str:
    """tt_home <-> tt_away, and every other `*_home` / `*_away` game type."""
    if typ.endswith("_home"):
        return typ[:-5] + "_away"
    if typ.endswith("_away"):
        return typ[:-5] + "_home"
    return typ


# ---------------------------------------------------------------------------
# D24 policy
# ---------------------------------------------------------------------------
class Policy:
    """`scraper_bridge_policy.json` as an object: which classes of row are
    forwarded pre-game and in-game, and whether unmatched prices are kept."""

    def __init__(self, data: dict):
        self.data = data
        self.first_hand_sources = frozenset(data["first_hand_sources"])
        self.first_hand_books = frozenset(b for books in data["first_hand_books"].values() for b in books)
        self.classes = data["classes"]
        um = data.get("unmatched_prices") or {}
        self.unmatched_on = bool(um.get("on"))
        self.unmatched_reasons = frozenset(um.get("reasons") or UNMATCHED_REASONS)

    @classmethod
    def load(cls, path: str) -> "Policy":
        with open(path, encoding="utf-8") as fh:
            return cls(json.load(fh))

    def classify(self, source: str, book_key: str) -> str:
        """first_hand: a source that IS the book (or the book's own feed).
        relay_duplicate: an aggregator relaying a book a first-hand source
        already reads (DraftKings via comparenbet). relay_only: the rest."""
        if source in self.first_hand_sources:
            return "first_hand"
        if book_key in self.first_hand_books:
            return "relay_duplicate"
        return "relay_only"

    def allows(self, cls: str, ingame: bool) -> bool:
        return bool(self.classes[cls]["ingame" if ingame else "pregame"])

    def keeps_unmatched(self, reason: str) -> bool:
        return self.unmatched_on and reason in self.unmatched_reasons


# ---------------------------------------------------------------------------
# One offer
# ---------------------------------------------------------------------------
@dataclass
class Offer:
    id: int
    snapshot_id: int
    source: str
    endpoint: str
    event_external_id: str
    prop_market_external_id: str | None
    market: str
    side: str | None
    line: float | None
    book: str | None
    book_key: str | None
    price: float | None
    price_alt: float | None
    source_ts_ms: int | None
    depth: dict | None
    fetched_at: datetime
    cache_age_s: int | None = None

    @property
    def variant(self):
        return self.depth.get("variant") if isinstance(self.depth, dict) else None

    def scraper_key(self) -> str:
        """The scraper's own offer identity, as text (source|event|prop market|
        market|side|book|line[|variant])."""
        parts = [self.source, self.event_external_id or "", self.prop_market_external_id or "", self.market or "",
                 self.side or "", self.book or "", "" if self.line is None else repr(float(self.line))]
        if self.variant is not None:
            parts.append(f"v={self.variant}")
        return "|".join(parts)


@dataclass
class GameRef:
    """A scraper event resolved to an app game: the canonical game's link,
    composed with the source event's own orientation to the canonical game."""
    app_sport: str
    app_game_id: str
    reversed: bool
    app_start: datetime | None


@dataclass
class PropRef:
    player: str | None
    player_norm: str | None
    stat: str | None
    line: float | None


@dataclass
class PlayerRef:
    subject_id: str
    subject_name: str
    position: str | None


@dataclass
class Mapped:
    kind: str                         # 'prop' | 'game' | 'unmatched' | 'skip'
    key: tuple | None = None          # the app-side natural key (hold buffer key)
    value: object = None              # what a change is judged on
    row: object = None                # PropOddsInput | GameLineInput | UnmatchedPriceInput
    reason: str | None = None         # skip / unmatched reason
    exchange: ExchangeBookInput | None = None
    needs_main: bool = False          # game row with no alt flag: main decided later
    opener_ok: bool = False           # may seed a first_seen opener
    scraper_key: str | None = None
    sport: str | None = None          # the app sport (prop rows carry none of their own)


def prop_key(r: PropOddsInput) -> tuple:
    return ("p", r.provider_id, r.game_id, r.subject_id, r.market_key, r.line, r.side, r.bookmaker)


def game_key(r: GameLineInput) -> tuple:
    return ("g", r.sport, r.game_id, r.period, r.market, r.side, r.point, r.bookmaker, r.source)


def _exchange(o: Offer, sport: str, game_id: str, subject_id: str, period: str, market: str, side: str,
              point: float | None, since: datetime) -> ExchangeBookInput | None:
    d = o.depth if isinstance(o.depth, dict) else None
    if o.source not in EXCHANGES or not d:
        return None
    if o.source == "kalshi" and ("yes_bids" in d or "no_bids" in d) and d.get("ticker"):
        ladder = {"yes_bids": (d.get("yes_bids") or [])[:LADDER_LEVELS], "no_bids": (d.get("no_bids") or [])[:LADDER_LEVELS]}
        return ExchangeBookInput(exchange="kalshi", contract_id=str(d["ticker"]), sport=sport, game_id=game_id,
                                 subject_id=subject_id, period=period, market=market, side=side, point=point,
                                 best_bid=d.get("yes_bid"), best_ask=d.get("yes_ask"), bid_size=d.get("yes_bid_size"),
                                 ask_size=d.get("yes_ask_size"), volume_24h=d.get("volume_24h"),
                                 open_interest=d.get("open_interest"), liquidity=d.get("liquidity"), ladder=ladder,
                                 changed_at=since, fetched_at=o.fetched_at)
    if o.source == "polymarket" and ("bids" in d or "asks" in d) and d.get("token"):
        ladder = {"bids": (d.get("bids") or [])[:LADDER_LEVELS], "asks": (d.get("asks") or [])[:LADDER_LEVELS]}
        return ExchangeBookInput(exchange="polymarket", contract_id=str(d["token"]), sport=sport, game_id=game_id,
                                 subject_id=subject_id, period=period, market=market, side=side, point=point,
                                 best_bid=d.get("bid"), best_ask=d.get("ask"), bid_size=d.get("bid_size"),
                                 ask_size=d.get("ask_size"), volume_24h=d.get("volume_24h"),
                                 open_interest=d.get("open_interest"), liquidity=d.get("liquidity"), ladder=ladder,
                                 changed_at=since, fetched_at=o.fetched_at)
    return None


def map_offer(o: Offer, *, game: GameRef | None, game_miss: str | None, prop: PropRef | None,
              player: PlayerRef | None, policy: Policy, event_label: str | None = None,
              provider_prefix: str = "scraper") -> Mapped:
    """One scraper offer -> the app's row, an unmatched row, or a skip (§3).

    `game` is the resolved app game (None when unlinked; `game_miss` then says
    why: 'unmatched-game' or 'no-app-sport'). `prop`/`player` are the prop
    market and its linked player for a prop row."""
    if o.price is None or o.price == 0:
        return Mapped("skip", reason="no-price")
    if o.book_key in ("anopen",):
        return Mapped("skip", reason="opener-row")       # AN Open feeds openers (§7), not prices
    if not bridgeable_book(o.book_key):
        return Mapped("skip", reason="non-price" if o.book_key else "unidentified-book")

    provider = f"{provider_prefix}:{o.source}"
    since = since_time(o.source_ts_ms, o.fetched_at, o.cache_age_s)
    american, decimal = to_american(o.price), to_decimal(o.price)
    book = canonical_bookmaker(o.book_key)
    sk = o.scraper_key()

    def unmatched(reason: str) -> Mapped:
        if not policy.keeps_unmatched(reason):
            return Mapped("skip", reason=f"{reason} (not kept)")
        label = (prop.stat if prop and prop.stat else None) or o.market
        row = UnmatchedPriceInput(source=provider, scraper_key=sk, event=event_label, market=label,
                                  player=prop.player if prop else None, book=o.book_key, line=o.line, side=o.side,
                                  price=float(o.price), checked=o.fetched_at, since=since, reason=reason)
        return Mapped("unmatched", key=("u", provider, sk), value=float(o.price), row=row, reason=reason,
                      scraper_key=sk)

    is_prop = bool(o.prop_market_external_id)
    if is_prop and prop is not None and prop.stat and prop_label_status(o.source, prop.stat) == "no-app-sport":
        return unmatched("no-app-sport")
    if game is None:
        return unmatched(game_miss or "unmatched-game")

    ingame = game.app_start is not None and o.fetched_at >= game.app_start
    if not policy.allows(policy.classify(o.source, o.book_key), ingame):
        return Mapped("skip", reason="policy")
    extra = extra_from(o.depth, o.price_alt, o.source)

    if is_prop:
        if prop is None:
            return unmatched("unmapped-market")
        if player is None:
            return unmatched("unmatched-player")
        key = (prop_market_key(o.source, prop.stat or "", player.position)
               or prop_market_key(o.source, o.market or "", player.position))
        if key is None:
            return unmatched("unmapped-market")
        side = o.side
        row = PropOddsInput(provider_id=provider, game_id=game.app_game_id, subject_id=player.subject_id,
                            subject_name=player.subject_name, market_key=key, line=o.line, side=side, bookmaker=book,
                            american_odds=american, decimal_odds=decimal, observed_at=o.fetched_at,
                            changed_at=since, extra=extra)
        row.side = canonical_prop_side(row.side)
        ex = _exchange(o, game.app_sport, game.app_game_id, player.subject_id, "fg", key, row.side, o.line, since)
        if ex and provider_prefix != "scraper":
            ex.contract_id = f"{provider_prefix}:{ex.contract_id}"
        alt = isinstance(o.depth, dict) and (o.depth.get("alt") is True or o.depth.get("yes_only"))
        return Mapped("prop", key=prop_key(row), value=american, row=row, exchange=ex, scraper_key=sk,
                      opener_ok=not alt and o.source not in EXCHANGES, sport=game.app_sport)

    gm = game_market(o.market)
    if gm is None:
        return unmatched("unmapped-game-market")
    period, typ = gm
    side = o.side
    if game.reversed:
        side = swap_side(side)
        typ = swap_market(typ)
    alt_flag = o.depth.get("alt") if isinstance(o.depth, dict) else None
    row = GameLineInput(sport=game.app_sport, game_id=game.app_game_id, period=period, market=typ, side=side or "",
                        point=o.line, is_main=alt_flag is False, bookmaker=book, source=provider,
                        american_odds=american, decimal_odds=decimal, observed_at=o.fetched_at, changed_at=since,
                        extra=extra)
    ex = _exchange(o, game.app_sport, game.app_game_id, "", period, typ, row.side, o.line, since)
    if ex and provider_prefix != "scraper":
        ex.contract_id = f"{provider_prefix}:{ex.contract_id}"
    return Mapped("game", key=game_key(row), value=american, row=row, exchange=ex, scraper_key=sk,
                  needs_main=alt_flag is None, opener_ok=alt_flag is not True, sport=game.app_sport)


# ---------------------------------------------------------------------------
# The main line (§3 is_main): the alt flag when the source has one; else the
# book's only line; else the pair closest to even money (the BetMGM rule, R2).
# ---------------------------------------------------------------------------
def line_id(market: str, side: str, point: float | None):
    """The point a two-sided pair shares: a spread pair is home p / away -p."""
    if point is None:
        return None
    if market == "sp":
        return point if side == "home" else -point
    return point


def choose_main(lines: dict[tuple[str, float | None], int], market: str):
    """`lines`: {(side, point): american} for one (game, period, market, book,
    source). -> the main line id."""
    by_id: dict = {}
    for (side, point), american in lines.items():
        by_id.setdefault(line_id(market, side, point), []).append(american)
    if len(by_id) <= 1:
        return next(iter(by_id), None)

    def score(prices):
        s = sum(abs(implied(p) - 0.5) for p in prices)
        return (0 if len(prices) >= 2 else 1, s)
    return min(by_id, key=lambda i: score(by_id[i]))


# ---------------------------------------------------------------------------
# The hold buffer (§4, B3's flap rule: a new price counts once it holds two
# readings).
# ---------------------------------------------------------------------------
@dataclass
class Pending:
    value: object
    snapshot_id: int
    endpoint: tuple[str, str]
    mapped: Mapped
    at: datetime


@dataclass
class HoldBuffer:
    flap_window: float = FLAP_WINDOW_SECONDS
    pending: dict = field(default_factory=dict)
    forwarded: dict = field(default_factory=dict)      # key -> value last forwarded
    flaps: int = 0
    hold_seconds: list = field(default_factory=list)

    def offer(self, m: Mapped, snapshot_id: int, endpoint: tuple[str, str], at: datetime) -> None:
        key = m.key
        p = self.pending.get(key)
        if p is not None:
            if key in self.forwarded and self.forwarded[key] == m.value \
                    and (at - p.at).total_seconds() <= self.flap_window:
                del self.pending[key]          # A -> B -> A: nothing to forward
                self.flaps += 1
                return
            self.pending[key] = Pending(m.value, snapshot_id, endpoint, m, at)
            return
        if key in self.forwarded and self.forwarded[key] == m.value:
            return                             # a re-reading of what was forwarded
        self.pending[key] = Pending(m.value, snapshot_id, endpoint, m, at)

    def pull(self, key) -> None:
        """A pull drops the pending change, and forgets the forwarded value so a
        return is forwarded again."""
        self.pending.pop(key, None)
        self.forwarded.pop(key, None)

    def confirm(self, latest_ok: dict[tuple[str, str], tuple[int, datetime]]) -> list[Mapped]:
        """Forward every pending change a later ok/unchanged snapshot of the
        same (source, endpoint) has re-read. Order: the order changes arrived."""
        out = []
        for key in list(self.pending):
            p = self.pending[key]
            ok = latest_ok.get(p.endpoint)
            if ok and ok[0] > p.snapshot_id:
                out.append(p.mapped)
                self.forwarded[key] = p.value
                self.hold_seconds.append(max(0.0, (ok[1] - p.at).total_seconds()))
                del self.pending[key]
        return out

    def median_hold_s(self) -> float | None:
        return round(statistics.median(self.hold_seconds), 1) if self.hold_seconds else None


# ---------------------------------------------------------------------------
# Openers (§7, D21)
# ---------------------------------------------------------------------------
def opener_from_row(m: Mapped) -> "OpenerInput | None":
    """A `first_seen` opener for a forwarded row: a game row only when it is
    the book's MAIN line; a prop row unless it is an alternate rung, a yes-only
    ladder or an exchange contract (those are ladders, not a book's line)."""
    from db import OpenerInput
    r = m.row
    if m.kind == "game" and r.is_main and m.opener_ok:
        return OpenerInput(kind="game", sport=r.sport, game_id=r.game_id, subject_id="", period=r.period,
                           market=r.market, side=r.side, bookmaker=r.bookmaker, point=r.point,
                           american_odds=r.american_odds, opened_at=r.changed_at or r.observed_at,
                           opener_source="first_seen")
    if m.kind == "prop" and m.opener_ok:
        return OpenerInput(kind="prop", sport=m.sport or "", game_id=r.game_id, subject_id=r.subject_id, period="fg",
                           market=r.market_key, side=r.side, bookmaker=r.bookmaker, point=r.line,
                           american_odds=r.american_odds, opened_at=r.changed_at or r.observed_at,
                           opener_source="first_seen")
    return None


def opener_key(o) -> tuple:
    return (o.kind, o.game_id, o.subject_id or "", o.period or "fg", o.market, o.side, o.bookmaker)


def an_open_opener(o: Offer, game: GameRef, book_prefix: str = "") -> "OpenerInput | None":
    """Action Network's `AN Open` rows (book_key 'anopen') -> an `an_open`
    opener for bookmaker 'anopen'."""
    from db import OpenerInput
    if o.book_key != "anopen" or o.price is None or o.prop_market_external_id:
        return None
    gm = game_market(o.market)
    if gm is None:
        return None
    period, typ = gm
    side = o.side or ""
    if game.reversed:
        side, typ = swap_side(side), swap_market(typ)
    return OpenerInput(kind="game", sport=game.app_sport, game_id=game.app_game_id, subject_id="", period=period,
                       market=typ, side=side, bookmaker=book_prefix + "anopen", point=o.line,
                       american_odds=to_american(o.price),
                       opened_at=since_time(o.source_ts_ms, o.fetched_at, o.cache_age_s), opener_source="an_open")


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    if s.upper() == "PK":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return None


def parse_vsin_opener(data: dict, game: GameRef, at: datetime, book_prefix: str = "") -> list:
    """A VSiN OPEN row {book, period, spread_away "-1.5 +145", ml_away "-120",
    total "6.5"} -> `vsin_open` openers. VSiN states the away side only: the
    home spread is the away point negated (no price), and a total carries a
    point and no price. "-", "- -" are blanks."""
    from db import OpenerInput
    book = (data.get("book") or "").lower().replace(" ", "")
    period = data.get("period") or "fg"
    if not book or period not in ("fg", "1h"):
        return []
    out = []

    def add(market, side, point, odds):
        if game.reversed:
            side = swap_side(side)
        out.append(OpenerInput(kind="game", sport=game.app_sport, game_id=game.app_game_id, subject_id="",
                               period=period, market=market, side=side, bookmaker=book_prefix + book, point=point,
                               american_odds=None if odds is None else to_american(odds), opened_at=at,
                               opener_source="vsin_open"))

    parts = (data.get("spread_away") or "").split()
    if parts:
        point = _num(parts[0])
        price = _num(parts[1]) if len(parts) > 1 else None
        if point is not None:
            add("sp", "away", point, price)
            add("sp", "home", -point if point else 0.0, None)
    ml = _num(data.get("ml_away"))
    if ml is not None and ml != 0:
        add("ml", "away", None, ml)
    total = _num((data.get("total") or "").split()[0] if data.get("total") else None)
    if total is not None:
        add("tot", "over", total, None)
        add("tot", "under", total, None)
    return out


# ---------------------------------------------------------------------------
# Splits (§8) and book links (§8b)
# ---------------------------------------------------------------------------
def map_split(row: dict, game: GameRef, prop: PropRef | None, player: PlayerRef | None,
              source_prefix: str = ""):
    """A scraper `splits` row -> SplitInput, or None when it cannot be placed.
    Game splits keep their market (ml/sp/tot, periods from P2); a pick count
    names its player and prop key; Action Network's bet count is per GAME
    (all markets, no side) and is stored as market 'game', side 'all'."""
    from db import SplitInput
    kind = row["kind"]
    at = parse_ts(row["at"])
    subject, period, market, side, line = "", "fg", None, row.get("side") or "", row.get("line")
    if row.get("prop_market_external_id"):
        if prop is None or player is None:
            return None
        market = (prop_market_key(row["source"], prop.stat or "", player.position)
                  or prop_market_key(row["source"], row.get("market") or "", player.position))
        if market is None:
            return None
        subject = player.subject_id
    elif row.get("market"):
        gm = game_market(row["market"])
        if gm is None:
            return None
        period, market = gm
        if game.reversed:
            side, market = swap_side(side), swap_market(market)
    elif kind == "bet_count":
        market, side = "game", "all"
    else:
        return None
    return SplitInput(sport=game.app_sport, game_id=game.app_game_id, subject_id=subject, period=period,
                      market=market, side=side, line=line, source=source_prefix + row["source"], book=row.get("book"),
                      kind=kind, pct_bets=row.get("pct_bets"), pct_money=row.get("pct_money"),
                      count=row.get("count"), count_total=row.get("count_total"), observed_at=at)


def book_links(data: dict, game: GameRef, at: datetime, source: str = "comparenbet") -> list:
    """comparenbet's per-event `links` {book: url} -> `book_link` reference rows,
    one per canonical bookmaker (P12's "open at book")."""
    from db import GameReferenceInput
    out = []
    for book, url in sorted((data.get("links") or {}).items()):
        name = canonical_bookmaker(book)
        if name and url:
            out.append(GameReferenceInput(sport=game.app_sport, game_id=game.app_game_id, source=source,
                                          kind="book_link", subject=name, data={"url": url}, observed_at=at))
    return out


# ---------------------------------------------------------------------------
# VSiN power ratings -> the app's teams (§8b). Measured 2026-09-25: the pro
# leagues' rows carry full names ("Arizona Cardinals", one "Wash Commanders");
# CFB's carry the school only ("Alabama", "Arizona ST", "Alabama A&M").
# A miss is acceptable; a wrong team is not.
# ---------------------------------------------------------------------------
_RATING_WORDS = {"st": "state", "wash": "washington"}
# A school name followed by one of these is a DIFFERENT school ("Alabama" is
# not "Alabama State Hornets"), so a bare prefix never matches across it.
SCHOOL_MODIFIERS = frozenset({"state", "st", "southern", "northern", "eastern", "western", "central", "tech",
                              "a&m", "christian", "international", "poly", "baptist", "university", "college",
                              "(oh)", "(fl)", "(pa)", "atlantic", "gulf", "coast", "southeastern", "northwestern",
                              "southwestern", "northeastern", "mississippi", "kentucky", "texas", "illinois",
                              "carolina", "florida", "georgia", "alabama", "louisiana", "michigan", "ohio",
                              "arkansas", "tennessee", "virginia", "indiana", "kansas", "iowa", "utah", "nevada",
                              "arizona", "colorado", "oregon", "washington", "wisconsin", "dakota", "new", "san"})


def _rating_words(name: str) -> list[str]:
    from entity_resolution import strip_accents
    words = [w for w in strip_accents(name.lower()).replace(".", "").split() if w]
    return [_RATING_WORDS.get(w, w) for w in words]


def match_ratings(subjects: list[str], teams: list[str], sport: str) -> dict[str, str]:
    """{app team name: rating subject}. Pro leagues: the normalized names are
    equal. CFB: the school is the LONGEST rating subject that prefixes the
    team's words, and the next word is not a school modifier."""
    from entity_resolution import normalize_team_name
    out: dict[str, str] = {}
    subs = [(s, _rating_words(s)) for s in subjects if s and s.strip()]
    for team in teams:
        tw = _rating_words(team)
        if sport != "cfb":
            tn = normalize_team_name(" ".join(tw))
            hits = [s for s, sw in subs if normalize_team_name(" ".join(sw)) == tn]
            if len(hits) == 1:
                out[team] = hits[0]
            continue
        best, best_len = None, 0
        for s, sw in subs:
            n = len(sw)
            if n and len(tw) > n and tw[:n] == sw and n > best_len:
                best, best_len = s, n
        if best is not None and tw[best_len] not in SCHOOL_MODIFIERS:
            out[team] = best
    return out
