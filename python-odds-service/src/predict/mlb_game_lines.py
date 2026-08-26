"""Direct port of lib/odds/oddsApi.ts — not a reimplementation.

Game-level MLB lines from the-odds-api.com (free tier: 500 credits/month).
Quota discipline is the whole design here. A credit is charged per market
per region per call, so the default h2h,spreads,totals over the us region
costs 3 credits every refresh. This module: refreshes on a long TTL (6h by
default), persists the cache in the shared odds_cache table (so a restart
doesn't respend), stops refreshing once the API's own remaining-credit
header nears zero, and serves stale data with an honest timestamp rather
than going quiet.

Real, deliberate deviation from the gameplan's original "as new
ProviderSpecs" framing (Phase F's own required audit, see
docs/mlb-prediction-engine-python-port-gameplan-2026-08-21.md): TS's real
game-lines architecture is request/TTL-driven — whoever hits
app/api/odds/lines next after the TTL lapses triggers the refresh — not a
scheduled background job the way player props are. That doesn't fit
job_runner.py's ProviderSpec/run_provider_specs shape at all: no
provider_usage cap, no per-game batching, one whole-slate call with its own
bespoke credit-header-based budget. Porting it as a REAL scheduled job (see
jobs.py's job_mlb_game_lines) is still a genuine upgrade over "whoever loads
the page next" — same category of upgrade as Phase E's grading job — it
just isn't a ProviderSpec.

Only the-odds-api is ported here. lib/odds/merge.ts's other input
(OddsHarvester) is confirmed dead by the user this session ("oddsharverster
doesnt work and thatsknown") — not worth porting dead weight. NFL's game
lines (SharpAPI's separate game-lines board + TheRundown,
lib/odds/nflGameLines.ts) and SportsGameOdds's getSportsGameOddsGameLine are
both NFL-only in the real app (confirmed: neither is wired into any MLB code
path) with no Python NFL prediction pipeline to feed yet — out of scope
until one exists.

CRITICAL for this specific port: odds_cache is a table BOTH apps read and
write. TS's readOddsCache does `JSON.parse(payload) as GameLine[]`,
expecting the real TS GameLine interface's camelCase field names exactly
(eventId, commenceTime, homeTeam, ...). The payload this module writes must
match that shape byte-for-byte in field naming, or TS's existing route
handlers reading this same cache key break on the next Python-written
row — the exact class of bug CLAUDE.md's own park_factors incident
describes. See _to_json/_from_json below; every dataclass here uses
Pythonic snake_case internally, but never gets serialized that way.
"""
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

import config
import db

from .odds_math import american_to_decimal

BASE = "https://api.the-odds-api.com/v4"
SPORT_KEY = "baseball_mlb"


@dataclass
class BookmakerOdds:
    bookmaker: str
    home_odds: float | None = None
    away_odds: float | None = None
    # Soccer's 1x2 market has a real third outcome the-odds-api's MLB path
    # never needed (baseball has no draw) — added when OddsHarvester started
    # covering soccer, optional so every existing MLB caller is unaffected.
    draw_odds: float | None = None
    over_price: float | None = None
    under_price: float | None = None
    point: float | None = None
    spread_home: float | None = None
    spread_home_price: float | None = None
    spread_away: float | None = None
    spread_away_price: float | None = None


@dataclass
class MoneylineSummary:
    home: float | None = None
    away: float | None = None
    book: str | None = None


@dataclass
class SpreadSummary:
    home_point: float | None = None
    home_price: float | None = None
    away_point: float | None = None
    away_price: float | None = None
    book: str | None = None


@dataclass
class TotalSummary:
    point: float | None = None
    over_price: float | None = None
    under_price: float | None = None
    book: str | None = None


@dataclass
class GameLine:
    event_id: str
    commence_time: str
    home_team: str
    away_team: str
    moneyline: MoneylineSummary | None = None
    spread: SpreadSummary | None = None
    total: TotalSummary | None = None
    bookmakers: list[BookmakerOdds] = field(default_factory=list)
    book_count: int = 0


