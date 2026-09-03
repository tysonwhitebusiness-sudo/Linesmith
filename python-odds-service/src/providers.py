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
from db import GameOddsBookLineInput, PropOddsInput
from entity_resolution import (
    RosterIndex,
    UnresolvedRow,
    build_roster_index,
    normalize_bookmaker,
    normalize_team_name,
    resolve_alt_line,
    resolve_market_key,
    resolve_player,
    team_name_words,
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
    # Real game-level moneyline/spread/total rows recovered from a provider's
    # existing player-prop response (or a genuinely separate game-lines call,
    # for providers where that's what it takes — see fetch_sharpapi_game_
    # lines below). Populating this is the entire "recover the data" fix per
    # provider: job_runner.py's run_provider_specs already writes whatever
    # lands here via db.write_game_odds_book_lines, the same shared table
    # the-odds-api and OddsHarvester already write into (source-keyed, so
    # every writer coexists without overwriting another's rows).
    game_line_rows: list[GameOddsBookLineInput] = field(default_factory=list)
    unresolved: list[UnresolvedRow] = field(default_factory=list)
    requests: int = 0
    objects: int = 0
    # The VENDOR said we are at a limit (HTTP 429), as opposed to us deciding we
    # are. Structured rather than left in `warnings` because job_runner acts on
    # it — a pooled key that 429s is marked exhausted so the pool fails over —
    # and matching on warning strings is exactly how that kind of coupling rots.
    rate_limited: bool = False
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
    # An EARLY stop below cap_limit (task 5.9, P2 H3). Where set, the effective
    # gate is min(soft_cap, cap_limit) and the warning names which one fired,
    # so "eased off deliberately" stays distinguishable from "ran out". 0 or
    # None means unset — gate on cap_limit alone, i.e. today's behaviour.
    soft_cap: int | None = None
    spend_unit: Literal["requests", "objects"] = "requests"
    # MINIMUM SECONDS BETWEEN RUNS OF THIS PROVIDER, independent of how often the
    # job it lives in ticks. None means "every cycle".
    #
    # A job's interval is one number, and the providers inside it do not share
    # economics. refreshTier1 ticks every 2.5 minutes, which is right for
    # SharpAPI (uncapped, 12 req/min) and ruinous for Propline (1,000/DAY, and
    # 1+2N requests per cycle): a 15-game MLB slate demanded 17,856 requests/day
    # against that 1,000 cap, so it died in ~80 minutes and contributed nothing
    # for the other 23 hours. Measured 2026-09-02 -- 1006, 1004, 1021, 1000,
    # 1000, 1001 on consecutive days, the vendor's own x-daily-used agreeing.
    #
    # Deliberately a flat floor, not the proximity-proportional allocation Phase
    # 1f adds. A floor stops the bleeding, is trivially verifiable, and does not
    # depend on event_start being populated for all eight sports first.
    min_interval_seconds: float | None = None

    # A KEY POOL: ordered ((provider_id, api_key), ...) for one vendor.
    #
    # A key is a BUDGET BUCKET, not a coverage grant. All five ParlayAPI keys
    # return the identical 405-sport catalogue, so naming one PARLAYAPI_NFL_KEY
    # did not make it an NFL key -- it stranded quota: NFL's key could exhaust on
    # a heavy Sunday while CFB's sat untouched, and NFL went dark anyway because
    # nothing could borrow the unused budget.
    #
    # Pooled, the runner reserves against each key IN ORDER and uses the first
    # with headroom. Quota becomes fungible across sports; capacity is added by
    # registering another free key rather than by rewiring a sport.
    #
    # Drained SEQUENTIALLY rather than round-robin. Both spend the same total,
    # but sequential means you always know how many keys remain and failure is
    # gradual, where round-robin exhausts every key at once. (Invert this only
    # for a provider capped on requests-per-MINUTE rather than budget, where
    # spreading buys real concurrency.)
    #
    # Per-key accounting needs no schema change: provider_usage already keys
    # spend by arbitrary provider_id strings. Per-SPORT attribution is not lost
    # either -- _run_timed's breadcrumb records requests per JOB, and jobs are
    # per sport.
    # How many budget units ONE cycle of this provider costs, given the slate.
    # A callable because the answer is not a constant: Propline issues 1 + N
    # requests for N games while ParlayAPI issues exactly 1 regardless, so a
    # single number would be wrong for one of them on every slate.
    #
    # When set, pace.next_interval computes the wait DYNAMICALLY from real
    # remaining budget instead of using the static min_interval_seconds floor —
    # spending what is left over the time that is left, weighted toward when
    # games actually start.
    cost_per_cycle: object | None = None
    pool: tuple[tuple[str, str], ...] | None = None
    # Called as fetch_keyed(client, games, yield_fn, api_key) when `pool` is set.
    fetch_keyed: Callable[..., Awaitable["FetchOutcome"]] | None = None

    @property
    def effective_cap(self) -> int | None:
        if self.cap_limit is None:
            return None
        if self.soft_cap:
            return min(self.soft_cap, self.cap_limit)
        return self.cap_limit


# Games a provider supplied no matching event for at all. A single
# _team_match returning False is NORMAL — every call site loops over a
# provider's whole event list looking for one game, so most comparisons are
# expected misses. The real failure, and the one P3 M13 is about, is a game
# that matched NOTHING, because that is the silent zero-row outcome. These are
# drained once per job run by job_runner.run_provider_specs and written to
# system_events as one aggregate row, rather than a database write per
# comparison inside a hot loop.
_TEAM_MATCH_MISSES: list[str] = []


def record_team_match_miss(provider_id: str, game: Game) -> None:
    _TEAM_MATCH_MISSES.append(f"{provider_id}: {game.away_team_name} @ {game.home_team_name} ({game.game_id})")


def drain_team_match_misses() -> list[str]:
    misses = list(_TEAM_MATCH_MISSES)
    _TEAM_MATCH_MISSES.clear()
    return misses


def _team_match(row_home: str, row_away: str, game: Game) -> bool:
    """Does this provider row describe this game?

    Task 5.8 (P3 M13). This was raw string equality, so a provider changing
    "LA Galaxy" to "Los Angeles Galaxy", or adding an accent to "Montreal",
    silently returned zero rows — the same class of failure as the 30-of-37
    game drop, and invisible because zero rows looks identical to "no odds
    offered". It now uses entity_resolution.normalize_team_name, the same
    normalisation harvester_scrape.py already proved against real live
    mismatches.

    Deliberately does NOT adopt harvester's loose substring-containment
    fallback. Harvester matches raw scraped names where a near-miss is the
    normal case; here both sides must match to attach a price to a game, so a
    false positive attaches odds to the WRONG game — strictly worse than a
    miss, which is at least visible in the drain above. Normalised equality
    and order-independent word-set equality are both exact, so both are safe.
    """
    home_n, away_n = normalize_team_name(row_home), normalize_team_name(row_away)
    g_home_n, g_away_n = normalize_team_name(game.home_team_name), normalize_team_name(game.away_team_name)
    if (home_n == g_home_n and away_n == g_away_n) or (home_n == g_away_n and away_n == g_home_n):
        return True
    # Order-independent word-set equality — "Red Bull New York" vs "New York
    # Red Bulls", verified live in MLS.
    home_w, away_w = team_name_words(row_home), team_name_words(row_away)
    g_home_w, g_away_w = team_name_words(game.home_team_name), team_name_words(game.away_team_name)
    if not (home_w and away_w and g_home_w and g_away_w):
        return False
    if (home_w == g_home_w and away_w == g_away_w) or (home_w == g_away_w and away_w == g_home_w):
        return True

    # SUBSET FALLBACK, added 2026-09-03. The provider's words must ALL appear in
    # ours, on BOTH sides.
    #
    # College football is why. ESPN names a team "Rutgers Scarlet Knights";
    # SportsGameOdds says "Rutgers" and SharpAPI says "Colorado" where ESPN says
    # "Colorado Buffaloes". Word-set EQUALITY therefore failed for every CFB row
    # from both providers -- measured live: SGO returned 0 events and SharpAPI 0
    # matched rows for a 178-game slate, in both cases with HTTP 200 and no
    # warning. Pro leagues were unaffected because everyone spells those with the
    # mascot, which is precisely why it survived so long.
    #
    # This is NOT harvester's one-sided containment, which `_team_match` still
    # declines above: BOTH sides must match, and the direction is fixed -- theirs
    # subset of ours, never the reverse. A generic provider name cannot widen to
    # swallow several of our games.
    #
    # Known residual: an abbreviation sharing no word with the full name still
    # misses -- "UMass" vs "Massachusetts Minutemen". Counted by callers rather
    # than guessed at, because attaching odds to the WRONG game is worse than
    # attaching none.
    return ((home_w <= g_home_w and away_w <= g_away_w)
            or (home_w <= g_away_w and away_w <= g_home_w))


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
    market_key_override: str | None = None,
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
    # An alt-line has ALREADY been resolved by the caller (task 5.1) — it
    # carries a line and a base market the raw label alone can't express.
    market_key = market_key_override or resolve_market_key(raw_market_label)
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


async def fetch_sharpapi(
    client: httpx.AsyncClient, api_key: str, games: list[Game], sport: str = "baseball", league: str = "mlb"
) -> FetchOutcome:
    out = FetchOutcome(provider_id="sharpapi")
    if not games:
        return out
    url = f"https://api.sharpapi.io/api/v1/odds?sport={sport}&league={league}&is_player_prop=true&limit=500"
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


_SHARPAPI_MONEYLINE_TYPE = "moneyline"
_SHARPAPI_SPREAD_TYPES = {"spread", "run_line", "puck_line", "point_spread"}
_SHARPAPI_TOTAL_TYPES = {"total_points", "total_runs", "total_goals"}


def _sharpapi_game_line_rows(
    compact: list[tuple], games: list[Game]
) -> list[GameOddsBookLineInput]:
    """Pure row-building step, split out from fetch_sharpapi_game_lines for
    direct unit testing (this codebase has no HTTP-mocking convention —
    every other provider's tests exercise the pure parsing logic directly,
    see test_providers.py). `compact` is a list of (home, away, sportsbook,
    market_type, team_side, selection_type, line, american_odds) tuples,
    already filtered to non-player, main-line rows."""
    rows: list[GameOddsBookLineInput] = []
    for game in games:
        for home, away, sportsbook, market_type, team_side, selection_type, line, american in compact:
            if not _team_match(home, away, game):
                continue
            if american is None or not sportsbook:
                continue

            if market_type == _SHARPAPI_MONEYLINE_TYPE:
                if team_side not in ("home", "away"):
                    continue
                market, side, point = "moneyline", team_side, None
            elif market_type in _SHARPAPI_SPREAD_TYPES:
                if team_side not in ("home", "away") or line is None:
                    continue
                market, side, point = "spread", team_side, line
            elif market_type in _SHARPAPI_TOTAL_TYPES:
                if selection_type not in ("over", "under") or line is None:
                    continue
                market, side, point = "total", selection_type, line
            else:
                continue

            rows.append(
                GameOddsBookLineInput(
                    sport=game.sport,
                    game_id=game.game_id,
                    market=market,
                    side=side,
                    bookmaker=sportsbook,
                    source="sharpapi",
                    american_odds=american,
                    point=point,
                )
            )
    return rows


async def fetch_sharpapi_game_lines(
    client: httpx.AsyncClient, api_key: str, games: list[Game], sport: str = "baseball", league: str = "mlb"
) -> FetchOutcome:
    """SharpAPI's team-level board — the `is_player_prop=false` variant of
    the same endpoint fetch_sharpapi already calls, ported from
    sharpapi.ts's getSharpApiGameLines (which only kept the single best
    price per side; this keeps every real bookmaker's own row instead,
    since the bookmaker grid needs all of them). A genuinely separate
    request, not a free second parse of the props response — SharpAPI's own
    documented free-tier limit is 12 req/min (sharpapi.ts's module
    docstring), and Tier 1's real cadence is roughly one cycle per 2.5 min,
    so even this second call type per cycle stays far under that; no daily
    cap needed on top of the existing cap_kind="none" the props spec
    already uses for the same reason.

    is_main_line filters out alternate lines — the grid shows the market's
    real number, not every juice variant a book offers around it.
    """
    out = FetchOutcome(provider_id="sharpapi_lines")
    if not games:
        return out
    url = f"https://api.sharpapi.io/api/v1/odds?sport={sport}&league={league}&is_player_prop=false&limit=500"
    try:
        res = await client.get(url, headers={"X-API-Key": api_key}, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        out.warnings.append(f"sharpapi game-lines request failed: {e}")
        return out
    out.requests = 1
    if res.status_code != 200:
        out.warnings.append(f"sharpapi game-lines HTTP {res.status_code}")
        return out

    body = res.json()  # fallback materialization — see module docstring
    raw_rows = body.get("data") or []
    compact = [
        (
            r.get("home_team"),
            r.get("away_team"),
            r.get("sportsbook"),
            r.get("market_type"),
            r.get("team_side"),
            r.get("selection_type"),
            r.get("line"),
            r.get("odds_american"),
        )
        for r in raw_rows
        if not r.get("is_player_prop") and r.get("is_main_line")
    ]
    del raw_rows, body

    out.game_line_rows = _sharpapi_game_line_rows(compact, games)
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


async def _get_oddsapiio_events(client: httpx.AsyncClient, api_key: str) -> tuple[list, bool, str | None]:
    """Returns (events, was_fetched, warning). was_fetched=True whenever a
    real HTTP request reached the vendor and got a response back — success,
    a cache-miss fallback, OR a real failure with no stale cache to serve —
    matching SharpAPI/Propline's "count the attempt, not just the success"
    discipline (their out.requests is set right after the response arrives,
    before checking status).

    Real, live-confirmed bug fixed here (2026-08-20): this used to raise
    RuntimeError on a failure-with-no-cache instead of returning, so the
    caller's `if was_fetched: out.requests += 1` never ran — while the
    vendor charged for that real 429 response regardless. The events call
    runs almost every Tier 1 cycle (90s cache vs. 2.5min job interval), so
    on its own it could burn the whole 500/day budget while our own tracker
    kept reading 0 spent, meaning the daily-cap pre-check could never
    actually engage. See docs/api-capability-audit-2026-08-20.md."""
    global _oddsapiio_events_cache
    now = time.monotonic()
    if _oddsapiio_events_cache and now - _oddsapiio_events_cache[0] < _ODDSAPIIO_EVENTS_TTL_S:
        return _oddsapiio_events_cache[1], False, None

    res = await client.get(f"https://api.odds-api.io/v3/events?sport=baseball&apiKey={api_key}", timeout=TIMEOUT)
    if res.status_code != 200:
        # Serve stale cache on a failed refresh, same fallback oddsApiIo.ts
        # uses — but a real request still happened and the vendor still
        # charged for it either way, so this must still count as spent.
        if _oddsapiio_events_cache:
            return _oddsapiio_events_cache[1], True, None
        return [], True, f"oddsapiio events HTTP {res.status_code}"
    events = res.json()
    _oddsapiio_events_cache = (now, events)
    return events, True, None


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
        events, was_fetched, events_warning = await _get_oddsapiio_events(client, api_key)
    except httpx.HTTPError as e:
        out.warnings.append(f"oddsapiio events request failed: {e}")
        return out
    if was_fetched:
        out.requests += 1
    if events_warning:
        out.warnings.append(events_warning)

    skipped_for_capacity = 0
    for game in games:
        match = next(
            (e for e in events if _team_match(e.get("home", ""), e.get("away", ""), game)),
            None,
        )
        if not match:
            # No event matched this game AT ALL — the silent zero-row outcome
            # P3 M13 is about. One _team_match miss is normal; this is not.
            record_team_match_miss(out.provider_id, game)
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
            out.rate_limited = True
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


# Verified live 2026-09-02 against SportsGameOdds' own /v2/leagues: its
# catalogue is exactly eight leagues -- NBA, UEFA_CHAMPIONS_LEAGUE, MLB, MLS,
# NCAAB, NCAAF, NFL, NHL. No EPL and no tennis, which is a real coverage gap,
# not an omission here. NHL was missing from this map though SGO serves it, so
# even a correctly-keyed NHL job would have fetched nothing.
_SGO_LEAGUE_IDS = {"mlb": "MLB", "nfl": "NFL", "cfb": "NCAAF", "soccer_mls": "MLS",
                   "nba": "NBA", "nhl": "NHL"}


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


_SGO_GAME_LEVEL_BET_TYPES = {"ml", "sp", "ou"}


def _sgo_game_line_rows(event: dict, sport: str, game_id: str) -> list[GameOddsBookLineInput]:
    """Real moneyline/spread/total, per real bookmaker, for one event —
    walks the exact same event["odds"] the player-prop loop below already
    receives in the same response (`if not player_id: continue` previously
    discarded every one of these rows). betTypeID 'ml'/'sp'/'ou',
    periodID 'game' (vs. inning/half-scoped), sideID confirmed live this
    session (MLB) — see sportsGameOdds.ts's getSportsGameOddsGameLine,
    which this reimplements at per-bookmaker granularity (every book's own
    price) rather than that function's best-price-only aggregation, since
    the bookmaker grid needs every book, not just the best one.
    """
    rows: list[GameOddsBookLineInput] = []
    for odd in (event.get("odds") or {}).values():
        if odd.get("playerID"):
            continue  # player prop, not a game-level line
        if odd.get("periodID") != "game":
            continue
        bet_type = odd.get("betTypeID")
        if bet_type not in _SGO_GAME_LEVEL_BET_TYPES:
            continue
        side_id = odd.get("sideID")

        for book_raw, book in (odd.get("byBookmaker") or {}).items():
            if not book.get("available"):
                continue
            try:
                american = int(float(book.get("odds")))
            except (TypeError, ValueError):
                continue

            if bet_type == "ml":
                if side_id not in ("home", "away"):
                    continue
                market, side, point = "moneyline", side_id, None
            elif bet_type == "sp":
                if side_id not in ("home", "away"):
                    continue
                spread_raw = book.get("spread")
                if spread_raw is None:
                    continue
                market, side, point = "spread", side_id, float(spread_raw)
            else:  # "ou"
                if side_id not in ("over", "under"):
                    continue
                ou_raw = book.get("overUnder")
                if ou_raw is None:
                    continue
                market, side, point = "total", side_id, float(ou_raw)

            rows.append(
                GameOddsBookLineInput(
                    sport=sport,
                    game_id=game_id,
                    market=market,
                    side=side,
                    bookmaker=book_raw,
                    source="sportsgameodds",
                    american_odds=american,
                    point=point,
                )
            )
    return rows


def _sgo_event_matches(event: dict, game: Game) -> bool:
    """Does this SportsGameOdds event describe this game?

    Replaces building a teamID string and filtering the API by it. That
    construction is `_sgo_team_id`, which uppercases the FULL ESPN team name --
    and it silently returned zero events for every CFB game ever fetched:

        SGO says      RUTGERS_NCAAF          UMASS_NCAAF
        we asked for  RUTGERS_SCARLET_KNIGHTS_NCAAF  MASSACHUSETTS_MINUTEMEN_NCAAF

    SGO uses the school name for NCAAF; ESPN includes the mascot. MLB and NFL
    were unaffected -- both sides spell those with the mascot
    (PITTSBURGH_PIRATES_MLB, SEATTLE_SEAHAWKS_NFL), which is exactly why this
    went unnoticed: the bug only bites the one league whose naming convention
    differs, and a wrong teamID returns HTTP 200 with an empty list rather than
    an error.

    Matching is strict-first, then a SUBSET fallback: SGO's words must all
    appear in ours, on BOTH sides. "Rutgers" is a subset of "Rutgers Scarlet
    Knights"; "Bethune-Cookman" of "Bethune-Cookman Wildcats". It does NOT
    accept a one-sided match, because attaching odds to the wrong game is worse
    than attaching none -- the same reasoning `_team_match` gives for refusing
    harvester's containment fallback.

    Known residual: an abbreviation that shares no word with the full name still
    misses -- "UMass" vs "Massachusetts Minutemen". Measured 9 of 10 real NCAAF
    fixtures resolve; the rest need an alias in entity_resolution, and are
    counted rather than guessed at.
    """
    teams = event.get("teams") or {}
    ev_home = ((teams.get("home") or {}).get("names") or {}).get("long") or ""
    ev_away = ((teams.get("away") or {}).get("names") or {}).get("long") or ""
    if not ev_home or not ev_away:
        return False
    # The subset rule now lives in _team_match itself, so every provider gets it
    # -- SharpAPI hit the identical CFB problem and would otherwise need its own
    # copy of the same logic.
    return _team_match(ev_home, ev_away, game)


async def fetch_sportsgameodds(
    client: httpx.AsyncClient,
    api_key: str,
    games: list[Game],
    rate_per_min: int = 10,
    yield_fn=None,
) -> FetchOutcome:
    """ONE REQUEST PER LEAGUE, not one per game.

    This used to issue a request for every game, filtered by a constructed
    teamID. That was both wrong for NCAAF (see _sgo_event_matches) and
    enormously wasteful: a 178-game CFB slate meant 178 requests per cycle,
    each capped at 5 events. A single league-wide call covers the whole slate.

    Rate limiting is against the shared, process-wide counter in rate_limit.py
    -- not a counter local to this call. That was a real bug: three separate
    call sites each ran this function with its own window against the same real
    vendor-side limit. Confirmed live at the time: the same 5 event IDs 429'd
    across two runs 48 minutes apart.

    `yield_fn`, when provided, is called instead of a blind sleep whenever
    capacity isn't immediately available -- see job_queue.py's `maybe_yield`.
    """
    out = FetchOutcome(provider_id="sportsgameodds")

    by_league: dict[str, list[Game]] = {}
    for game in games:
        league_id = _SGO_LEAGUE_IDS.get(game.sport)
        if league_id:
            by_league.setdefault(league_id, []).append(game)

    for league_id, league_games in by_league.items():
        while not rate_limit.within_rate("sportsgameodds", rate_per_min, 60.0):
            wait_hint = rate_limit.seconds_until_capacity("sportsgameodds", 60.0)
            yielded = await yield_fn(wait_hint) if yield_fn else False
            if not yielded:
                await asyncio.sleep(min(wait_hint, 1.0) + 0.05)
        # within_rate is check-and-consume: returning True already spent the
        # slot, so there is no separate record() call to make.

        # limit=100 covers a full CFB Saturday in one call; MLB/NFL slates are
        # far smaller. Deliberately not paginated: a slate larger than this
        # would be a real change worth noticing rather than silently absorbing,
        # and `unmatched` below makes it visible.
        url = (
            f"https://api.sportsgameodds.com/v2/events?leagueID={league_id}"
            f"&oddsAvailable=true&limit=100"
        )
        try:
            res = await client.get(url, headers={"X-Api-Key": api_key}, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            out.warnings.append(f"sportsgameodds request failed for {league_id}: {e}")
            continue
        if res.status_code == 429:
            rate_limit.force_exhausted("sportsgameodds", rate_per_min, 60.0)
            out.rate_limited = True
            out.warnings.append(f"sportsgameodds HTTP 429 for {league_id} — backing off")
            continue
        if res.status_code != 200:
            out.warnings.append(f"sportsgameodds HTTP {res.status_code} for {league_id}")
            continue

        body = res.json()
        events = body.get("data") or []
        out.objects += len(events)

        matched = 0
        for event in events:
            game = next((g for g in league_games if _sgo_event_matches(event, g)), None)
            if game is None:
                continue
            matched += 1
            roster_index = build_roster_index(game.roster)
            out.game_line_rows.extend(_sgo_game_line_rows(event, game.sport, game.game_id))
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

        # A silent zero is what hid the NCAAF bug for as long as it existed.
        # Say so when a league returns events that reach no game we know about.
        if events and not matched:
            out.warnings.append(
                f"sportsgameodds {league_id}: {len(events)} events, NONE matched a "
                f"loaded game — check team-name resolution"
            )
        elif len(events) - matched > 0:
            out.warnings.append(
                f"sportsgameodds {league_id}: {matched}/{len(events)} events matched"
            )
    return out


# Verified live 2026-09-02 against Propline's own /v1/sports (54 entries).
# Only mlb/soccer_epl/soccer_mls were wired, so five sports it already serves
# were never asked for. NOTE THE SPELLINGS: Propline uses `football_nfl` and
# `football_ncaaf`, NOT the `americanfootball_*` convention ParlayAPI uses --
# comparing the two by equality reads exactly like missing coverage, which is
# how an earlier audit of this project concluded Propline had no NFL at all.
_PROPLINE_SPORT_KEYS = {
    "mlb": "baseball_mlb", "nfl": "football_nfl", "cfb": "football_ncaaf",
    "nba": "basketball_nba", "nhl": "hockey_nhl",
    "soccer_epl": "soccer_epl", "soccer_mls": "soccer_mls",
    "tennis_atp": "tennis", "tennis_wta": "tennis",
}

# HALF OF PROPLINE'S ENTIRE SPEND WAS RE-ASKING WHICH MARKETS AN EVENT HAS.
#
# fetch_propline costs 1 + 2N requests for N games -- one /events call, then
# /markets AND /odds per game. Against a 1,000/day cap and refreshTier1's
# 2.5-minute cadence (576 cycles/day), a 15-game MLB slate demands 17,856
# requests/day, so the cap died in ~80 minutes and Propline contributed nothing
# for the other 23 hours (measured 2026-09-02: 1006, 1004, 1021, 1000, 1000,
# 1001 on consecutive days, with the vendor's own x-daily-used header agreeing).
#
# An event's market LIST is near-static -- it changes when a book adds or drops a
# market, not as prices move -- so caching it turns 1+2N into 1+N. That is a 50%
# cut before any scheduling change.
#
# The trade-off, stated honestly: a market added mid-window is missed until the
# entry expires. Worth it by a wide margin, because the status quo is not
# "slightly stale markets" but ZERO Propline data for 23 hours a day.
#
# In-process rather than snapshot_cache on purpose: the worker is one
# long-running process (render.yaml startCommand: python src/main.py), a DB
# round-trip per event would cost roughly what it saves in wall-clock, and losing
# the cache on restart is harmless -- it refills on the next cycle.
# 3 hours. Long enough to cut the cost hard, short enough that a market added
# in the morning is picked up well before an evening first pitch.
_PROPLINE_MARKETS_TTL = 3 * 60 * 60.0
_propline_markets_cache: dict[tuple[str, str], tuple[list[str], float]] = {}


def _propline_markets_cached(sport_key: str, eid: str) -> list[str] | None:
    hit = _propline_markets_cache.get((sport_key, str(eid)))
    if hit is None:
        return None
    keys, expires = hit
    if time.monotonic() >= expires:
        _propline_markets_cache.pop((sport_key, str(eid)), None)
        return None
    return keys


def _propline_markets_store(sport_key: str, eid: str, keys: list[str]) -> None:
    _propline_markets_cache[(sport_key, str(eid))] = (
        keys, time.monotonic() + _PROPLINE_MARKETS_TTL)

# the-odds-api-compatible market keys Propline's own /markets endpoint
# already returns alongside player-prop keys for an event — real, requested,
# real dollars already paid for in the same odds call, previously routed
# through _normalize_row's player-resolution pipeline (which has no player
# to resolve here, since these are team/total outcomes), landing every one
# of these rows in `unresolved` as a bogus "unresolved player" rather than
# ever reaching game_odds_book_lines.
_PROPLINE_GAME_LEVEL_MARKET_KEYS = {"h2h", "spreads", "totals"}


def _propline_game_line_rows(bookmakers: list[dict], game: Game, sport: str) -> list[GameOddsBookLineInput]:
    """Real moneyline ('h2h')/spread/total for one event, per real bookmaker
    — the the-odds-api-compatible shape (outcome.name is a team name for
    h2h/spreads, 'Over'/'Under' for totals; outcome.price is already
    American, matching this file's existing player-prop path which reads
    outcome.get('price') the same way with no conversion)."""
    rows: list[GameOddsBookLineInput] = []
    for bm in bookmakers:
        bookmaker_raw = bm.get("key")
        if not bookmaker_raw:
            continue
        for market in bm.get("markets") or []:
            market_key = market.get("key")
            if market_key not in _PROPLINE_GAME_LEVEL_MARKET_KEYS:
                continue
            for outcome in market.get("outcomes") or []:
                price = outcome.get("price")
                if price is None:
                    continue
                name = outcome.get("name") or ""
                if market_key == "totals":
                    if name.lower() not in ("over", "under"):
                        continue
                    market_out, side, point = "total", name.lower(), outcome.get("point")
                    if point is None:
                        continue
                else:
                    if name == game.home_team_name:
                        side = "home"
                    elif name == game.away_team_name:
                        side = "away"
                    else:
                        continue  # outcome name didn't match either team — don't guess
                    if market_key == "h2h":
                        market_out, point = "moneyline", None
                    else:  # "spreads"
                        market_out, point = "spread", outcome.get("point")
                        if point is None:
                            continue
                rows.append(
                    GameOddsBookLineInput(
                        sport=sport,
                        game_id=game.game_id,
                        market=market_out,
                        side=side,
                        bookmaker=bookmaker_raw,
                        source="propline",
                        american_odds=price,
                        point=point,
                    )
                )
    return rows


async def fetch_propline(
    client: httpx.AsyncClient, api_key: str, games: list[Game], sport: str, provider_id: str = "propline"
) -> FetchOutcome:
    """`provider_id` exists because this function serves TWO REAL VENDOR
    ACCOUNTS — `propline` (MLB) and `propline_2` (soccer) — and used to
    hardcode the first (task 5.2, Q36). Every propline_2 row, every unresolved
    entry, and every spend record was therefore filed under `propline`, so the
    two accounts silently shared one 1,000/day counter. That is why `propline`
    pins at exactly 1000/1001 every single day, and why propline_2 looked dead.

    Forward-only, per Q36: existing rows are NOT relabelled, because once
    written they are genuinely indistinguishable from propline's own."""
    out = FetchOutcome(provider_id=provider_id)
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
            record_team_match_miss(out.provider_id, game)
            continue
        eid = match["id"]
        market_keys = _propline_markets_cached(sport_key, eid)
        if market_keys is None:
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
            # Only a non-empty list is cached. An empty one usually means the
            # event is not priced YET, and caching that would suppress it for the
            # whole TTL -- exactly the games that matter as they approach start.
            if market_keys:
                _propline_markets_store(sport_key, eid, market_keys)
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

        bookmakers_json = odds_res.json().get("bookmakers") or []
        out.game_line_rows.extend(_propline_game_line_rows(bookmakers_json, game, sport))

        roster_index = build_roster_index(game.roster)
        for bm in bookmakers_json:
            bookmaker_raw = bm.get("key")
            for market in bm.get("markets") or []:
                market_label = market.get("key")
                if market_label in _PROPLINE_GAME_LEVEL_MARKET_KEYS:
                    continue  # handled by _propline_game_line_rows above — no player to resolve here
                for outcome in market.get("outcomes") or []:
                    raw_name = outcome.get("description") or outcome.get("name")
                    outcome_name = outcome.get("name") or ""
                    side = "under" if "under" in outcome_name.lower() else "over"
                    line = outcome.get("point")
                    market_key_override = None
                    # Task 5.1 (P2 C1, Q4). Propline encodes an alt-line in the
                    # market key ("batter_2plus_hits") or in the outcome name
                    # ("2+ Total Bases"), both with point=null. Both are folded
                    # onto the base market at the real line — "2+" is over 1.5,
                    # because a 2+ bet wins on exactly 2. Without this they
                    # arrived as an over at line=None, which is a proposition
                    # nothing can grade or price against.
                    alt = resolve_alt_line(market_label, outcome_name)
                    if alt is not None:
                        market_key_override, line = alt
                        side = "over"
                    _normalize_row(
                        out,
                        game,
                        roster_index,
                        raw_player_name=raw_name,
                        raw_market_label=market_label,
                        raw_bookmaker=bookmaker_raw,
                        context=f"Propline {bookmaker_raw}",
                        side=side,
                        line=line,
                        american_odds=outcome.get("price"),
                        decimal_odds=None,
                        market_key_override=market_key_override,
                    )
    return out


_PARLAYAPI_SPORT_KEYS = {
    "mlb": "baseball_mlb",
    "nfl": "americanfootball_nfl",
    "cfb": "americanfootball_ncaaf",
    "nba": "basketball_nba",
    # NHL added 2026-09-03 with Phase 1f. ParlayAPI's catalogue covers it (405
    # sports, verified live); it was simply never mapped, so NHL's pooled
    # parlayapi row would have fetched against a None sport key and returned
    # zero rows silently — the exact failure test_provider_matrix's
    # "every activated cell has a vendor token" check exists to prevent.
    "nhl": "icehockey_nhl",
    "soccer_epl": "soccer_epl",
    "soccer_mls": "soccer_usa_mls",
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
