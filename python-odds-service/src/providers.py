"""Provider fetch functions — now wired to entity_resolution.py, producing
real normalized rows (db.PropOddsInput) instead of just match counts. Every
raw field name below was re-verified against the current TS source
line-by-line before writing this (sharpapi.ts, oddsApiIo.ts,
sportsGameOdds.ts, propline.ts, parlayApi.ts), not reconstructed from memory
— a wrong field name here is exactly the "silent corruption across every
provider" risk entityResolution.ts's own header comment warns about.

Still NOT calling db.write_prop_odds anywhere in this file — entity
resolution is wired in (rows are actually normalized, unresolved rows are
actually tracked), but persisting them is the separate, still-pending
decision. jobs.py surfaces resolved/unresolved counts in its summaries so
real resolution rates are visible without turning on real writes yet.

Constraint 1 (docs/phase2-python-service-architecture-2026-08-19.md):
ParlayAPI and SharpAPI return a whole-sport board in one call. Uses the
documented FALLBACK, not true ijson streaming — fetch the full response,
then immediately extract only the fields needed (now: player/market/
bookmaker/line/price, not just team names, since real normalization needs
them) and discard the rest of each raw row in the same pass.
"""
import asyncio
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Literal

import httpx

import rate_limit
from db import PropOddsInput
from entity_resolution import (
    RosterIndex,
    UnresolvedRow,
    build_roster_index,
    normalize_bookmaker,
    resolve_market_key,
    resolve_player,
    unresolved_bookmaker,
    unresolved_market,
    unresolved_player,
)
from game_context import Game

TIMEOUT = httpx.Timeout(15.0)


def _decimal_to_american(decimal: float | None) -> int | None:
    """Matches lib/odds/display.ts's decimalToAmerican exactly."""
    if decimal is None or decimal <= 1:
        return None
    return round((decimal - 1) * 100) if decimal >= 2 else round(-100 / (decimal - 1))


@dataclass
class FetchOutcome:
    provider_id: str
    rows: list[PropOddsInput] = field(default_factory=list)
    unresolved: list[UnresolvedRow] = field(default_factory=list)
    requests: int = 0
    objects: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def rows_matched(self) -> int:
        return len(self.rows)


@dataclass
class ProviderSpec:
    """Declarative description of one provider's role in one job — the
    plug-and-play unit job_runner.py's run_provider_specs() consumes. This
    is the backend half of the sport-adapter convention CLAUDE.md documents
    for the frontend: instead of every job hand-rolling its own cap-check /
    fetch / spend-record / write sequence (four near-duplicate copies of
    that existed before this, see docs/phase2-hardening-gameplan-2026-08-20.md
    items 3-4 for what silently ran unrated/unrecorded as a result), a job
    just declares a list of these and the shared runner does the rest.
    Adding a new sport or provider means adding a ProviderSpec, not a new
    hand-written job function.

    `fetch` is always called as `fetch(client, games, yield_fn)` regardless
    of what the underlying fetch_* function in this file actually needs —
    each spec's construction site (jobs.py) closes over whatever
    provider-specific args (api_key, sport, rate_per_x) that real function
    takes, so every spec looks identical to the runner.
    """

    provider_id: str
    enabled: bool
    fetch: Callable[[httpx.AsyncClient, list[Game], object], Awaitable["FetchOutcome"]]
    # "none": no persisted budget gate (e.g. SharpAPI — job-level call
    #   frequency already keeps it well under its per-minute vendor limit).
    # "daily": gate against db.daily_status, calendar-day counter.
    # "monthly": gate against db.monthly_status, calendar-month counter.
    cap_kind: Literal["none", "daily", "monthly"] = "none"
    # The number cap_kind actually gates on — NOT always the vendor's hard
    # limit. Mirrors each provider's real TS gate exactly: daily providers
    # (Odds-API.io, Propline) gate on their hard dailyLimit; SportsGameOdds
    # gates on its SOFT cap, leaving real headroom below the hard
    # monthlyLimit; ParlayAPI gates on its hard monthlyLimit. Set per-spec
    # in jobs.py to match — this field doesn't encode which one, so get the
    # right config constant at the call site.
    cap_limit: int | None = None
    spend_unit: Literal["requests", "objects"] = "requests"


def _team_match(row_home: str, row_away: str, game: Game) -> bool:
    return (row_home == game.home_team_name and row_away == game.away_team_name) or (
        row_home == game.away_team_name and row_away == game.home_team_name
    )