def summarise_odds_event(event: dict) -> GameLine:
    """Collapse every bookmaker's quote into one line per game, taking the
    best available price for each side so the number shown is one a user
    could actually have got somewhere, for all three markets. Each side is
    maximized independently, so the two sides of a spread/total can end up
    attributed to different books — a disclosed limitation carried over
    from the TS source, not new here. Retains every book's own price in
    `bookmakers` alongside the collapsed summary."""
    line = GameLine(
        event_id=str(event.get("id")),
        commence_time=event.get("commence_time"),
        home_team=event.get("home_team"),
        away_team=event.get("away_team"),
        bookmakers=[],
        book_count=len(event.get("bookmakers") or []),
    )

    bookmakers: list[BookmakerOdds] = []

    for book in event.get("bookmakers") or []:
        entry = BookmakerOdds(bookmaker=book.get("title"))
        has_data = False

        for market in book.get("markets") or []:
            outcomes = market.get("outcomes") or []
            key = market.get("key")

            if key == "h2h":
                home = next((o for o in outcomes if o.get("name") == event.get("home_team")), None)
                away = next((o for o in outcomes if o.get("name") == event.get("away_team")), None)
                if home and home.get("price") is not None:
                    entry.home_odds = american_to_decimal(home["price"])
                    has_data = True
                if away and away.get("price") is not None:
                    entry.away_odds = american_to_decimal(away["price"])
                    has_data = True

                if line.moneyline is None:
                    line.moneyline = MoneylineSummary()
                # "Best" for American odds is simply the largest number.
                if home and home.get("price") is not None and (line.moneyline.home is None or home["price"] > line.moneyline.home):
                    line.moneyline.home = home["price"]
                    line.moneyline.book = book.get("title")
                if away and away.get("price") is not None and (line.moneyline.away is None or away["price"] > line.moneyline.away):
                    line.moneyline.away = away["price"]
                    line.moneyline.book = book.get("title")

            if key == "spreads":
                home = next((o for o in outcomes if o.get("name") == event.get("home_team")), None)
                away = next((o for o in outcomes if o.get("name") == event.get("away_team")), None)
                if home and home.get("point") is not None:
                    entry.spread_home = home["point"]
                    has_data = True
                if home and home.get("price") is not None:
                    entry.spread_home_price = american_to_decimal(home["price"])
                    has_data = True
                if away and away.get("point") is not None:
                    entry.spread_away = away["point"]
                    has_data = True
                if away and away.get("price") is not None:
                    entry.spread_away_price = american_to_decimal(away["price"])
                    has_data = True

                if line.spread is None:
                    line.spread = SpreadSummary()
                if home and home.get("price") is not None and (line.spread.home_price is None or home["price"] > line.spread.home_price):
                    line.spread.home_point = home.get("point")
                    line.spread.home_price = home["price"]
                    line.spread.book = book.get("title")
                if away and away.get("price") is not None and (line.spread.away_price is None or away["price"] > line.spread.away_price):
                    line.spread.away_point = away.get("point")
                    line.spread.away_price = away["price"]
                    line.spread.book = book.get("title")

            if key == "totals":
                over = next((o for o in outcomes if o.get("name") == "Over"), None)
                under = next((o for o in outcomes if o.get("name") == "Under"), None)
                over_point = over.get("point") if over else None
                under_point = under.get("point") if under else None
                if over_point is not None or under_point is not None:
                    entry.point = over_point if over_point is not None else under_point
                    has_data = True
                if over and over.get("price") is not None:
                    entry.over_price = american_to_decimal(over["price"])
                    has_data = True
                if under and under.get("price") is not None:
                    entry.under_price = american_to_decimal(under["price"])
                    has_data = True

                # `point` is tracked alongside whichever side most recently
                # won — over and under can theoretically differ in point
                # across books, and this single-field shape can't represent
                # both simultaneously, same limitation moneyline already has
                # for `book` above.
                if line.total is None:
                    line.total = TotalSummary()
                if over and over.get("price") is not None and (line.total.over_price is None or over["price"] > line.total.over_price):
                    line.total.point = over.get("point") if over.get("point") is not None else line.total.point
                    line.total.over_price = over["price"]
                    line.total.book = book.get("title")
                if under and under.get("price") is not None and (line.total.under_price is None or under["price"] > line.total.under_price):
                    line.total.point = line.total.point if line.total.point is not None else under.get("point")
                    line.total.under_price = under["price"]
                    line.total.book = book.get("title")

        if has_data:
            bookmakers.append(entry)

    line.bookmakers = bookmakers
    return line


# ---------------------------------------------------------------------------
# Building GameLines from game_odds_book_lines (2026-08-26, MLB source-of-
# truth flip — Phase 2 of the odds-architecture rebuild). Lets any source
# already writing into that shared table (SharpAPI's recovered game-lines
# board, in practice) feed the same lock-cycle/attach-price consumers this
# module's own the-odds-api fetch has always fed, via the same GameLine
# shape — those consumers don't know or care which source produced the
# GameLine they're handed.
# ---------------------------------------------------------------------------


