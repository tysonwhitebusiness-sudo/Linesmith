"""Rough provider fetch functions — enough to make the real HTTP calls that
drive job duration, and count matched rows, not to write production-correct
prop_odds rows (see README.md for why that's deliberately out of scope for
this pass). No roster/player-name resolution, no market-key alias table —
just enough filtering to know which rows belong to which game.

Constraint 1 (docs/phase2-python-service-architecture-2026-08-19.md):
ParlayAPI and SharpAPI both return a whole-sport board in one call. This
uses the documented FALLBACK, not true ijson streaming — fetch the full
response, then immediately extract only the fields this harness needs
(dropping the rest of each row) and discard the raw parsed list in the same
pass, rather than holding both a raw and compact copy. True streaming was
explicitly deferred, not silently skipped — see the design doc for why.
"""
import asyncio
import time
from dataclasses import dataclass, field

import httpx

import rate_limit
from game_context import Game

TIMEOUT = httpx.Timeout(15.0)


@dataclass
class FetchOutcome:
    provider_id: str
    rows_matched: int = 0
    requests: int = 0
    objects: int = 0
    warnings: list[str] = field(default_factory=list)


def _team_match(row_home: str, row_away: str, game: Game) -> bool:
    return (row_home == game.home_team_name and row_away == game.away_team_name) or (
        row_home == game.away_team_name and row_away == game.home_team_name
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
    # Immediately compact: keep only the fields needed to match+count, drop
    # the rest of each row right away rather than holding the full objects.
    compact = [
        (r.get("home_team"), r.get("away_team"))
        for r in raw_rows
        if r.get("player_name") and r.get("stat_category")
    ]
    del raw_rows, body  # explicit — the verbose form's lifetime ends here

    for game in games:
        out.rows_matched += sum(1 for home, away in compact if _team_match(home, away, game))
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


async def fetch_oddsapiio(client: httpx.AsyncClient, api_key: str, games: list[Game]) -> FetchOutcome:
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

    for game in games:
        match = next(
            (e for e in events if _team_match(e.get("home", ""), e.get("away", ""), game)),
            None,
        )
        if not match:
            continue
        try:
            odds_res = await client.get(
                f"https://api.odds-api.io/v3/odds?eventId={match['id']}&bookmakers=Fanatics,BetMGM&apiKey={api_key}",
                timeout=TIMEOUT,
            )
        except httpx.HTTPError as e:
            out.warnings.append(f"oddsapiio odds request failed for {game.game_id}: {e}")
            continue
        out.requests += 1
        if odds_res.status_code != 200:
            out.warnings.append(f"oddsapiio odds HTTP {odds_res.status_code} for {game.game_id}")
            continue
        odds_json = odds_res.json()
        books = odds_json.get("bookmakers") or {}
        props = books.get("Player Props") or []
        out.rows_matched += len(props)
    return out


_SGO_LEAGUE_IDS = {"mlb": "MLB", "nfl": "NFL", "cfb": "NCAAF"}


def _sgo_team_id(full_name: str, league_id: str) -> str:
    import re as _re

    slug = _re.sub(r"[^A-Z0-9]+", "_", full_name.upper().replace(".", "").replace("'", ""))
    slug = slug.strip("_")
    return f"{slug}_{league_id}"


async def fetch_sportsgameodds(
    client: httpx.AsyncClient,
    api_key: str,
    games: list[Game],
    rate_per_min: int = 10,
    yield_fn=None,
) -> FetchOutcome:
    """Rate limiting is now against the shared, process-wide counter in
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
    see job_queue.py's `maybe_yield`. If nothing else is due, this falls
    back to a short poll-and-recheck (never a long blind sleep), so the loop
    stays responsive to yield opportunities that open up mid-wait.
    """
    out = FetchOutcome(provider_id="sportsgameodds")

    for game in games:
        league_id = _SGO_LEAGUE_IDS.get(game.sport)
        if not league_id:
            continue

        while not rate_limit.within_per_minute_rate("sportsgameodds", rate_per_min):
            wait_hint = rate_limit.seconds_until_capacity("sportsgameodds")
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
        if res.status_code != 200:
            out.warnings.append(f"sportsgameodds HTTP {res.status_code} for {game.game_id}")
            continue
        body = res.json()
        events = body.get("data") or []
        out.objects += len(events)
        for ev in events:
            odds = ev.get("odds") or {}
            out.rows_matched += len(odds)
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
        for bm in odds_res.json().get("bookmakers") or []:
            for mkt in bm.get("markets") or []:
                out.rows_matched += len(mkt.get("outcomes") or [])
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
    compact = [(r.get("home_team"), r.get("away_team")) for r in body]
    del body

    for game in games:
        out.rows_matched += sum(1 for home, away in compact if _team_match(home, away, game))
    return out