def _normalize_row(
    out: FetchOutcome,
    game: Game,
    roster_index: RosterIndex,
    raw_player_name: str,
    raw_market_label: str,
    raw_bookmaker: str,
    context: str,
    side: str,
    line: float | None,
    american_odds: int,
    decimal_odds: float | None,
    is_delayed: bool = False,
    delay_seconds: int | None = None,
) -> None:
    """Shared resolve-bookmaker -> resolve-market -> resolve-player pipeline
    every TS adapter follows, in the same order (so a row with multiple
    unresolvable fields lands in the same unresolved *category* the TS
    version would report it under). Appends to out.rows or out.unresolved —
    doesn't return anything, mirrors the push-as-you-go style of the
    original adapters rather than building an intermediate list.
    """
    bookmaker = normalize_bookmaker(raw_bookmaker)
    if not bookmaker:
        out.unresolved.append(unresolved_bookmaker(raw_bookmaker, context))
        return
    market_key = resolve_market_key(raw_market_label)
    if not market_key:
        out.unresolved.append(unresolved_market(raw_market_label, f"player {raw_player_name}"))
        return
    player = resolve_player(raw_player_name, game.home_abbr, roster_index) or resolve_player(
        raw_player_name, game.away_abbr, roster_index
    )
    if not player:
        out.unresolved.append(unresolved_player(raw_player_name, context))
        return
    out.rows.append(
        PropOddsInput(
            provider_id=out.provider_id,
            game_id=game.game_id,
            subject_id=player.subject_id,
            subject_name=player.subject_name,
            market_key=market_key,
            line=line,
            side=side,
            bookmaker=bookmaker,
            american_odds=american_odds,
            decimal_odds=decimal_odds,
            is_delayed=is_delayed,
            delay_seconds=delay_seconds,
        )
    )