def game_lines_from_book_lines(rows: list, games: list) -> list[GameLine]:
    """Aggregates per-bookmaker game_odds_book_lines rows (already filtered
    to one source and one sport by the caller — see db.
    read_game_odds_book_lines_for_source) into real GameLine objects, one
    per game that has at least one row. Best-price-per-side summary
    (largest American number wins), same "best available" convention as
    summarise_odds_event above — every bookmaker's own row is retained in
    `bookmakers` regardless.

    `games` is the real current slate (predict.odds_lines_cycle.
    SnapshotGame) — a row whose game_id doesn't match any current game is
    silently ignored (a stale row for a game no longer on today's slate),
    matching the same discipline _game_odds_book_line_rows itself already
    uses in reverse.
    """
    games_by_id = {g.game_pk: g for g in games}
    by_game: dict[str, dict[str, BookmakerOdds]] = {}

    for r in rows:
        game = games_by_id.get(r.game_id)
        if game is None:
            continue
        book_map = by_game.setdefault(r.game_id, {})
        entry = book_map.setdefault(r.bookmaker, BookmakerOdds(bookmaker=r.bookmaker))
        decimal_odds = r.decimal_odds if r.decimal_odds is not None else american_to_decimal(r.american_odds)

        if r.market == "moneyline":
            if r.side == "home":
                entry.home_odds = decimal_odds
            elif r.side == "away":
                entry.away_odds = decimal_odds
            elif r.side == "draw":
                entry.draw_odds = decimal_odds
        elif r.market == "spread":
            if r.side == "home":
                entry.spread_home, entry.spread_home_price = r.point, decimal_odds
            elif r.side == "away":
                entry.spread_away, entry.spread_away_price = r.point, decimal_odds
        elif r.market == "total":
            entry.point = r.point
            if r.side == "over":
                entry.over_price = decimal_odds
            elif r.side == "under":
                entry.under_price = decimal_odds

    lines: list[GameLine] = []
    for game_id, book_map in by_game.items():
        game = games_by_id[game_id]
        line = GameLine(
            event_id=game_id,
            commence_time=game.first_pitch or "",
            home_team=game.home_team_name or "",
            away_team=game.away_team_name or "",
            bookmakers=list(book_map.values()),
            book_count=len(book_map),
        )
        for r in rows:
            if r.game_id != game_id:
                continue
            american = r.american_odds
            if r.market == "moneyline":
                if line.moneyline is None:
                    line.moneyline = MoneylineSummary()
                if r.side == "home" and (line.moneyline.home is None or american > line.moneyline.home):
                    line.moneyline.home, line.moneyline.book = american, r.bookmaker
                if r.side == "away" and (line.moneyline.away is None or american > line.moneyline.away):
                    line.moneyline.away, line.moneyline.book = american, r.bookmaker
            elif r.market == "spread":
                if line.spread is None:
                    line.spread = SpreadSummary()
                if r.side == "home" and (line.spread.home_price is None or american > line.spread.home_price):
                    line.spread.home_point, line.spread.home_price, line.spread.book = r.point, american, r.bookmaker
                if r.side == "away" and (line.spread.away_price is None or american > line.spread.away_price):
                    line.spread.away_point, line.spread.away_price, line.spread.book = r.point, american, r.bookmaker
            elif r.market == "total":
                if line.total is None:
                    line.total = TotalSummary()
                if r.side == "over" and (line.total.over_price is None or american > line.total.over_price):
                    line.total.point = r.point if r.point is not None else line.total.point
                    line.total.over_price, line.total.book = american, r.bookmaker
                if r.side == "under" and (line.total.under_price is None or american > line.total.under_price):
                    line.total.point = line.total.point if line.total.point is not None else r.point
                    line.total.under_price, line.total.book = american, r.bookmaker
        lines.append(line)
    return lines


# ---------------------------------------------------------------------------
# JSON shape — MUST match the real TS GameLine interface's camelCase field
# names exactly (see module docstring). Round-trips through the shared
# odds_cache table.
# ---------------------------------------------------------------------------


def _drop_none(d: dict) -> dict:
    """Matches JSON.stringify's own behavior on a TS object with optional
    (`?:`) fields left unset: an undefined-valued key is DROPPED from the
    output entirely, not written as `null`. Python has no undefined/unset
    distinct from None, so every optional field here must be filtered at
    serialize time — writing an explicit `null` is a real, observable shape
    difference from what TS itself produces and stores in this same shared
    table (the same class of bug CLAUDE.md's game_context.py note
    describes), not merely a cosmetic one."""
    return {k: v for k, v in d.items() if v is not None}


def _bookmaker_to_json(b: BookmakerOdds) -> dict:
    return _drop_none(
        {
            "bookmaker": b.bookmaker,
            "homeOdds": b.home_odds,
            "awayOdds": b.away_odds,
            "overPrice": b.over_price,
            "underPrice": b.under_price,
            "point": b.point,
            "spreadHome": b.spread_home,
            "spreadHomePrice": b.spread_home_price,
            "spreadAway": b.spread_away,
            "spreadAwayPrice": b.spread_away_price,
        }
    )


def _game_line_to_json(line: GameLine) -> dict:
    out = {
        "eventId": line.event_id,
        "commenceTime": line.commence_time,
        "homeTeam": line.home_team,
        "awayTeam": line.away_team,
        "bookmakers": [_bookmaker_to_json(b) for b in line.bookmakers],
        "bookCount": line.book_count,
    }
    if line.moneyline is not None:
        out["moneyline"] = _drop_none({"home": line.moneyline.home, "away": line.moneyline.away, "book": line.moneyline.book})
    if line.spread is not None:
        out["spread"] = _drop_none(
            {
                "homePoint": line.spread.home_point,
                "homePrice": line.spread.home_price,
                "awayPoint": line.spread.away_point,
                "awayPrice": line.spread.away_price,
                "book": line.spread.book,
            }
        )
    if line.total is not None:
        out["total"] = _drop_none({"point": line.total.point, "overPrice": line.total.over_price, "underPrice": line.total.under_price, "book": line.total.book})
    return out


def _game_line_from_json(d: dict) -> GameLine:
    ml = d.get("moneyline")
    sp = d.get("spread")
    tot = d.get("total")
    return GameLine(
        event_id=d.get("eventId"),
        commence_time=d.get("commenceTime"),
        home_team=d.get("homeTeam"),
        away_team=d.get("awayTeam"),
        moneyline=MoneylineSummary(home=ml.get("home"), away=ml.get("away"), book=ml.get("book")) if ml else None,
        spread=(
            SpreadSummary(home_point=sp.get("homePoint"), home_price=sp.get("homePrice"), away_point=sp.get("awayPoint"), away_price=sp.get("awayPrice"), book=sp.get("book"))
            if sp
            else None
        ),
        total=TotalSummary(point=tot.get("point"), over_price=tot.get("overPrice"), under_price=tot.get("underPrice"), book=tot.get("book")) if tot else None,
        bookmakers=[
            BookmakerOdds(
                bookmaker=b.get("bookmaker"),
                home_odds=b.get("homeOdds"),
                away_odds=b.get("awayOdds"),
                over_price=b.get("overPrice"),
                under_price=b.get("underPrice"),
                point=b.get("point"),
                spread_home=b.get("spreadHome"),
                spread_home_price=b.get("spreadHomePrice"),
                spread_away=b.get("spreadAway"),
                spread_away_price=b.get("spreadAwayPrice"),
            )
            for b in (d.get("bookmakers") or [])
        ],
        book_count=d.get("bookCount") or 0,
    )


# ---------------------------------------------------------------------------
# Fetch + cache
# ---------------------------------------------------------------------------


@dataclass
class GameLinesResult:
    enabled: bool
    lines: list[GameLine]
    fetched_at: str | None
    from_cache: bool
    requests_remaining: int | None
    requests_used: int | None
    next_refresh_at: str | None
    warnings: list[str]


def _disabled(warning: str) -> GameLinesResult:
    return GameLinesResult(enabled=False, lines=[], fetched_at=None, from_cache=False, requests_remaining=None, requests_used=None, next_refresh_at=None, warnings=[warning])


def _parse_epoch_ms(iso_str: str) -> float:
    s = iso_str[:-1] + "+00:00" if iso_str.endswith("Z") else iso_str
    return datetime.fromisoformat(s).timestamp() * 1000