async def fetch_sharpapi(client: httpx.AsyncClient, api_key: str, games: list[Game]) -> FetchOutcome:
    out = FetchOutcome(provider_id="sharpapi")
    if not games:
        return out
    url = "https://api.sharpapi.io/api/v1/odds?sport=baseball&league=mlb&is_player_prop=true&limit=500"
    try:
        res = await client.get(url, headers={"X-API-Key": api_key}, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        out.warnings.append(f"sharpapi request failed: {e}")
        return out
    out.requests = 1
    if res.status_code != 200:
        out.warnings.append(f"sharpapi HTTP {res.status_code}")
        return out

    body = res.json()  # fallback materialization — see module docstring
    raw_rows = body.get("data") or []
    delay_seconds = (body.get("meta") or {}).get("tier", {}).get("data_delay_seconds") or 0
    # Immediately compact: keep only the fields sharpapi.ts:297-338 actually
    # uses (sportsbook, event_id, home/away, player_name, stat_category,
    # selection_type, line, odds_american, odds_decimal) — drop the rest of
    # each verbose raw row right away, matching Constraint 1's discipline.
    compact = [
        (
            r.get("home_team"),
            r.get("away_team"),
            r.get("event_id"),
            r.get("player_name"),
            r.get("stat_category"),
            r.get("sportsbook"),
            r.get("selection_type"),
            r.get("line"),
            r.get("odds_american"),
            r.get("odds_decimal"),
        )
        for r in raw_rows
        if r.get("player_name") and r.get("stat_category")
    ]
    del raw_rows, body

    for game in games:
        roster_index = build_roster_index(game.roster)
        for home, away, event_id, player_name, stat_category, sportsbook, selection_type, line, american, decimal in compact:
            if not _team_match(home, away, game):
                continue
            if american is None:
                continue
            _normalize_row(
                out,
                game,
                roster_index,
                raw_player_name=player_name,
                raw_market_label=stat_category,
                raw_bookmaker=sportsbook,
                context=f"sharpapi event {event_id}",
                side=selection_type,
                line=line,
                american_odds=american,
                decimal_odds=decimal,
                is_delayed=delay_seconds > 0,
                delay_seconds=delay_seconds,
            )
    return out


# Same 5-minute events cache oddsApiIo.ts's own `eventsCache`/`EVENTS_TTL_MS`
# has — this was missing from the first pass of this harness, which meant
# every single Tier1 cycle re-hit the events endpoint instead of reusing it
# across the whole cache window, burning through the vendor's hourly rate
# limit far faster than the real TS code would (confirmed live: every cycle
# 429'd on this endpoint in the first extended run). A module-level single
# var, not a dict, matches the TS code exactly — only one sport (MLB) is
# ever fetched through this provider.
_ODDSAPIIO_EVENTS_TTL_S = 5 * 60
_oddsapiio_events_cache: tuple[float, list] | None = None


async def _get_oddsapiio_events(client: httpx.AsyncClient, api_key: str) -> tuple[list, bool]:
    """Returns (events, was_fetched) — was_fetched controls whether this
    counts as real request spend, mirroring oddsApiIo.ts's own cost accounting."""
    global _oddsapiio_events_cache
    now = time.monotonic()
    if _oddsapiio_events_cache and now - _oddsapiio_events_cache[0] < _ODDSAPIIO_EVENTS_TTL_S:
        return _oddsapiio_events_cache[1], False

    res = await client.get(f"https://api.odds-api.io/v3/events?sport=baseball&apiKey={api_key}", timeout=TIMEOUT)
    if res.status_code != 200:
        # Serve stale cache on a failed refresh, same fallback oddsApiIo.ts uses.
        if _oddsapiio_events_cache:
            return _oddsapiio_events_cache[1], True
        raise RuntimeError(f"oddsapiio events HTTP {res.status_code}")
    events = res.json()
    _oddsapiio_events_cache = (now, events)
    return events, True


_ODDSAPIIO_ODDS_RATE_KEY = "oddsapiio_odds"


def _split_player_label(label: str) -> tuple[str, str] | None:
    """Matches oddsApiIo.ts's splitPlayerLabel exactly: "Zach McKinstry
    (Hits+Runs+RBIs)" -> ("Zach McKinstry", "Hits+Runs+RBIs")."""
    import re

    m = re.match(r"^(.+?)\s*\(([^)]+)\)\s*$", label)
    if not m:
        return None
    return m.group(1).strip(), m.group(2).strip()


async def fetch_oddsapiio(
    client: httpx.AsyncClient, api_key: str, games: list[Game], rate_per_hour: int = 100
) -> FetchOutcome:
    """Real production incident, 2026-08-19: this had zero rate-awareness on
    the per-game odds calls (the events call was already cached, but each
    game's own odds call was not, by design — matching oddsApiIo.ts, which
    never caches per-game odds either). Tier 1's real cadence (up to 15
    games, every ~2.5 min) generates ~360 calls/hour against a
    vendor-confirmed real cap of 100/hour (`x-ratelimit-limit: 100` on a
    live 429 response) — not a code bug in isolation, a genuine capacity
    ceiling nothing was checking.

    Unlike SportsGameOdds's per-minute cap (where NFL/CFB can afford to wait
    out a ~60s window via yield_fn), waiting out an HOURLY window would mean
    blocking Tier 1 — a 2.5-minute job — for up to nearly an hour. That's
    never the right answer here. Instead: once hourly capacity is spent,
    stop and skip the remaining games for THIS cycle, same "skip once
    exhausted, pick up next cycle" discipline tier1Refresh.ts's own
    dailyLimit handling already uses for this exact provider, just applied
    to the hourly cap this harness was missing entirely.

    Also fixes the confirmed missing backoff: a real 429 despite our own
    tracking saying capacity should exist (clock drift, other traffic on the
    account) now immediately marks the window exhausted via
    rate_limit.force_exhausted(), so the loop stops rather than continuing
    to hammer every remaining game with more doomed requests.
    """
    out = FetchOutcome(provider_id="oddsapiio")
    if not games:
        return out
    try:
        events, was_fetched = await _get_oddsapiio_events(client, api_key)
    except httpx.HTTPError as e:
        out.warnings.append(f"oddsapiio events request failed: {e}")
        return out
    except RuntimeError as e:
        out.warnings.append(str(e))
        return out
    if was_fetched:
        out.requests += 1

    skipped_for_capacity = 0
    for game in games:
        match = next(
            (e for e in events if _team_match(e.get("home", ""), e.get("away", ""), game)),
            None,
        )
        if not match:
            continue

        if not rate_limit.within_rate(_ODDSAPIIO_ODDS_RATE_KEY, rate_per_hour, 3600.0):
            skipped_for_capacity += 1
            continue  # don't wait out an hourly window inside a 2.5-min job — next cycle picks this up

        try:
            odds_res = await client.get(
                f"https://api.odds-api.io/v3/odds?eventId={match['id']}&bookmakers=Fanatics,BetMGM&apiKey={api_key}",
                timeout=TIMEOUT,
            )
        except httpx.HTTPError as e:
            out.warnings.append(f"oddsapiio odds request failed for {game.game_id}: {e}")
            continue
        out.requests += 1
        if odds_res.status_code == 429:
            # Authoritative: the vendor just told us, for real, that we're
            # out of room — trust that over our own tracking and stop
            # issuing more calls in this cycle rather than hammering them.
            rate_limit.force_exhausted(_ODDSAPIIO_ODDS_RATE_KEY, rate_per_hour, 3600.0)
            out.warnings.append(f"oddsapiio odds HTTP 429 for {game.game_id} — backing off for the rest of this cycle")
            skipped_for_capacity += len(games) - games.index(game) - 1
            break
        if odds_res.status_code != 200:
            out.warnings.append(f"oddsapiio odds HTTP {odds_res.status_code} for {game.game_id}")
            continue

        odds_json = odds_res.json()
        roster_index = build_roster_index(game.roster)
        for bookmaker_raw, markets in (odds_json.get("bookmakers") or {}).items():
            props_market = next((m for m in markets if m.get("name") == "Player Props"), None)
            if not props_market:
                continue
            for entry in props_market.get("odds") or []:
                label = entry.get("label")
                if not label:
                    continue
                split = _split_player_label(label)
                if not split:
                    out.unresolved.append(unresolved_market(label, f"Odds-API.io {bookmaker_raw} — unparsed label"))
                    continue
                player_name, stat = split
                over_raw, under_raw = entry.get("over"), entry.get("under")
                over = float(over_raw) if over_raw and over_raw != "N/A" else None
                under = float(under_raw) if under_raw and under_raw != "N/A" else None
                for side, decimal in (("over", over), ("under", under)):
                    if decimal is None:
                        continue  # one-sided line — omit rather than fabricate the missing side
                    american = _decimal_to_american(decimal)
                    if american is None:
                        continue
                    _normalize_row(
                        out,
                        game,
                        roster_index,
                        raw_player_name=player_name,
                        raw_market_label=stat,
                        raw_bookmaker=bookmaker_raw,
                        context=f"Odds-API.io {bookmaker_raw}",
                        side=side,
                        line=entry.get("hdp"),
                        american_odds=american,
                        decimal_odds=decimal,
                    )

    if skipped_for_capacity:
        out.warnings.append(f"oddsapiio: skipped {skipped_for_capacity} game(s) this cycle — hourly cap ({rate_per_hour}/hr) reached")
    return out


_SGO_LEAGUE_IDS = {"mlb": "MLB", "nfl": "NFL", "cfb": "NCAAF"}


def _sgo_team_id(full_name: str, league_id: str) -> str:
    import re as _re

    slug = _re.sub(r"[^A-Z0-9]+", "_", full_name.upper().replace(".", "").replace("'", ""))
    slug = slug.strip("_")
    return f"{slug}_{league_id}"


def _sgo_name_from_player_id(player_id: str) -> str:
    """Matches sportsGameOdds.ts's nameFromPlayerId exactly: "ANGEL_GENAO_1_MLB" -> "Angel Genao"."""
    import re as _re

    stripped = _re.sub(r"_MLB$", "", player_id)
    stripped = _re.sub(r"_\d+$", "", stripped)
    return " ".join(p[:1] + p[1:].lower() for p in stripped.split("_") if p)


async def fetch_sportsgameodds(
    client: httpx.AsyncClient,
    api_key: str,
    games: list[Game],
    rate_per_min: int = 10,
    yield_fn=None,
) -> FetchOutcome:
    """Rate limiting is against the shared, process-wide counter in
    rate_limit.py (config.ts's SPORTSGAMEODDS_RATE_PER_MIN, default 10) —
    not a counter local to this one call. That was a real bug: three
    separate call sites (refreshSportsGameOddsJob, refreshNflJob,
    refreshCfbJob) each ran this function with its own local window, so back
    to back they'd each think they had a fresh 10/min allowance against the
    same real vendor-side limit. Confirmed live: the exact same 5 event IDs
    429'd across two runs 48 minutes apart — not random pressure, this
    specific gap.

    Resolved OPEN RISK (docs/phase2-python-service-architecture-2026-08-19.md):
    this is also the pacing-wait point NFL/CFB/the MLB SportsGameOdds job
    were blocking Tier 1 behind. `yield_fn`, when provided, is called
    instead of a blind sleep whenever capacity isn't immediately available —
    see job_queue.py's `maybe_yield`.
    """
    out = FetchOutcome(provider_id="sportsgameodds")

    for game in games:
        league_id = _SGO_LEAGUE_IDS.get(game.sport)
        if not league_id:
            continue

        while not rate_limit.within_rate("sportsgameodds", rate_per_min, 60.0):
            wait_hint = rate_limit.seconds_until_capacity("sportsgameodds", 60.0)
            yielded = await yield_fn(wait_hint) if yield_fn else False
            if not yielded:
                await asyncio.sleep(min(wait_hint, 1.0) + 0.05)

        home_id = _sgo_team_id(game.home_team_name, league_id)
        away_id = _sgo_team_id(game.away_team_name, league_id)
        url = (
            f"https://api.sportsgameodds.com/v2/events?leagueID={league_id}"
            f"&teamID={home_id},{away_id}&oddsAvailable=true&limit=5"
        )
        try:
            res = await client.get(url, headers={"X-Api-Key": api_key}, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            out.warnings.append(f"sportsgameodds request failed for {game.game_id}: {e}")
            continue
        if res.status_code == 429:
            rate_limit.force_exhausted("sportsgameodds", rate_per_min, 60.0)
            out.warnings.append(f"sportsgameodds HTTP 429 for {game.game_id} — backing off")
            continue
        if res.status_code != 200:
            out.warnings.append(f"sportsgameodds HTTP {res.status_code} for {game.game_id}")
            continue

        body = res.json()
        events = body.get("data") or []
        out.objects += len(events)
        roster_index = build_roster_index(game.roster)
        for event in events:
            players = event.get("players") or {}
            odds = event.get("odds") or {}
            for odd in odds.values():
                player_id = odd.get("playerID")
                if not player_id:
                    continue  # team/game-level market, not a player prop
                side = odd.get("sideID")
                if side not in ("over", "under"):
                    continue
                market_label = odd.get("statID")
                raw_name = (players.get(player_id) or {}).get("name") or _sgo_name_from_player_id(player_id)
                default_line = odd.get("bookOverUnder")
                default_line = float(default_line) if default_line is not None else None

                for book_raw, book in (odd.get("byBookmaker") or {}).items():
                    if not book.get("available"):
                        continue
                    try:
                        american = int(float(book.get("odds")))
                    except (TypeError, ValueError):
                        continue
                    book_ou = book.get("overUnder")
                    line = float(book_ou) if book_ou is not None else default_line
                    last_updated = book.get("lastUpdatedAt")
                    delay_seconds = None
                    if last_updated:
                        try:
                            from datetime import datetime, timezone

                            updated_dt = datetime.fromisoformat(last_updated.replace("Z", "+00:00"))
                            delay_seconds = round((datetime.now(timezone.utc) - updated_dt).total_seconds())
                        except ValueError:
                            pass
                    _normalize_row(
                        out,
                        game,
                        roster_index,
                        raw_player_name=raw_name,
                        raw_market_label=market_label,
                        raw_bookmaker=book_raw,
                        context=f"SportsGameOdds playerID {player_id}",
                        side=side,
                        line=line,
                        american_odds=american,
                        decimal_odds=None,
                        is_delayed=True,
                        delay_seconds=delay_seconds,
                    )
    return out


_PROPLINE_SPORT_KEYS = {"mlb": "baseball_mlb", "soccer_epl": "soccer_epl"}


async def fetch_propline(client: httpx.AsyncClient, api_key: str, games: list[Game], sport: str) -> FetchOutcome:
    out = FetchOutcome(provider_id="propline")
    sport_key = _PROPLINE_SPORT_KEYS.get(sport)
    if not sport_key or not games:
        return out
    try:
        events_res = await client.get(
            f"https://api.prop-line.com/v1/sports/{sport_key}/events?apiKey={api_key}", timeout=TIMEOUT
        )
    except httpx.HTTPError as e:
        out.warnings.append(f"propline events request failed: {e}")
        return out
    out.requests += 1
    if events_res.status_code != 200:
        out.warnings.append(f"propline events HTTP {events_res.status_code}")
        return out
    events = events_res.json()

    for game in games:
        match = next(
            (e for e in events if _team_match(e.get("home_team", ""), e.get("away_team", ""), game)), None
        )
        if not match:
            continue
        eid = match["id"]
        try:
            markets_res = await client.get(
                f"https://api.prop-line.com/v1/sports/{sport_key}/events/{eid}/markets?apiKey={api_key}",
                timeout=TIMEOUT,
            )
        except httpx.HTTPError as e:
            out.warnings.append(f"propline markets request failed for {game.game_id}: {e}")
            continue
        out.requests += 1
        if markets_res.status_code != 200:
            out.warnings.append(f"propline markets HTTP {markets_res.status_code} for {game.game_id}")
            continue
        market_keys = [m["key"] for m in (markets_res.json() or [])]
        if not market_keys:
            continue
        try:
            odds_res = await client.get(
                f"https://api.prop-line.com/v1/sports/{sport_key}/events/{eid}/odds"
                f"?apiKey={api_key}&markets={','.join(market_keys)}",
                timeout=TIMEOUT,
            )
        except httpx.HTTPError as e:
            out.warnings.append(f"propline odds request failed for {game.game_id}: {e}")
            continue
        out.requests += 1
        if odds_res.status_code != 200:
            out.warnings.append(f"propline odds HTTP {odds_res.status_code} for {game.game_id}")
            continue

        roster_index = build_roster_index(game.roster)
        for bm in odds_res.json().get("bookmakers") or []:
            bookmaker_raw = bm.get("key")
            for market in bm.get("markets") or []:
                market_label = market.get("key")
                for outcome in market.get("outcomes") or []:
                    raw_name = outcome.get("description") or outcome.get("name")
                    side = "under" if "under" in (outcome.get("name") or "").lower() else "over"
                    _normalize_row(
                        out,
                        game,
                        roster_index,
                        raw_player_name=raw_name,
                        raw_market_label=market_label,
                        raw_bookmaker=bookmaker_raw,
                        context=f"Propline {bookmaker_raw}",
                        side=side,
                        line=outcome.get("point"),
                        american_odds=outcome.get("price"),
                        decimal_odds=None,
                    )
    return out


_PARLAYAPI_SPORT_KEYS = {
    "mlb": "baseball_mlb",
    "nfl": "americanfootball_nfl",
    "cfb": "americanfootball_ncaaf",
    "soccer_epl": "soccer_epl",
}


async def fetch_parlayapi(client: httpx.AsyncClient, api_key: str, games: list[Game], sport: str) -> FetchOutcome:
    out = FetchOutcome(provider_id="parlayapi")
    sport_key = _PARLAYAPI_SPORT_KEYS.get(sport)
    if not sport_key or not games:
        return out
    try:
        res = await client.get(
            f"https://parlay-api.com/v1/sports/{sport_key}/props", headers={"X-API-Key": api_key}, timeout=TIMEOUT
        )
    except httpx.HTTPError as e:
        out.warnings.append(f"parlayapi request failed: {e}")
        return out

    if res.status_code == 403:
        # Confirmed live 2026-08-19: both keys are CREDIT_LIMIT_REACHED this
        # billing period. Expected, non-fatal — log and move on, don't crash
        # the job. See README.md for the prompt-injection note in this
        # response body, which is deliberately not read/acted on here.
        out.warnings.append("parlayapi: credit limit reached this billing period (expected, not a bug)")
        return out
    if res.status_code != 200:
        out.warnings.append(f"parlayapi HTTP {res.status_code}")
        return out

    out.requests = 1
    body = res.json()  # fallback materialization — see module docstring
    # Immediately compact: keep only the fields parlayApi.ts:38-48/99-147
    # actually uses, drop the rest of each raw row right away.
    compact = [
        (
            r.get("home_team"),
            r.get("away_team"),
            r.get("event_id"),
            r.get("player"),
            r.get("market"),
            r.get("bookmaker_title"),
            r.get("line"),
            r.get("over_price"),
            r.get("under_price"),
        )
        for r in body
    ]
    del body

    for game in games:
        roster_index = build_roster_index(game.roster)
        for home, away, event_id, player, market, bookmaker_title, line, over_price, under_price in compact:
            if not _team_match(home, away, game):
                continue
            for side, price in (("over", over_price), ("under", under_price)):
                if price is None:
                    continue
                _normalize_row(
                    out,
                    game,
                    roster_index,
                    raw_player_name=player,
                    raw_market_label=market,
                    raw_bookmaker=bookmaker_title,
                    context=f"parlayapi event {event_id}",
                    side=side,
                    line=line,
                    american_odds=price,
                    decimal_odds=None,
                )
    return out