async def get_mlb_game_lines(client: httpx.AsyncClient, force: bool = False) -> GameLinesResult:
    """Fetch MLB game lines, honouring the cache TTL and the
    remaining-credit reserve. `force` bypasses the TTL but never the reserve."""
    api_key = config.ODDS_API_KEY
    ttl_minutes = config.ODDS_API_TTL_MINUTES
    markets = config.ODDS_API_MARKETS
    reserve = config.ODDS_API_RESERVE

    if not api_key:
        return _disabled("ODDS_API_KEY is not set — game lines are turned off.")

    cache_key = f"{SPORT_KEY}:{markets}:us"
    cached = await db.read_odds_cache(cache_key)
    warnings: list[str] = []

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    age_minutes = (now_ms - _parse_epoch_ms(cached.fetched_at)) / 60000 if cached else float("inf")
    fresh = age_minutes < ttl_minutes

    def serve_cache(extra_warnings: list[str] | None = None) -> GameLinesResult:
        lines = [_game_line_from_json(d) for d in json.loads(cached.payload)] if cached else []
        next_refresh_at = None
        if cached:
            next_refresh_at = datetime.fromtimestamp((_parse_epoch_ms(cached.fetched_at) + ttl_minutes * 60000) / 1000, tz=timezone.utc).isoformat()
        return GameLinesResult(
            enabled=True,
            lines=lines,
            fetched_at=cached.fetched_at if cached else None,
            from_cache=True,
            requests_remaining=cached.requests_remaining if cached else None,
            requests_used=cached.requests_used if cached else None,
            next_refresh_at=next_refresh_at,
            warnings=[*warnings, *(extra_warnings or [])],
        )

    if cached and fresh and not force:
        return serve_cache()

    # Never spend the last of the month's budget on an automatic refresh.
    if cached and cached.requests_remaining is not None and cached.requests_remaining <= reserve:
        return serve_cache([f"Only {cached.requests_remaining} Odds API credits remain this month, so lines are no longer auto-refreshing. Showing the last fetch."])

    url = f"{BASE}/sports/{SPORT_KEY}/odds/"
    params = {"apiKey": api_key, "regions": "us", "markets": markets, "oddsFormat": "american", "dateFormat": "iso"}

    try:
        res = await client.get(url, params=params, timeout=httpx.Timeout(20.0))
    except httpx.HTTPError as e:
        if cached:
            return serve_cache([f"Could not reach the Odds API ({type(e).__name__}: {e}). Showing the last fetch."])
        return GameLinesResult(enabled=True, lines=[], fetched_at=None, from_cache=False, requests_remaining=None, requests_used=None, next_refresh_at=None, warnings=["Could not reach the Odds API and there is no cached copy yet."])

    remaining_raw = res.headers.get("x-requests-remaining")
    used_raw = res.headers.get("x-requests-used")
    try:
        requests_remaining = int(remaining_raw) if remaining_raw is not None else None
    except ValueError:
        requests_remaining = None
    try:
        requests_used = int(used_raw) if used_raw is not None else None
    except ValueError:
        requests_used = None

    if res.status_code != 200:
        detail = "The Odds API rejected the key." if res.status_code == 401 else f"Odds API error {res.status_code}."
        if cached:
            return serve_cache([f"{detail} Showing the last successful fetch."])
        return GameLinesResult(enabled=True, lines=[], fetched_at=None, from_cache=False, requests_remaining=requests_remaining, requests_used=requests_used, next_refresh_at=None, warnings=[f"{detail} {res.text[:160]}"])

    events = res.json()
    lines = [summarise_odds_event(ev) for ev in events]

    payload = json.dumps([_game_line_to_json(l) for l in lines])
    await db.write_odds_cache(cache_key, payload, requests_remaining, requests_used)

    if requests_remaining is not None and requests_remaining <= reserve * 2:
        warnings.append(f"{requests_remaining} Odds API credits left this month.")

    fetched_at = datetime.now(timezone.utc)
    return GameLinesResult(
        enabled=True,
        lines=lines,
        fetched_at=fetched_at.isoformat(),
        from_cache=False,
        requests_remaining=requests_remaining,
        requests_used=requests_used,
        next_refresh_at=datetime.fromtimestamp(fetched_at.timestamp() + ttl_minutes * 60, tz=timezone.utc).isoformat(),
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Matching lines to the MLB slate
# ---------------------------------------------------------------------------


def _normalize_team(name: str) -> str:
    """Matches TS's name.toLowerCase().replace(/[^a-z]/g, '') exactly —
    ASCII a-z only, not Python's str.isalpha() (which is unicode-aware and
    would keep accented/non-Latin letters TS's regex strips)."""
    return "".join(c for c in name.lower() if "a" <= c <= "z")


def index_lines_by_matchup(lines: list[GameLine]) -> dict[str, GameLine]:
    """Key a line set by "AWAY@HOME" using MLB's own team names, so a
    caller can look a game up without a fuzzy search per render."""
    return {f"{_normalize_team(line.away_team)}@{_normalize_team(line.home_team)}": line for line in lines}


def lookup_line(index: dict[str, GameLine], away_team_name: str, home_team_name: str) -> GameLine | None:
    return index.get(f"{_normalize_team(away_team_name)}@{_normalize_team(home_team_name)}")
