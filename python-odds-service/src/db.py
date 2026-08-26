"""Postgres access — one asyncpg pool, shared by every job. Mirrors
lib/db/pgClient.ts's connection settings (Supabase's cert chain needs
rejectUnauthorized:false there; the equivalent here is an SSL context with
verification disabled) so this hits the exact same database the TS app uses.

Deliberately thin: no ORM, no query builder, just the handful of raw queries
this rough harness actually needs.

write_prop_odds is built and tested (see test_write_prop_odds.py) but NOT
called from anywhere in the live fetch path yet — same deliberate
disconnect as entity_resolution.py. Wiring the two together into an actual
write-enabled job is a separate decision, made once the rate-limit
situation is fully resolved.
"""
import json
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import asyncpg

from config import DATABASE_URL

_pool: asyncpg.Pool | None = None

_EASTERN = ZoneInfo("America/New_York")


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        _pool = await asyncpg.create_pool(dsn=DATABASE_URL, ssl=ctx, min_size=1, max_size=5)
    return _pool


async def read_snapshot(cache_key: str) -> str | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT payload FROM snapshot_cache WHERE cache_key = $1", cache_key)
    return row["payload"] if row else None


async def read_snapshot_with_age(cache_key: str) -> tuple[str, float] | None:
    """Same as read_snapshot but also returns age in seconds — mirrors
    lib/db/client.ts's readSnapshotCache (payload + fetchedAt), needed for
    TTL-checked caches like ESPN roster data (game_context.py). Returns None
    if the key doesn't exist."""
    pool = await get_pool()
    row = await pool.fetchrow("SELECT payload, fetched_at FROM snapshot_cache WHERE cache_key = $1", cache_key)
    if row is None:
        return None
    age = (datetime.now(timezone.utc) - row["fetched_at"]).total_seconds()
    return row["payload"], age


async def write_snapshot(cache_key: str, payload: str) -> None:
    """Generic snapshot write — mirrors lib/db/client.ts's writeSnapshotCache.
    Same table/shape TS uses, so a cache entry either app writes is readable
    by the other (e.g. ESPN roster data — game_context.py can now write its
    own instead of depending on the TS app having run recently)."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO snapshot_cache (cache_key, payload, fetched_at)
        VALUES ($1, $2, now())
        ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
        """,
        cache_key,
        payload,
    )


def eastern_date_key(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.astimezone(_EASTERN).strftime("%Y-%m-%d")


def eastern_month_key(now: datetime | None = None) -> str:
    return eastern_date_key(now)[:7]


def utc_date_key(now: datetime | None = None) -> str:
    """Day-boundary for the DAILY-cap providers specifically (Odds-API.io,
    Propline, Propline_2) — live-confirmed 2026-08-20 via each vendor's own
    response headers (`x-daily-reset`, and Odds-API.io's error text) that
    they all reset at midnight UTC, not midnight Eastern. Using
    eastern_date_key() here undercounted real spend for up to ~4-5 hours
    every single day (the EDT/UTC offset), which is very likely why
    Odds-API.io's real account showed "500/500 exhausted" while this
    harness's own tracker read 0 spent — see
    docs/api-capability-audit-2026-08-20.md. Monthly-cap providers
    (SportsGameOdds, ParlayAPI) keep eastern_month_key() — a calendar month
    only disagrees between timezones in a few-hour window once a month, a
    much smaller edge case than this daily one. Fixed in budget.ts's
    dailyStatus()/recordDailySpend() at the same time — both apps read/write
    the same provider_usage rows, so a day-key change unsynced between them
    would fragment the shared budget instead of fixing it."""
    now = now or datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d")


async def daily_status(provider_id: str, limit: int) -> int:
    """Current daily spend for a provider — the read half budget.ts's
    dailyStatus() provides in TS. Only returns the used count (not a full
    BudgetStatus struct); callers compare against their own `limit` before a
    fetch, same pattern as tier1Refresh.ts's oddsApiIoSpentToday/proplineSpentToday.
    Missing this read function is exactly what let Propline (and originally
    ParlayAPI) run in TS's Tier 1 loop for so long with zero rate-limit
    checking — added here so the Python port doesn't repeat that gap."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT request_count FROM provider_usage WHERE provider_id = $1 AND period_kind = 'daily' AND period_key = $2",
        provider_id,
        utc_date_key(),
    )
    return row["request_count"] if row else 0


async def monthly_status(provider_id: str, limit: int, unit: str = "requests") -> int:
    """Same read gap as daily_status, for monthly-billed providers
    (SportsGameOdds, ParlayAPI) — direct port of TS's monthlyStatus() in
    budget.ts, including reading exactly one column by `unit` rather than
    summing both (a provider spends one or the other, never both in the
    same period). Callers compare the returned used-count against whichever
    number they're meant to gate on (a soft cap for SportsGameOdds, the hard
    monthlyLimit for ParlayAPI — see job_runner.py's ProviderSpec.cap_limit,
    set per-provider in jobs.py to match each one's real TS gate)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT request_count, object_count FROM provider_usage WHERE provider_id = $1 AND period_kind = 'monthly' AND period_key = $2",
        provider_id,
        eastern_month_key(),
    )
    if row is None:
        return 0
    return (row["object_count"] if unit == "objects" else row["request_count"]) or 0


async def record_daily_spend(provider_id: str, requests: int = 0, objects: int = 0) -> None:
    if requests == 0 and objects == 0:
        return
    await _increment_usage(provider_id, "daily", utc_date_key(), requests, objects)


async def record_monthly_spend(provider_id: str, requests: int = 0, objects: int = 0) -> None:
    if requests == 0 and objects == 0:
        return
    await _increment_usage(provider_id, "monthly", eastern_month_key(), requests, objects)


async def _increment_usage(provider_id: str, period_kind: str, period_key: str, requests: int, objects: int) -> None:
    # Same atomic upsert pattern as lib/db/client.ts's incrementProviderUsage
    # — real spend from this harness must land in the same counters the TS
    # app reads, or its own budget checks go blind to what this service spent.
    # Non-fatal on failure for the same reason as write_job_run_log: a
    # transient network blip shouldn't take down a multi-hour run over one
    # missed spend record — occasionally under-recording is a much smaller
    # problem than the whole service crashing.
    try:
        await _increment_usage_inner(provider_id, period_kind, period_key, requests, objects)
    except Exception as e:
        print(f"[db] record spend failed for {provider_id} (non-fatal): {type(e).__name__}: {e}", flush=True)


async def _increment_usage_inner(provider_id: str, period_kind: str, period_key: str, requests: int, objects: int) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO provider_usage (provider_id, period_kind, period_key, request_count, object_count, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (provider_id, period_kind, period_key) DO UPDATE SET
          request_count = provider_usage.request_count + excluded.request_count,
          object_count  = provider_usage.object_count + excluded.object_count,
          updated_at    = excluded.updated_at
        """,
        provider_id,
        period_kind,
        period_key,
        requests,
        objects,
    )


@dataclass
class PropOddsInput:
    provider_id: str
    game_id: str
    subject_id: str
    subject_name: str
    market_key: str
    line: float | None
    side: str
    bookmaker: str
    american_odds: int
    decimal_odds: float | None
    is_delayed: bool = False
    delay_seconds: int | None = None


async def write_prop_odds(rows: list[PropOddsInput]) -> None:
    """Direct port of lib/db/client.ts's writePropOdds — not a simplified
    reimplementation. Per row, within one real transaction covering the
    whole batch (matching the TS version's single pgTransaction wrapping
    the entire loop, not one transaction per row):

      1. Look up the prior american_odds for this exact
         (provider_id, game_id, subject_id, market_key, line, side, bookmaker)
         key — `line IS NOT DISTINCT FROM $N`, not `line = $N`, since line is
         nullable (categorical markets have none) and Postgres's `IS` isn't
         null-safe equality the way SQLite's was for the original code this
         was ported from.
      2. If there's no prior row, or the price genuinely changed, insert a
         row into prop_odds_history — an append-only log of price MOVEMENTS,
         not one row per poll. A repeat of the same price on the next cycle
         is not a history point.
      3. Unconditionally upsert prop_odds itself (the current-state table)
         via INSERT ... ON CONFLICT DO UPDATE on the same natural key.

    Real writes to the exact tables the live TS app reads from — this is
    the one function in this file that isn't a diagnostic/breadcrumb write,
    which is exactly why it stays disconnected from any live fetch path
    until that's a deliberate, separate decision.
    """
    if not rows:
        return
    fetched_at = datetime.now(timezone.utc)
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                prior = await conn.fetchrow(
                    """
                    SELECT american_odds FROM prop_odds
                    WHERE provider_id = $1 AND game_id = $2 AND subject_id = $3
                      AND market_key = $4 AND line IS NOT DISTINCT FROM $5
                      AND side = $6 AND bookmaker = $7
                    """,
                    r.provider_id,
                    r.game_id,
                    r.subject_id,
                    r.market_key,
                    r.line,
                    r.side,
                    r.bookmaker,
                )
                if prior is None or prior["american_odds"] != r.american_odds:
                    await conn.execute(
                        """
                        INSERT INTO prop_odds_history
                          (provider_id, game_id, subject_id, market_key, line, side, bookmaker,
                           american_odds, decimal_odds, observed_at, is_delayed, delay_seconds)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                        """,
                        r.provider_id,
                        r.game_id,
                        r.subject_id,
                        r.market_key,
                        r.line,
                        r.side,
                        r.bookmaker,
                        r.american_odds,
                        r.decimal_odds,
                        fetched_at,
                        r.is_delayed,
                        r.delay_seconds,
                    )
                await conn.execute(
                    """
                    INSERT INTO prop_odds
                      (provider_id, game_id, subject_id, subject_name, market_key, line, side, bookmaker,
                       american_odds, decimal_odds, fetched_at, is_delayed, delay_seconds)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    ON CONFLICT (provider_id, game_id, subject_id, market_key, line, side, bookmaker) DO UPDATE SET
                      subject_name  = excluded.subject_name,
                      american_odds = excluded.american_odds,
                      decimal_odds  = excluded.decimal_odds,
                      fetched_at    = excluded.fetched_at,
                      is_delayed    = excluded.is_delayed,
                      delay_seconds = excluded.delay_seconds
                    """,
                    r.provider_id,
                    r.game_id,
                    r.subject_id,
                    r.subject_name,
                    r.market_key,
                    r.line,
                    r.side,
                    r.bookmaker,
                    r.american_odds,
                    r.decimal_odds,
                    fetched_at,
                    r.is_delayed,
                    r.delay_seconds,
                )


@dataclass
class PropOddsRow:
    id: int
    provider_id: str
    game_id: str
    subject_id: str
    subject_name: str
    market_key: str
    line: float | None
    side: str
    bookmaker: str
    american_odds: int
    decimal_odds: float | None
    fetched_at: str
    is_delayed: bool
    delay_seconds: int | None


def _map_prop_odds_row(r) -> PropOddsRow:
    return PropOddsRow(
        id=r["id"],
        provider_id=r["provider_id"],
        game_id=r["game_id"],
        subject_id=r["subject_id"],
        subject_name=r["subject_name"],
        market_key=r["market_key"],
        line=r["line"],
        side=r["side"],
        bookmaker=r["bookmaker"],
        american_odds=r["american_odds"],
        decimal_odds=r["decimal_odds"],
        fetched_at=r["fetched_at"].isoformat(),
        is_delayed=bool(r["is_delayed"]),
        delay_seconds=r["delay_seconds"],
    )


async def read_prop_odds_for_game(game_id: str) -> list[PropOddsRow]:
    """Direct port of lib/db/client.ts's readPropOddsForGame."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, provider_id, game_id, subject_id, subject_name, market_key, line, side,
               bookmaker, american_odds, decimal_odds, fetched_at, is_delayed, delay_seconds
        FROM prop_odds WHERE game_id = $1 ORDER BY subject_id, market_key, bookmaker
        """,
        game_id,
    )
    return [_map_prop_odds_row(r) for r in rows]


async def write_job_run_log(job_name: str, summary: dict) -> None:
    """Diagnostic breadcrumb only — a distinct namespace from anything the TS
    app reads, so a human can inspect recent run history without this harness
    touching any table the live app depends on.

    Never allowed to crash the caller: a real run hit a transient DNS
    failure (getaddrinfo) writing this exact log and took the whole process
    down with it — a breadcrumb write has no business being that
    consequential. Caught and logged here, matching the "cache write is
    never load-bearing" contract this codebase already uses elsewhere
    (e.g. TS's writeSnapshotCache call sites)."""
    try:
        await _write_job_run_log_inner(job_name, summary)
    except Exception as e:
        print(f"[db] write_job_run_log failed for {job_name} (non-fatal): {type(e).__name__}: {e}", flush=True)


async def _write_job_run_log_inner(job_name: str, summary: dict) -> None:
    pool = await get_pool()
    key = f"python-harness:job-run:{job_name}"
    await pool.execute(
        """
        INSERT INTO snapshot_cache (cache_key, payload, fetched_at)
        VALUES ($1, $2, now())
        ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
        """,
        key,
        json.dumps(summary),
    )


async def write_health_check_results(results: list[dict]) -> None:
    """Persists health_check.py's check_* results (Phase 04 of
    docs/four-feature-gameplan-2026-08-22.md) so the admin center has
    something to read besides a terminal — health_check.py's main() has
    always computed these, just never kept them anywhere. Same non-fatal
    contract as write_job_run_log: a monitoring write failing is never
    allowed to make the actual check's result unavailable to the caller
    (main() still prints it either way)."""
    try:
        await _write_health_check_results_inner(results)
    except Exception as e:
        print(f"[db] write_health_check_results failed (non-fatal): {type(e).__name__}: {e}", flush=True)


async def _write_health_check_results_inner(results: list[dict]) -> None:
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    for r in results:
        detail = r.get("raw")
        await pool.execute(
            """
            INSERT INTO job_health_checks (check_name, healthy, status, detail, checked_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (check_name) DO UPDATE SET
              healthy = excluded.healthy, status = excluded.status,
              detail = excluded.detail, checked_at = excluded.checked_at
            """,
            r["name"],
            bool(r["healthy"]),
            r["status"],
            json.dumps(detail) if detail is not None else None,
            now,
        )


def _to_date(iso_str: str):
    """Postgres DATE columns need a real datetime.date via asyncpg (unlike
    node-postgres's driver, asyncpg doesn't implicitly text-parse a string
    parameter into the target column type) — accepts either a bare
    'YYYY-MM-DD' or a full ISO datetime ('...Z' or an offset), same shapes
    MlbGame.game_date/gameDate carries."""
    s = iso_str[:-1] + "+00:00" if iso_str.endswith("Z") else iso_str
    return datetime.fromisoformat(s).date()


def _rowcount_from_status(status: str) -> int:
    """asyncpg's conn.execute() returns a command tag like 'INSERT 0 1' —
    the row count is always the last whitespace-separated token."""
    parts = status.split()
    try:
        return int(parts[-1])
    except (ValueError, IndexError):
        return 0


# ---------------------------------------------------------------------------
# Team Elo history (Phase C of the prediction-engine port)
# ---------------------------------------------------------------------------


@dataclass
class EloHistoryInput:
    team_id: int
    season: int
    game_pk: int
    game_date: str
    elo: float
    games_played: int
    opponent_team_id: int | None
    was_home: bool


async def write_elo_history(rows: list[EloHistoryInput]) -> int:
    """Direct port of lib/db/client.ts's writeEloHistory. Append-only,
    idempotent via UNIQUE(team_id, season, game_pk) — safe to call for an
    already-recorded game (no-op) or to re-run a full backfill without
    duplicating rows."""
    if not rows:
        return 0
    pool = await get_pool()
    written = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                status = await conn.execute(
                    """
                    INSERT INTO team_elo_history (team_id, season, game_pk, game_date, elo, games_played, opponent_team_id, was_home)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (team_id, season, game_pk) DO NOTHING
                    """,
                    r.team_id,
                    r.season,
                    r.game_pk,
                    _to_date(r.game_date),
                    r.elo,
                    r.games_played,
                    r.opponent_team_id,
                    r.was_home,
                )
                if _rowcount_from_status(status) > 0:
                    written += 1
    return written


@dataclass
class CurrentEloRow:
    elo: float
    games_played: int
    game_date: str
    opponent_team_id: int | None
    was_home: bool


async def get_current_elo(team_id: int, season: int) -> CurrentEloRow | None:
    """A team's most recent rating THIS season — None if they haven't
    played a rated game yet this season."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT elo, games_played, game_date, opponent_team_id, was_home
        FROM team_elo_history WHERE team_id = $1 AND season = $2
        ORDER BY game_date DESC, id DESC LIMIT 1
        """,
        team_id,
        season,
    )
    if row is None:
        return None
    return CurrentEloRow(
        elo=row["elo"],
        games_played=row["games_played"],
        game_date=row["game_date"].isoformat(),
        opponent_team_id=row["opponent_team_id"],
        was_home=row["was_home"],
    )


async def get_latest_elo_before_season(team_id: int, season: int) -> CurrentEloRow | None:
    """A team's most recent rating from ANY season before the given one —
    the season-reversion path's source value."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT elo, games_played, game_date, opponent_team_id, was_home
        FROM team_elo_history WHERE team_id = $1 AND season < $2
        ORDER BY season DESC, game_date DESC, id DESC LIMIT 1
        """,
        team_id,
        season,
    )
    if row is None:
        return None
    return CurrentEloRow(
        elo=row["elo"],
        games_played=row["games_played"],
        game_date=row["game_date"].isoformat(),
        opponent_team_id=row["opponent_team_id"],
        was_home=row["was_home"],
    )


# NOTE: TS's eloModel.ts imports getMostRecentEloGame from client.ts but
# never calls it anywhere in the file (confirmed dead: grep across lib/ and
# app/ finds zero other callers either) — deliberately not ported, per the
# gameplan's "don't port unless another real caller needs it" call.


# ---------------------------------------------------------------------------
# Pitcher Game Score history (Elo item 4 — pitcher adjustment)
# ---------------------------------------------------------------------------


@dataclass
class PitcherGameScoreInput:
    pitcher_id: int
    team_id: int
    season: int
    game_pk: int
    game_date: str
    game_score: float


async def write_pitcher_game_score(rows: list[PitcherGameScoreInput]) -> int:
    if not rows:
        return 0
    pool = await get_pool()
    written = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                status = await conn.execute(
                    """
                    INSERT INTO pitcher_game_score_history (pitcher_id, team_id, season, game_pk, game_date, game_score)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (pitcher_id, game_pk) DO NOTHING
                    """,
                    r.pitcher_id,
                    r.team_id,
                    r.season,
                    r.game_pk,
                    _to_date(r.game_date),
                    r.game_score,
                )
                if _rowcount_from_status(status) > 0:
                    written += 1
    return written


async def recent_pitcher_game_scores(pitcher_id: int, limit: int) -> list[float]:
    """A pitcher's most recent N starts, most recent first — the
    rolling-trend input for the live pitcher adjustment."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT game_score FROM pitcher_game_score_history WHERE pitcher_id = $1 ORDER BY game_date DESC, id DESC LIMIT $2",
        pitcher_id,
        limit,
    )
    return [r["game_score"] for r in rows]


async def team_baseline_game_score(team_id: int, season: int, before_date: str, limit: int = 15) -> float | None:
    """A team's own starters' rolling Game Score average this season — the
    "baseline" a specific start is compared against."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT game_score FROM pitcher_game_score_history
        WHERE team_id = $1 AND season = $2 AND game_date < $3
        ORDER BY game_date DESC, id DESC LIMIT $4
        """,
        team_id,
        season,
        _to_date(before_date),
        limit,
    )
    if not rows:
        return None
    return sum(r["game_score"] for r in rows) / len(rows)


# ---------------------------------------------------------------------------
# Park factors (read-only here — writing them is Phase 1's TS-owned job,
# simGame.ts/sim_game.py only ever reads this table)
# ---------------------------------------------------------------------------


@dataclass
class ParkFactorRow:
    venue_id: int
    season: int
    venue_name: str
    factor: float
    games: int
    computed_at: str


async def read_park_factors(season: int) -> list[ParkFactorRow]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT venue_id, season, venue_name, factor, games, computed_at FROM park_factors WHERE season = $1",
        season,
    )
    return [
        ParkFactorRow(
            venue_id=r["venue_id"],
            season=r["season"],
            venue_name=r["venue_name"],
            factor=r["factor"],
            games=r["games"],
            computed_at=r["computed_at"].isoformat(),
        )
        for r in rows
    ]


async def write_park_factors(season: int, rows: list) -> None:
    """Direct port of lib/db/client.ts's writeParkFactors — not a
    simplified reimplementation. Each row needs venue_id/venue_name/factor/
    games attributes (matches predict.park_factors.ParkFactorResult).
    Upsert keyed on (venue_id, season) — a park's character doesn't change
    mid-season, so a re-run just refreshes the same rows."""
    if not rows:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                await conn.execute(
                    """
                    INSERT INTO park_factors (venue_id, season, venue_name, factor, games, computed_at)
                    VALUES ($1, $2, $3, $4, $5, now())
                    ON CONFLICT (venue_id, season) DO UPDATE SET
                      venue_name = excluded.venue_name, factor = excluded.factor,
                      games = excluded.games, computed_at = excluded.computed_at
                    """,
                    r.venue_id,
                    season,
                    r.venue_name,
                    r.factor,
                    r.games,
                )


@dataclass
class TeamHrRateAllowedRow:
    team_id: int
    season: int
    games_faced: int
    games_with_hr_allowed: int
    league_hr_rate: float
    computed_at: str


async def read_team_hr_rate_allowed(season: int) -> list[TeamHrRateAllowedRow]:
    """Direct port of lib/db/client.ts's readTeamHrRateAllowed."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT team_id, season, games_faced, games_with_hr_allowed, league_hr_rate, computed_at FROM team_hr_rate_allowed WHERE season = $1",
        season,
    )
    return [
        TeamHrRateAllowedRow(
            team_id=r["team_id"],
            season=r["season"],
            games_faced=r["games_faced"],
            games_with_hr_allowed=r["games_with_hr_allowed"],
            league_hr_rate=r["league_hr_rate"],
            computed_at=r["computed_at"].isoformat(),
        )
        for r in rows
    ]


async def write_team_hr_rate_allowed(season: int, league_hr_rate: float, rows: list) -> None:
    """Direct port of lib/db/client.ts's writeTeamHrRateAllowed. Each row
    needs team_id/games_faced/games_with_hr_allowed attributes. Upsert
    keyed on (team_id, season)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                await conn.execute(
                    """
                    INSERT INTO team_hr_rate_allowed (team_id, season, games_faced, games_with_hr_allowed, league_hr_rate, computed_at)
                    VALUES ($1, $2, $3, $4, $5, now())
                    ON CONFLICT (team_id, season) DO UPDATE SET
                      games_faced = excluded.games_faced, games_with_hr_allowed = excluded.games_with_hr_allowed,
                      league_hr_rate = excluded.league_hr_rate, computed_at = excluded.computed_at
                    """,
                    r.team_id,
                    season,
                    r.games_faced,
                    r.games_with_hr_allowed,
                    league_hr_rate,
                )


@dataclass
class LeagueBaseRate:
    dimension: str
    rate: float
    n: int


async def league_base_rates(sport: str) -> list[LeagueBaseRate]:
    """League-wide P(actual > line) per market, from every graded row this
    app has ever seen — the center of the Beta-Binomial prior. Direct port
    of lib/db/client.ts's leagueBaseRates."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT dimension,
               AVG(CASE WHEN actual_value > line THEN 1.0 ELSE 0.0 END)::float8 AS rate,
               COUNT(*) AS n
        FROM pick_history
        WHERE sport = $1 AND outcome IS NOT NULL AND actual_value IS NOT NULL AND line IS NOT NULL
        GROUP BY dimension
        """,
        sport,
    )
    return [LeagueBaseRate(dimension=r["dimension"], rate=r["rate"], n=r["n"]) for r in rows]


@dataclass
class LiveMarketSkill:
    dimension: str
    n: int
    bss: float | None


async def live_market_skill(sport: str) -> list[LiveMarketSkill]:
    """Direct port of lib/db/client.ts's liveMarketSkill — live (non-
    backfill) Brier Skill Score per dimension, the input to
    predict.market_trust.trust_tier_from_live_bss."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT dimension,
               COUNT(*) AS n,
               SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
               AVG((model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END)) *
                   (model_prob - (CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END)))::float8 AS brier
        FROM pick_history
        WHERE sport = $1 AND model_prob IS NOT NULL AND outcome IS NOT NULL
              AND (event_context IS NULL OR event_context != 'backfill')
        GROUP BY dimension
        """,
        sport,
    )
    out: list[LiveMarketSkill] = []
    for r in rows:
        n = r["n"]
        p = r["wins"] / n
        naive_brier = p * (1 - p)
        bss = 1 - r["brier"] / naive_brier if naive_brier > 0 else None
        out.append(LiveMarketSkill(dimension=r["dimension"], n=n, bss=bss))
    return out


@dataclass
class GameOddsHistoryInput:
    event_id: str
    market: str  # 'moneyline' | 'spread' | 'total'
    side: str  # 'home' | 'away' for moneyline/spread, 'over' | 'under' for total
    bookmaker: str
    american_odds: int
    point: float | None
    # Which writer produced this row — 'the-odds-api' | 'oddsharvester'. Part
    # of the dedup key below, not a display-only field: two independent,
    # uncoordinated writers (the existing the-odds-api port and the new
    # OddsHarvester GitHub Actions workflow) both write into this table, and
    # without `source` distinguishing them, one would silently overwrite the
    # other's reading of the same nominal bookmaker on every cycle they
    # disagree — the exact class of bug this field exists to prevent.
    source: str = "the-odds-api"


async def write_game_odds_history(rows: list[GameOddsHistoryInput]) -> None:
    """Direct port of lib/odds/gameOddsLog.ts's writeGameOddsHistory (via
    lib/db/client.ts) — not a simplified reimplementation. Log-on-change
    only: one new row per (event_id, market, side, bookmaker) key only when
    the latest observed american_odds for that key actually differs from
    what's already there, so calling this every 5 minutes with an unchanged
    price is a harmless no-op, not a growing pile of duplicate rows. Unlike
    write_prop_odds, there is no separate "current state" table to also
    upsert — game_odds_history IS the append-only log; ORDER BY
    observed_at DESC, id DESC LIMIT 1 is how the "current" price for a key
    is read.

    Real bug caught during verification: `observed_at` is captured ONCE
    for the whole batch (matching TS's one-timestamp-per-request
    convention). Two rows for the same key within one call are real and
    expected — the "best available" price is sometimes attributed to a
    book that ALSO appears in `bookmakers[]` with its own, occasionally
    different, price — so they can tie exactly on `observed_at`. Sorting
    by `observed_at DESC` alone with no secondary key then picks an
    arbitrary one of the tied rows as "current," which can make the very
    next call see a "prior" price that doesn't match either of this call's
    two rows — making BOTH look like changes and re-inserting them every
    single cycle, forever. Verified live: without the `id DESC`
    tiebreaker, the same two prices for one key kept re-inserting on every
    call with unchanged input data. `id DESC` (monotonic insertion order)
    fixes it.

    `source` is now part of the dedup key (2026-08-25, OddsHarvester
    integration) — see GameOddsHistoryInput's own docstring. Existing
    callers that don't pass it default to 'the-odds-api', preserving every
    row this function has ever written before this change.
    """
    if not rows:
        return
    observed_at = datetime.now(timezone.utc)
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                prior = await conn.fetchrow(
                    """
                    SELECT american_odds FROM game_odds_history
                    WHERE event_id = $1 AND market = $2 AND side = $3 AND bookmaker = $4 AND source = $5
                    ORDER BY observed_at DESC, id DESC LIMIT 1
                    """,
                    r.event_id,
                    r.market,
                    r.side,
                    r.bookmaker,
                    r.source,
                )
                if prior is None or prior["american_odds"] != r.american_odds:
                    await conn.execute(
                        """
                        INSERT INTO game_odds_history (event_id, market, side, bookmaker, american_odds, point, observed_at, source)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        """,
                        r.event_id,
                        r.market,
                        r.side,
                        r.bookmaker,
                        r.american_odds,
                        r.point,
                        observed_at,
                        r.source,
                    )


@dataclass
class SurfacedEntry:
    sport: str
    subject_id: str
    subject_name: str
    dimension: str
    category: str
    market_key: str | None
    line: float | None
    game_id: str | None
    sample_size: int
    distance: int | None
    event_context: str | None
    model_prob: float | None = None
    market_prob: float | None = None
    edge: float | None = None
    price_source: str | None = None
    bookmaker: str | None = None
    price_captured_at: str | None = None
    prop_score: float | None = None
    score_grade: str | None = None
    trust_tier: str | None = None
    model_version: int | None = None


async def log_surfaced(entries: list[SurfacedEntry]) -> None:
    """Direct port of lib/db/client.ts's logSurfaced — one row per
    real-world proposition surfaced, keyed on (sport, subject_id,
    dimension, category, game_id), idempotent via ON CONFLICT DO NOTHING
    since a candidate still surfacing on the next cycle is the same
    proposition, not a new data point.
    """
    if not entries:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in entries:
                await conn.execute(
                    """
                    INSERT INTO pick_history
                      (sport, subject_id, subject_name, dimension, category, market_key, line, game_id,
                       sample_size, distance, event_context, model_prob, market_prob, edge, price_source, bookmaker, price_captured_at,
                       prop_score, score_grade, trust_tier, model_version)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                    ON CONFLICT (sport, subject_id, dimension, category, game_id) DO NOTHING
                    """,
                    r.sport,
                    r.subject_id,
                    r.subject_name,
                    r.dimension,
                    r.category,
                    r.market_key,
                    r.line,
                    r.game_id,
                    r.sample_size,
                    r.distance,
                    r.event_context,
                    r.model_prob,
                    r.market_prob,
                    r.edge,
                    r.price_source,
                    r.bookmaker,
                    r.price_captured_at,
                    r.prop_score,
                    r.score_grade,
                    r.trust_tier,
                    r.model_version,
                )


@dataclass
class GameTotalPrediction:
    game_pk: str
    total_line: float
    over_prob: float


async def log_game_total_predictions(sport: str, predictions: list[GameTotalPrediction]) -> None:
    """Direct port of lib/odds/props/pickHistoryLog.ts's
    logGameTotalPredictions — wraps log_surfaced with the same fixed
    dimension='total'/category='over'/subject_id=f'game-{gamePk}' shape."""
    entries = [
        SurfacedEntry(
            sport=sport,
            subject_id=f"game-{p.game_pk}",
            subject_name="Total",
            dimension="total",
            category="over",
            market_key=None,
            line=p.total_line,
            game_id=str(p.game_pk),
            sample_size=0,
            distance=None,
            event_context=None,
            model_prob=p.over_prob,
        )
        for p in predictions
    ]
    await log_surfaced(entries)


# ---------------------------------------------------------------------------
# Live per-game simulation cache (Phase D of the prediction-engine port)
# ---------------------------------------------------------------------------


@dataclass
class GameSimCacheRow:
    sport: str
    game_id: str
    home_win_prob: float
    expected_total: float
    n: int
    lineup_source: str  # 'posted' | 'projected'
    computed_at: str


async def read_game_sim_cache(sport: str, game_id: str) -> GameSimCacheRow | None:
    """Cheap read for the live prediction path — never runs a simulation
    itself. None (not a thrown error) whenever nothing's cached yet, so
    callers fall back to their existing neutral impute."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT sport, game_id, home_win_prob, expected_total, n, lineup_source, computed_at FROM game_sim_cache WHERE sport = $1 AND game_id = $2",
        sport,
        game_id,
    )
    if row is None:
        return None
    return GameSimCacheRow(
        sport=row["sport"],
        game_id=row["game_id"],
        home_win_prob=row["home_win_prob"],
        expected_total=row["expected_total"],
        n=row["n"],
        lineup_source=row["lineup_source"],
        computed_at=row["computed_at"].isoformat(),
    )


async def write_game_sim_cache(row: GameSimCacheRow) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO game_sim_cache (sport, game_id, home_win_prob, expected_total, n, lineup_source, computed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (sport, game_id) DO UPDATE SET
          home_win_prob = excluded.home_win_prob, expected_total = excluded.expected_total,
          n = excluded.n, lineup_source = excluded.lineup_source, computed_at = excluded.computed_at
        """,
        row.sport,
        row.game_id,
        row.home_win_prob,
        row.expected_total,
        row.n,
        row.lineup_source,
        _to_datetime(row.computed_at),
    )


def _to_datetime(iso_str: str):
    s = iso_str[:-1] + "+00:00" if iso_str.endswith("Z") else iso_str
    return datetime.fromisoformat(s)


def _iso_or_none(v) -> str | None:
    return v.isoformat() if v is not None else None


# ---------------------------------------------------------------------------
# Linesmith Pick lock system (game_picks) — Phase E of the prediction-engine port
# ---------------------------------------------------------------------------


@dataclass
class GamePickIdentity:
    sport: str
    game_id: str
    home_team_id: int | None
    away_team_id: int | None
    home_team_name: str | None
    away_team_name: str | None
    matchup: str | None
    commence_time: str | None


async def ensure_game_pick_row(identity: GamePickIdentity) -> None:
    """Ensures the identity row exists, keeping commence time fresh
    (postponements move it)."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO game_picks (sport, game_id, home_team_id, away_team_id, home_team_name, away_team_name, matchup, commence_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (sport, game_id) DO UPDATE SET
          home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id,
          home_team_name = excluded.home_team_name, away_team_name = excluded.away_team_name,
          matchup = excluded.matchup, commence_time = excluded.commence_time
        """,
        identity.sport,
        identity.game_id,
        identity.home_team_id,
        identity.away_team_id,
        identity.home_team_name,
        identity.away_team_name,
        identity.matchup,
        _to_datetime(identity.commence_time) if identity.commence_time else None,
    )


@dataclass
class GamePickRow:
    id: int
    sport: str
    game_id: str
    home_team_id: int | None
    away_team_id: int | None
    home_team_name: str | None
    away_team_name: str | None
    matchup: str | None
    commence_time: str | None
    ml_initial_side: str | None
    ml_initial_prob: float | None
    ml_initial_captured_at: str | None
    ml_initial_late: bool
    ml_initial_price: int | None
    ml_initial_prob_lower: float | None
    ml_initial_prob_upper: float | None
    ml_initial_kelly_stake_fraction: float | None
    ml_initial_edge_significant: bool | None
    ml_final_side: str | None
    ml_final_prob: float | None
    ml_final_captured_at: str | None
    ml_final_late: bool
    ml_final_price: int | None
    ml_final_prob_lower: float | None
    ml_final_prob_upper: float | None
    ml_final_kelly_stake_fraction: float | None
    ml_final_edge_significant: bool | None
    total_initial_side: str | None
    total_initial_prob: float | None
    total_initial_line: float | None
    total_initial_captured_at: str | None
    total_initial_late: bool
    total_initial_price: int | None
    total_initial_prob_lower: float | None
    total_initial_prob_upper: float | None
    total_initial_kelly_stake_fraction: float | None
    total_initial_edge_significant: bool | None
    total_final_side: str | None
    total_final_prob: float | None
    total_final_line: float | None
    total_final_captured_at: str | None
    total_final_late: bool
    total_final_price: int | None
    total_final_prob_lower: float | None
    total_final_prob_upper: float | None
    total_final_kelly_stake_fraction: float | None
    total_final_edge_significant: bool | None
    final_home_score: int | None
    final_away_score: int | None
    ml_outcome: str | None
    total_outcome: str | None
    graded_at: str | None
    initial_ml_features_json: str | None
    final_ml_features_json: str | None
    initial_total_features_json: str | None
    final_total_features_json: str | None


_GAME_PICK_COLUMNS = """
  id, sport, game_id, home_team_id, away_team_id, home_team_name, away_team_name,
  matchup, commence_time,
  ml_initial_side, ml_initial_prob, ml_initial_captured_at, ml_initial_late, ml_initial_price,
  ml_initial_prob_lower, ml_initial_prob_upper, ml_initial_kelly_stake_fraction, ml_initial_edge_significant,
  ml_final_side, ml_final_prob, ml_final_captured_at, ml_final_late, ml_final_price,
  ml_final_prob_lower, ml_final_prob_upper, ml_final_kelly_stake_fraction, ml_final_edge_significant,
  total_initial_side, total_initial_prob, total_initial_line, total_initial_captured_at,
  total_initial_late, total_initial_price, total_initial_prob_lower, total_initial_prob_upper,
  total_initial_kelly_stake_fraction, total_initial_edge_significant,
  total_final_side, total_final_prob, total_final_line, total_final_captured_at,
  total_final_late, total_final_price, total_final_prob_lower, total_final_prob_upper,
  total_final_kelly_stake_fraction, total_final_edge_significant,
  final_home_score, final_away_score, ml_outcome, total_outcome, graded_at,
  initial_ml_features_json, final_ml_features_json, initial_total_features_json, final_total_features_json
"""


def _map_game_pick_row(row) -> GamePickRow:
    return GamePickRow(
        id=row["id"],
        sport=row["sport"],
        game_id=row["game_id"],
        home_team_id=row["home_team_id"],
        away_team_id=row["away_team_id"],
        home_team_name=row["home_team_name"],
        away_team_name=row["away_team_name"],
        matchup=row["matchup"],
        commence_time=_iso_or_none(row["commence_time"]),
        ml_initial_side=row["ml_initial_side"],
        ml_initial_prob=row["ml_initial_prob"],
        ml_initial_captured_at=_iso_or_none(row["ml_initial_captured_at"]),
        ml_initial_late=row["ml_initial_late"],
        ml_initial_price=row["ml_initial_price"],
        ml_initial_prob_lower=row["ml_initial_prob_lower"],
        ml_initial_prob_upper=row["ml_initial_prob_upper"],
        ml_initial_kelly_stake_fraction=row["ml_initial_kelly_stake_fraction"],
        ml_initial_edge_significant=row["ml_initial_edge_significant"],
        ml_final_side=row["ml_final_side"],
        ml_final_prob=row["ml_final_prob"],
        ml_final_captured_at=_iso_or_none(row["ml_final_captured_at"]),
        ml_final_late=row["ml_final_late"],
        ml_final_price=row["ml_final_price"],
        ml_final_prob_lower=row["ml_final_prob_lower"],
        ml_final_prob_upper=row["ml_final_prob_upper"],
        ml_final_kelly_stake_fraction=row["ml_final_kelly_stake_fraction"],
        ml_final_edge_significant=row["ml_final_edge_significant"],
        total_initial_side=row["total_initial_side"],
        total_initial_prob=row["total_initial_prob"],
        total_initial_line=row["total_initial_line"],
        total_initial_captured_at=_iso_or_none(row["total_initial_captured_at"]),
        total_initial_late=row["total_initial_late"],
        total_initial_price=row["total_initial_price"],
        total_initial_prob_lower=row["total_initial_prob_lower"],
        total_initial_prob_upper=row["total_initial_prob_upper"],
        total_initial_kelly_stake_fraction=row["total_initial_kelly_stake_fraction"],
        total_initial_edge_significant=row["total_initial_edge_significant"],
        total_final_side=row["total_final_side"],
        total_final_prob=row["total_final_prob"],
        total_final_line=row["total_final_line"],
        total_final_captured_at=_iso_or_none(row["total_final_captured_at"]),
        total_final_late=row["total_final_late"],
        total_final_price=row["total_final_price"],
        total_final_prob_lower=row["total_final_prob_lower"],
        total_final_prob_upper=row["total_final_prob_upper"],
        total_final_kelly_stake_fraction=row["total_final_kelly_stake_fraction"],
        total_final_edge_significant=row["total_final_edge_significant"],
        final_home_score=row["final_home_score"],
        final_away_score=row["final_away_score"],
        ml_outcome=row["ml_outcome"],
        total_outcome=row["total_outcome"],
        graded_at=_iso_or_none(row["graded_at"]),
        initial_ml_features_json=row["initial_ml_features_json"],
        final_ml_features_json=row["final_ml_features_json"],
        initial_total_features_json=row["initial_total_features_json"],
        final_total_features_json=row["final_total_features_json"],
    )


async def get_game_pick(sport: str, game_id: str) -> GamePickRow | None:
    pool = await get_pool()
    row = await pool.fetchrow(f"SELECT {_GAME_PICK_COLUMNS} FROM game_picks WHERE sport = $1 AND game_id = $2", sport, game_id)
    return _map_game_pick_row(row) if row else None


async def attach_moneyline_price(sport: str, game_id: str, slot: str, side: str, american_odds: int) -> None:
    """Direct port of lib/db/client.ts's attachMoneylinePrice — Track A3.
    Idempotent by construction (`..._price IS NULL` guard): fills the
    reference price shown next to an already-locked pick, never touches
    which side was picked or its probability."""
    col = "ml_initial" if slot == "initial" else "ml_final"
    pool = await get_pool()
    await pool.execute(
        f"UPDATE game_picks SET {col}_price = $1 WHERE sport = $2 AND game_id = $3 AND {col}_side = $4 AND {col}_price IS NULL",
        american_odds,
        sport,
        game_id,
        side,
    )


async def attach_total_price(sport: str, game_id: str, slot: str, side: str, american_odds: int) -> None:
    """Direct port of lib/db/client.ts's attachTotalPrice — Track A3, same
    shape as attach_moneyline_price above."""
    col = "total_initial" if slot == "initial" else "total_final"
    pool = await get_pool()
    await pool.execute(
        f"UPDATE game_picks SET {col}_price = $1 WHERE sport = $2 AND game_id = $3 AND {col}_side = $4 AND {col}_price IS NULL",
        american_odds,
        sport,
        game_id,
        side,
    )


async def attach_moneyline_kelly_stake(sport: str, game_id: str, slot: str, side: str, stake_fraction: float, edge_significant: bool | None) -> None:
    """predict/staking.py's counterpart to attach_moneyline_price — same
    idempotent shape (only fills once), called right after the price
    attach since Kelly needs the decimal odds that price attach is what
    first makes known."""
    col = "ml_initial" if slot == "initial" else "ml_final"
    pool = await get_pool()
    await pool.execute(
        f"UPDATE game_picks SET {col}_kelly_stake_fraction = $1, {col}_edge_significant = $2 "
        f"WHERE sport = $3 AND game_id = $4 AND {col}_side = $5 AND {col}_kelly_stake_fraction IS NULL",
        stake_fraction,
        edge_significant,
        sport,
        game_id,
        side,
    )


async def attach_total_kelly_stake(sport: str, game_id: str, slot: str, side: str, stake_fraction: float, edge_significant: bool | None) -> None:
    """Same shape as attach_moneyline_kelly_stake, for the total market."""
    col = "total_initial" if slot == "initial" else "total_final"
    pool = await get_pool()
    await pool.execute(
        f"UPDATE game_picks SET {col}_kelly_stake_fraction = $1, {col}_edge_significant = $2 "
        f"WHERE sport = $3 AND game_id = $4 AND {col}_side = $5 AND {col}_kelly_stake_fraction IS NULL",
        stake_fraction,
        edge_significant,
        sport,
        game_id,
        side,
    )


async def get_graded_moneyline_picks_for_significance(sport: str) -> list[tuple[float, float, bool]]:
    """(stake_fraction, decimal_odds, won) tuples for every FINAL-slot
    moneyline pick that's both graded and has a real attached price and
    Kelly stake — predict/staking.py's bootstrap_roi_ci input shape. Final
    slot only (not initial+final both), matching game_pick_lock.py's own
    "the final lock is the pick that actually counts" convention — using
    both would double-count the same underlying game. american_to_decimal
    lives in predict/odds_math.py; imported locally to avoid db.py taking
    a dependency on predict/ at module load time (every other predict/*
    module already depends on db, not the other way around)."""
    from predict.odds_math import american_to_decimal

    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT ml_final_kelly_stake_fraction, ml_final_price, ml_outcome FROM game_picks "
        "WHERE sport = $1 AND graded_at IS NOT NULL AND ml_outcome IS NOT NULL "
        "AND ml_final_kelly_stake_fraction IS NOT NULL AND ml_final_price IS NOT NULL",
        sport,
    )
    picks: list[tuple[float, float, bool]] = []
    for r in rows:
        decimal_odds = american_to_decimal(r["ml_final_price"])
        if decimal_odds is None:
            continue
        picks.append((r["ml_final_kelly_stake_fraction"], decimal_odds, r["ml_outcome"] == "win"))
    return picks


async def list_game_picks_for_lock_cycle(sport: str) -> list[GamePickRow]:
    """Games with at least one open slot to fill or grade — the lock
    engine's work list."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT {_GAME_PICK_COLUMNS} FROM game_picks WHERE sport = $1 AND (ml_final_captured_at IS NULL OR total_final_captured_at IS NULL OR graded_at IS NULL)",
        sport,
    )
    return [_map_game_pick_row(r) for r in rows]


@dataclass
class MoneylinePickCapture:
    sport: str
    game_id: str
    slot: str  # 'initial' | 'final'
    side: str  # 'home' | 'away'
    prob: float
    late: bool
    features_json: str | None = None
    prob_lower: float | None = None
    prob_upper: float | None = None


async def capture_moneyline_pick(c: MoneylinePickCapture) -> None:
    """Only writes if this exact slot hasn't been captured yet — a slot,
    once locked, never moves. Column names are interpolated from a fixed
    'initial'/'final' enum (never user input), same safe pattern
    lib/db/client.ts's own template-literal column interpolation already uses."""
    pool = await get_pool()
    col = "ml_initial" if c.slot == "initial" else "ml_final"
    features_col = "initial_ml_features_json" if c.slot == "initial" else "final_ml_features_json"
    await pool.execute(
        f"""
        UPDATE game_picks SET {col}_side = $1, {col}_prob = $2, {col}_captured_at = $3, {col}_late = $4,
          {features_col} = $5, {col}_prob_lower = $6, {col}_prob_upper = $7
        WHERE sport = $8 AND game_id = $9 AND {col}_captured_at IS NULL
        """,
        c.side,
        c.prob,
        datetime.now(timezone.utc),
        c.late,
        c.features_json,
        c.prob_lower,
        c.prob_upper,
        c.sport,
        c.game_id,
    )


@dataclass
class TotalPickCapture:
    sport: str
    game_id: str
    slot: str  # 'initial' | 'final'
    side: str  # 'over' | 'under'
    prob: float
    line: float
    late: bool
    features_json: str | None = None
    prob_lower: float | None = None
    prob_upper: float | None = None


async def capture_total_pick(c: TotalPickCapture) -> None:
    pool = await get_pool()
    col = "total_initial" if c.slot == "initial" else "total_final"
    features_col = "initial_total_features_json" if c.slot == "initial" else "final_total_features_json"
    await pool.execute(
        f"""
        UPDATE game_picks SET {col}_side = $1, {col}_prob = $2, {col}_line = $3, {col}_captured_at = $4, {col}_late = $5,
          {features_col} = $6, {col}_prob_lower = $7, {col}_prob_upper = $8
        WHERE sport = $9 AND game_id = $10 AND {col}_captured_at IS NULL
        """,
        c.side,
        c.prob,
        c.line,
        datetime.now(timezone.utc),
        c.late,
        c.features_json,
        c.prob_lower,
        c.prob_upper,
        c.sport,
        c.game_id,
    )


@dataclass
class GamePickGrade:
    sport: str
    game_id: str
    home_score: int
    away_score: int
    ml_outcome: str | None
    total_outcome: str | None


async def grade_game_pick(g: GamePickGrade) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE game_picks SET
          final_home_score = $1, final_away_score = $2, ml_outcome = $3, total_outcome = $4, graded_at = $5
        WHERE sport = $6 AND game_id = $7 AND graded_at IS NULL
        """,
        g.home_score,
        g.away_score,
        g.ml_outcome,
        g.total_outcome,
        datetime.now(timezone.utc),
        g.sport,
        g.game_id,
    )


# ---------------------------------------------------------------------------
# Odds cache (the-odds-api.com) — Phase F of the prediction-engine port
# ---------------------------------------------------------------------------


@dataclass
class OddsCacheRow:
    cache_key: str
    payload: str
    fetched_at: str
    requests_remaining: int | None
    requests_used: int | None


async def read_odds_cache(cache_key: str) -> OddsCacheRow | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT cache_key, payload, fetched_at, requests_remaining, requests_used FROM odds_cache WHERE cache_key = $1",
        cache_key,
    )
    if row is None:
        return None
    return OddsCacheRow(
        cache_key=row["cache_key"],
        payload=row["payload"],
        fetched_at=row["fetched_at"].isoformat(),
        requests_remaining=row["requests_remaining"],
        requests_used=row["requests_used"],
    )


async def write_odds_cache(cache_key: str, payload: str, requests_remaining: int | None, requests_used: int | None) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO odds_cache (cache_key, payload, fetched_at, requests_remaining, requests_used)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (cache_key) DO UPDATE SET
          payload = excluded.payload, fetched_at = excluded.fetched_at,
          requests_remaining = excluded.requests_remaining, requests_used = excluded.requests_used
        """,
        cache_key,
        payload,
        datetime.now(timezone.utc),
        requests_remaining,
        requests_used,
    )


# ---------------------------------------------------------------------------
# Fitted model weights (read-only here) + game odds history (read-only) —
# Phase G of the prediction-engine port
# ---------------------------------------------------------------------------


@dataclass
class ModelWeightsRow:
    id: int
    sport: str
    market: str
    version: int
    feature_names: list[str]
    weights: list[float]
    intercept: float
    train_games: int
    train_brier: float
    holdout_games: int
    holdout_brier: float
    baseline_holdout_brier: float | None
    active: bool
    fitted_at: str
    covariance: list[list[float]] | None
    train_seasons: list[int] | None
    holdout_seasons: list[int] | None


def _json_or_none(s: str | None):
    return json.loads(s) if s is not None else None


async def get_active_model_weights(sport: str, market: str) -> ModelWeightsRow | None:
    """market: 'moneyline' | 'total' | 'home-run'."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM model_weights WHERE sport = $1 AND market = $2 AND active = true ORDER BY version DESC LIMIT 1",
        sport,
        market,
    )
    if row is None:
        return None
    return ModelWeightsRow(
        id=row["id"],
        sport=row["sport"],
        market=row["market"],
        version=row["version"],
        feature_names=json.loads(row["feature_names"]),
        weights=json.loads(row["weights_json"]),
        intercept=row["intercept"],
        train_games=row["train_games"],
        train_brier=row["train_brier"],
        holdout_games=row["holdout_games"],
        holdout_brier=row["holdout_brier"],
        baseline_holdout_brier=row["baseline_holdout_brier"],
        active=row["active"],
        fitted_at=row["fitted_at"].isoformat(),
        covariance=_json_or_none(row["covariance_json"]),
        train_seasons=_json_or_none(row["train_seasons_json"]),
        holdout_seasons=_json_or_none(row["holdout_seasons_json"]),
    )


@dataclass
class ModelWeightsInput:
    sport: str
    market: str  # 'moneyline' | 'total' | 'home-run'
    feature_names: list[str]
    weights: list[float]
    intercept: float
    train_games: int
    train_brier: float
    holdout_games: int
    holdout_brier: float
    baseline_holdout_brier: float | None
    covariance: list[list[float]] | None
    train_seasons: list[int]
    holdout_seasons: list[int]


async def write_model_weights(input: ModelWeightsInput, activate: bool) -> ModelWeightsRow:
    """Direct port of lib/db/client.ts's writeModelWeights — not a
    simplified reimplementation. Versions are per (sport, market),
    monotonically increasing; activating a new version deactivates every
    prior version for that same (sport, market) in the same transaction,
    so `get_active_model_weights` never has more than one active row to
    choose from."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            max_version_row = await conn.fetchrow(
                "SELECT MAX(version) AS v FROM model_weights WHERE sport = $1 AND market = $2",
                input.sport,
                input.market,
            )
            next_version = (max_version_row["v"] or 0) + 1

            if activate:
                await conn.execute(
                    "UPDATE model_weights SET active = false WHERE sport = $1 AND market = $2",
                    input.sport,
                    input.market,
                )

            await conn.execute(
                """
                INSERT INTO model_weights
                  (sport, market, version, feature_names, weights_json, intercept, train_games, train_brier,
                   holdout_games, holdout_brier, baseline_holdout_brier, active, fitted_at, covariance_json,
                   train_seasons_json, holdout_seasons_json)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13, $14, $15)
                """,
                input.sport,
                input.market,
                next_version,
                json.dumps(input.feature_names),
                json.dumps(input.weights),
                input.intercept,
                input.train_games,
                input.train_brier,
                input.holdout_games,
                input.holdout_brier,
                input.baseline_holdout_brier,
                activate,
                json.dumps(input.covariance) if input.covariance is not None else None,
                json.dumps(input.train_seasons),
                json.dumps(input.holdout_seasons),
            )

            row = await conn.fetchrow(
                "SELECT * FROM model_weights WHERE sport = $1 AND market = $2 AND version = $3",
                input.sport,
                input.market,
                next_version,
            )

    return ModelWeightsRow(
        id=row["id"],
        sport=row["sport"],
        market=row["market"],
        version=row["version"],
        feature_names=json.loads(row["feature_names"]),
        weights=json.loads(row["weights_json"]),
        intercept=row["intercept"],
        train_games=row["train_games"],
        train_brier=row["train_brier"],
        holdout_games=row["holdout_games"],
        holdout_brier=row["holdout_brier"],
        baseline_holdout_brier=row["baseline_holdout_brier"],
        active=row["active"],
        fitted_at=row["fitted_at"].isoformat(),
        covariance=_json_or_none(row["covariance_json"]),
        train_seasons=_json_or_none(row["train_seasons_json"]),
        holdout_seasons=_json_or_none(row["holdout_seasons_json"]),
    )


@dataclass
class CalibrationRow:
    id: int
    sport: str
    market: str
    version: int
    method: str  # 'platt' | 'isotonic'
    params: dict
    train_games: int
    train_log_loss: float
    holdout_games: int
    holdout_log_loss: float
    baseline_holdout_log_loss: float | None
    active: bool
    fitted_at: str


async def get_active_calibration(sport: str, market: str) -> CalibrationRow | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM model_calibration WHERE sport = $1 AND market = $2 AND active = true ORDER BY version DESC LIMIT 1",
        sport,
        market,
    )
    if row is None:
        return None
    return CalibrationRow(
        id=row["id"],
        sport=row["sport"],
        market=row["market"],
        version=row["version"],
        method=row["method"],
        params=json.loads(row["params_json"]),
        train_games=row["train_games"],
        train_log_loss=row["train_log_loss"],
        holdout_games=row["holdout_games"],
        holdout_log_loss=row["holdout_log_loss"],
        baseline_holdout_log_loss=row["baseline_holdout_log_loss"],
        active=row["active"],
        fitted_at=row["fitted_at"].isoformat(),
    )


@dataclass
class CalibrationInput:
    sport: str
    market: str
    method: str  # 'platt' | 'isotonic'
    params: dict
    train_games: int
    train_log_loss: float
    holdout_games: int
    holdout_log_loss: float
    baseline_holdout_log_loss: float | None


async def write_calibration(input: CalibrationInput, activate: bool) -> CalibrationRow:
    """Same versioned-transaction shape as write_model_weights: versions
    are per (sport, market), monotonically increasing; activating a new
    version deactivates every prior version for that same (sport, market)
    in the same transaction."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            max_version_row = await conn.fetchrow(
                "SELECT MAX(version) AS v FROM model_calibration WHERE sport = $1 AND market = $2",
                input.sport,
                input.market,
            )
            next_version = (max_version_row["v"] or 0) + 1

            if activate:
                await conn.execute(
                    "UPDATE model_calibration SET active = false WHERE sport = $1 AND market = $2",
                    input.sport,
                    input.market,
                )

            await conn.execute(
                """
                INSERT INTO model_calibration
                  (sport, market, version, method, params_json, train_games, train_log_loss,
                   holdout_games, holdout_log_loss, baseline_holdout_log_loss, active, fitted_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
                """,
                input.sport,
                input.market,
                next_version,
                input.method,
                json.dumps(input.params),
                input.train_games,
                input.train_log_loss,
                input.holdout_games,
                input.holdout_log_loss,
                input.baseline_holdout_log_loss,
                activate,
            )

            row = await conn.fetchrow(
                "SELECT * FROM model_calibration WHERE sport = $1 AND market = $2 AND version = $3",
                input.sport,
                input.market,
                next_version,
            )

    return CalibrationRow(
        id=row["id"],
        sport=row["sport"],
        market=row["market"],
        version=row["version"],
        method=row["method"],
        params=json.loads(row["params_json"]),
        train_games=row["train_games"],
        train_log_loss=row["train_log_loss"],
        holdout_games=row["holdout_games"],
        holdout_log_loss=row["holdout_log_loss"],
        baseline_holdout_log_loss=row["baseline_holdout_log_loss"],
        active=row["active"],
        fitted_at=row["fitted_at"].isoformat(),
    )


@dataclass
class WalkforwardResultInput:
    sport: str
    market: str
    model_name: str
    fold_index: int | None  # None for the final held-out test row
    is_final_test: bool
    train_seasons: list[int]
    val_seasons: list[int]
    train_games: int
    val_games: int
    log_loss: float
    brier_score: float


async def write_walkforward_result(input: WalkforwardResultInput) -> None:
    """Append-only — every fold of every candidate a run_benchmark() call
    evaluates gets its own row; no versioning/activation here (that's
    model_artifacts'/model_weights' job), this is a benchmarking log."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO walkforward_results
          (sport, market, model_name, fold_index, is_final_test, train_seasons_json, val_seasons_json,
           train_games, val_games, log_loss, brier_score, fitted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        """,
        input.sport,
        input.market,
        input.model_name,
        input.fold_index,
        input.is_final_test,
        json.dumps(input.train_seasons),
        json.dumps(input.val_seasons),
        input.train_games,
        input.val_games,
        input.log_loss,
        input.brier_score,
    )


@dataclass
class ModelArtifactRow:
    id: int
    sport: str
    market: str
    model_name: str
    version: int
    artifact_json: dict | None
    artifact_blob: bytes | None
    train_games: int
    train_log_loss: float
    train_brier: float
    holdout_games: int
    holdout_log_loss: float
    holdout_brier: float
    active: bool
    fitted_at: str


async def get_active_model_artifact(sport: str, market: str, model_name: str) -> ModelArtifactRow | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM model_artifacts WHERE sport = $1 AND market = $2 AND model_name = $3 AND active = true ORDER BY version DESC LIMIT 1",
        sport,
        market,
        model_name,
    )
    if row is None:
        return None
    return ModelArtifactRow(
        id=row["id"],
        sport=row["sport"],
        market=row["market"],
        model_name=row["model_name"],
        version=row["version"],
        artifact_json=_json_or_none(row["artifact_json"]),
        artifact_blob=row["artifact_blob"],
        train_games=row["train_games"],
        train_log_loss=row["train_log_loss"],
        train_brier=row["train_brier"],
        holdout_games=row["holdout_games"],
        holdout_log_loss=row["holdout_log_loss"],
        holdout_brier=row["holdout_brier"],
        active=row["active"],
        fitted_at=row["fitted_at"].isoformat(),
    )


@dataclass
class ModelArtifactInput:
    sport: str
    market: str
    model_name: str
    artifact_json: dict | None
    artifact_blob: bytes | None
    train_games: int
    train_log_loss: float
    train_brier: float
    holdout_games: int
    holdout_log_loss: float
    holdout_brier: float


async def write_model_artifact(input: ModelArtifactInput, activate: bool) -> ModelArtifactRow:
    """Same versioned-transaction shape as write_model_weights, scoped per
    (sport, market, model_name) instead of (sport, market) — see the
    migration's own comment for why."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            max_version_row = await conn.fetchrow(
                "SELECT MAX(version) AS v FROM model_artifacts WHERE sport = $1 AND market = $2 AND model_name = $3",
                input.sport,
                input.market,
                input.model_name,
            )
            next_version = (max_version_row["v"] or 0) + 1

            if activate:
                await conn.execute(
                    "UPDATE model_artifacts SET active = false WHERE sport = $1 AND market = $2 AND model_name = $3",
                    input.sport,
                    input.market,
                    input.model_name,
                )

            await conn.execute(
                """
                INSERT INTO model_artifacts
                  (sport, market, model_name, version, artifact_json, artifact_blob, train_games, train_log_loss,
                   train_brier, holdout_games, holdout_log_loss, holdout_brier, active, fitted_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
                """,
                input.sport,
                input.market,
                input.model_name,
                next_version,
                json.dumps(input.artifact_json) if input.artifact_json is not None else None,
                input.artifact_blob,
                input.train_games,
                input.train_log_loss,
                input.train_brier,
                input.holdout_games,
                input.holdout_log_loss,
                input.holdout_brier,
                activate,
            )

            row = await conn.fetchrow(
                "SELECT * FROM model_artifacts WHERE sport = $1 AND market = $2 AND model_name = $3 AND version = $4",
                input.sport,
                input.market,
                input.model_name,
                next_version,
            )

    return ModelArtifactRow(
        id=row["id"],
        sport=row["sport"],
        market=row["market"],
        model_name=row["model_name"],
        version=row["version"],
        artifact_json=_json_or_none(row["artifact_json"]),
        artifact_blob=row["artifact_blob"],
        train_games=row["train_games"],
        train_log_loss=row["train_log_loss"],
        train_brier=row["train_brier"],
        holdout_games=row["holdout_games"],
        holdout_log_loss=row["holdout_log_loss"],
        holdout_brier=row["holdout_brier"],
        active=row["active"],
        fitted_at=row["fitted_at"].isoformat(),
    )


@dataclass
class HistoricalOddsRow:
    ml_home_consensus_prob: float | None
    ml_away_consensus_prob: float | None
    total_line: float | None
    total_over_consensus_prob: float | None
    total_under_consensus_prob: float | None
    ml_home_open_prob: float | None
    ml_away_open_prob: float | None
    total_open_line: float | None
    total_open_over_prob: float | None
    total_open_under_prob: float | None
    book_count: int | None


async def get_historical_odds(season: int, game_date: str, home_team_id: int, away_team_id: int) -> HistoricalOddsRow | None:
    """Direct port of lib/db/client.ts's getHistoricalOdds."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT ml_home_consensus_prob, ml_away_consensus_prob, total_line, total_over_consensus_prob,
               total_under_consensus_prob, ml_home_open_prob, ml_away_open_prob,
               total_open_line, total_open_over_prob, total_open_under_prob, book_count
        FROM historical_odds WHERE season = $1 AND game_date = $2 AND home_team_id = $3 AND away_team_id = $4
        """,
        season,
        _to_date(game_date),
        home_team_id,
        away_team_id,
    )
    if row is None:
        return None
    return HistoricalOddsRow(
        ml_home_consensus_prob=row["ml_home_consensus_prob"],
        ml_away_consensus_prob=row["ml_away_consensus_prob"],
        total_line=row["total_line"],
        total_over_consensus_prob=row["total_over_consensus_prob"],
        total_under_consensus_prob=row["total_under_consensus_prob"],
        ml_home_open_prob=row["ml_home_open_prob"],
        ml_away_open_prob=row["ml_away_open_prob"],
        total_open_line=row["total_open_line"],
        total_open_over_prob=row["total_open_over_prob"],
        total_open_under_prob=row["total_open_under_prob"],
        book_count=row["book_count"],
    )


async def get_earliest_observed_total_point(event_id: str) -> float | None:
    """Scoped to source = 'the-odds-api' (2026-08-25): this feeds the total
    model's opening-line feature, which was fit against the-odds-api's
    history only. Now that OddsHarvester also writes rows here, an
    unscoped query could pick up an OddsHarvester observation as the
    "opening" point instead — a real behavior change for an existing,
    already-fitted model, not something to let happen as a side effect of
    adding a second writer."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT point FROM game_odds_history WHERE event_id = $1 AND market = 'total' AND point IS NOT NULL AND source = 'the-odds-api' ORDER BY observed_at ASC LIMIT 1",
        event_id,
    )
    return row["point"] if row else None


@dataclass
class GameOddsBookLineRow:
    sport: str
    game_id: str
    market: str
    side: str
    bookmaker: str
    source: str
    american_odds: int
    point: float | None
    decimal_odds: float | None
    fetched_at: str


def _map_game_odds_book_line_row(r) -> GameOddsBookLineRow:
    return GameOddsBookLineRow(
        sport=r["sport"],
        game_id=r["game_id"],
        market=r["market"],
        side=r["side"],
        bookmaker=r["bookmaker"],
        source=r["source"],
        american_odds=r["american_odds"],
        point=r["point"],
        decimal_odds=r["decimal_odds"],
        fetched_at=r["fetched_at"].isoformat(),
    )


async def read_game_odds_book_lines_for_source(sport: str, source: str) -> list[GameOddsBookLineRow]:
    """Every current row a given source has written for a sport — the read
    half of write_game_odds_book_lines. Not filtered to "today's games";
    callers cross-reference against their own real slate (a source's row
    for a game that's no longer on today's slate is simply ignored by that
    join, same discipline _game_odds_book_line_rows already uses when a
    GameLine doesn't match any current SnapshotGame)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT sport, game_id, market, side, bookmaker, source, american_odds, point, decimal_odds, fetched_at
        FROM game_odds_book_lines WHERE sport = $1 AND source = $2
        """,
        sport,
        source,
    )
    return [_map_game_odds_book_line_row(r) for r in rows]


@dataclass
class GameOddsBookLineInput:
    """One bookmaker's current price for one game/market/side — the row
    shape behind the bookmaker-column/market-row heat-mapped table on Game
    Detail. Distinct from GameOddsHistoryInput: this is a pure upsert (one
    current row per key), not an append-only log — game_odds_history stays
    the archive, this is just "what does the grid show right now." `source`
    is part of the key for the same reason as game_odds_history: OddsHarvester
    and the-odds-api are independent writers and must never overwrite each
    other's reading of a nominal bookmaker."""

    sport: str
    game_id: str
    market: str  # 'moneyline' | 'spread' | 'total'
    side: str
    bookmaker: str
    source: str
    american_odds: int
    point: float | None = None
    decimal_odds: float | None = None


async def write_game_odds_book_lines(rows: list[GameOddsBookLineInput]) -> None:
    """Upserts current per-bookmaker game-line prices. Safe to call with a
    fresh full snapshot every cycle — ON CONFLICT DO UPDATE means a
    bookmaker that drops out of this cycle's results simply stops being
    refreshed (its last-known row stays, timestamped), it is never deleted;
    only a matching (sport, game_id, market, side, bookmaker, source) key
    is ever touched, so this can never affect a different source's rows."""
    if not rows:
        return
    fetched_at = datetime.now(timezone.utc)
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                await conn.execute(
                    """
                    INSERT INTO game_odds_book_lines
                        (sport, game_id, market, side, bookmaker, source, point, american_odds, decimal_odds, fetched_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (sport, game_id, market, side, bookmaker, source) DO UPDATE SET
                        point = excluded.point,
                        american_odds = excluded.american_odds,
                        decimal_odds = excluded.decimal_odds,
                        fetched_at = excluded.fetched_at
                    """,
                    r.sport,
                    r.game_id,
                    r.market,
                    r.side,
                    r.bookmaker,
                    r.source,
                    r.point,
                    r.american_odds,
                    r.decimal_odds,
                    fetched_at,
                )


# ---------------------------------------------------------------------------
# Python's independently-computed gameModel + Elo (Phase N of the TS
# cutover gameplan) — additive only, nothing reads this yet.
# ---------------------------------------------------------------------------


@dataclass
class GameModelCacheRow:
    sport: str
    game_id: str
    home_expected_runs: float
    away_expected_runs: float
    home_win_prob: float
    away_win_prob: float
    diagnostics_json: str
    home_elo: float
    home_games_played: int
    away_elo: float
    away_games_played: int
    home_rest_days: float
    away_rest_days: float
    home_travel_miles: float
    away_travel_miles: float
    home_pitcher_adj: float
    away_pitcher_adj: float
    computed_at: str


async def write_game_model_cache(row: GameModelCacheRow) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO mlb_game_model_cache (
          sport, game_id, home_expected_runs, away_expected_runs, home_win_prob, away_win_prob,
          diagnostics_json, home_elo, home_games_played, away_elo, away_games_played,
          home_rest_days, away_rest_days, home_travel_miles, away_travel_miles,
          home_pitcher_adj, away_pitcher_adj, computed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (sport, game_id) DO UPDATE SET
          home_expected_runs = excluded.home_expected_runs, away_expected_runs = excluded.away_expected_runs,
          home_win_prob = excluded.home_win_prob, away_win_prob = excluded.away_win_prob,
          diagnostics_json = excluded.diagnostics_json,
          home_elo = excluded.home_elo, home_games_played = excluded.home_games_played,
          away_elo = excluded.away_elo, away_games_played = excluded.away_games_played,
          home_rest_days = excluded.home_rest_days, away_rest_days = excluded.away_rest_days,
          home_travel_miles = excluded.home_travel_miles, away_travel_miles = excluded.away_travel_miles,
          home_pitcher_adj = excluded.home_pitcher_adj, away_pitcher_adj = excluded.away_pitcher_adj,
          computed_at = excluded.computed_at
        """,
        row.sport,
        row.game_id,
        row.home_expected_runs,
        row.away_expected_runs,
        row.home_win_prob,
        row.away_win_prob,
        row.diagnostics_json,
        row.home_elo,
        row.home_games_played,
        row.away_elo,
        row.away_games_played,
        row.home_rest_days,
        row.away_rest_days,
        row.home_travel_miles,
        row.away_travel_miles,
        row.home_pitcher_adj,
        row.away_pitcher_adj,
        _to_datetime(row.computed_at),
    )


async def read_game_model_cache(sport: str, game_id: str) -> GameModelCacheRow | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT sport, game_id, home_expected_runs, away_expected_runs, home_win_prob, away_win_prob,
          diagnostics_json, home_elo, home_games_played, away_elo, away_games_played,
          home_rest_days, away_rest_days, home_travel_miles, away_travel_miles,
          home_pitcher_adj, away_pitcher_adj, computed_at
        FROM mlb_game_model_cache WHERE sport = $1 AND game_id = $2
        """,
        sport,
        game_id,
    )
    if row is None:
        return None
    return GameModelCacheRow(
        sport=row["sport"],
        game_id=row["game_id"],
        home_expected_runs=row["home_expected_runs"],
        away_expected_runs=row["away_expected_runs"],
        home_win_prob=row["home_win_prob"],
        away_win_prob=row["away_win_prob"],
        diagnostics_json=row["diagnostics_json"],
        home_elo=row["home_elo"],
        home_games_played=row["home_games_played"],
        away_elo=row["away_elo"],
        away_games_played=row["away_games_played"],
        home_rest_days=row["home_rest_days"],
        away_rest_days=row["away_rest_days"],
        home_travel_miles=row["home_travel_miles"],
        away_travel_miles=row["away_travel_miles"],
        home_pitcher_adj=row["home_pitcher_adj"],
        away_pitcher_adj=row["away_pitcher_adj"],
        computed_at=row["computed_at"].isoformat(),
    )


# ---------------------------------------------------------------------------
# System events — lightweight error log (direct port of lib/db/client.ts's
# logSystemEvent)
# ---------------------------------------------------------------------------

SYSTEM_EVENTS_ROW_CAP = 500


async def log_system_event(level: str, source: str, message: str, detail: str | None = None) -> None:
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO system_events (level, source, message, detail) VALUES ($1, $2, $3, $4)",
        level,
        source,
        message,
        detail,
    )
    await pool.execute(
        "DELETE FROM system_events WHERE id NOT IN (SELECT id FROM system_events ORDER BY occurred_at DESC LIMIT $1)",
        SYSTEM_EVENTS_ROW_CAP,
    )


# ---------------------------------------------------------------------------
# Golf history (direct port of lib/db/client.ts's golf write functions) —
# Track C of the prediction-engine port.
# ---------------------------------------------------------------------------


@dataclass
class GolfTournamentInput:
    event_id: str
    name: str
    course_name: str | None
    season: int
    start_date: str | None
    holes_json: str | None
    field_size: int | None


async def write_golf_tournament(input: GolfTournamentInput) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO golf_tournaments (event_id, name, course_name, season, start_date, holes_json, field_size, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (event_id) DO UPDATE SET
          name = excluded.name, course_name = excluded.course_name, start_date = excluded.start_date,
          holes_json = excluded.holes_json, field_size = excluded.field_size, updated_at = excluded.updated_at
        """,
        input.event_id,
        input.name,
        input.course_name,
        input.season,
        _to_date(input.start_date) if input.start_date else None,
        input.holes_json,
        input.field_size,
    )


@dataclass
class GolfHoleScoreInput:
    event_id: str
    espn_id: str
    round: int
    hole: int
    par: int | None
    strokes: int | None
    relative_to_par: float
    category: str  # 'birdie' | 'par' | 'bogey'


async def write_golf_hole_scores(rows: list[GolfHoleScoreInput]) -> int:
    """Idempotent on the (event, golfer, round, hole) key — re-polling an
    already-ingested hole is a silent no-op, so the caller can just hand
    every completed hole it sees on every poll without tracking what's new."""
    if not rows:
        return 0
    written = 0
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                status = await conn.execute(
                    """
                    INSERT INTO golf_hole_scores (event_id, espn_id, round, hole, par, strokes, relative_to_par, category, ingested_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
                    ON CONFLICT (event_id, espn_id, round, hole) DO NOTHING
                    """,
                    r.event_id,
                    r.espn_id,
                    r.round,
                    r.hole,
                    r.par,
                    r.strokes,
                    r.relative_to_par,
                    r.category,
                )
                if _rowcount_from_status(status) > 0:
                    written += 1
    return written


@dataclass
class GolfRoundScoreInput:
    event_id: str
    espn_id: str
    round: int
    total_strokes: int | None
    relative_to_par: float
    tee_wave: str | None  # 'AM' | 'PM' | None
    wind_mph: float | None
    temp_f: float | None
    precip_prob: float | None


async def write_golf_round_scores(rows: list[GolfRoundScoreInput]) -> int:
    if not rows:
        return 0
    written = 0
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                status = await conn.execute(
                    """
                    INSERT INTO golf_round_scores (event_id, espn_id, round, total_strokes, relative_to_par, tee_wave, wind_mph, temp_f, precip_prob, ingested_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
                    ON CONFLICT (event_id, espn_id, round) DO NOTHING
                    """,
                    r.event_id,
                    r.espn_id,
                    r.round,
                    r.total_strokes,
                    r.relative_to_par,
                    r.tee_wave,
                    r.wind_mph,
                    r.temp_f,
                    r.precip_prob,
                )
                if _rowcount_from_status(status) > 0:
                    written += 1
    return written


@dataclass
class GolfTournamentResultInput:
    event_id: str
    espn_id: str
    position: str | None
    made_cut: bool
    total_score: int | None


async def write_golf_tournament_results(rows: list[GolfTournamentResultInput]) -> int:
    if not rows:
        return 0
    written = 0
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                await conn.execute(
                    """
                    INSERT INTO golf_tournament_results (event_id, espn_id, position, made_cut, total_score, finished_at)
                    VALUES ($1, $2, $3, $4, $5, now())
                    ON CONFLICT (event_id, espn_id) DO UPDATE SET
                      position = excluded.position, made_cut = excluded.made_cut,
                      total_score = excluded.total_score, finished_at = excluded.finished_at
                    """,
                    r.event_id,
                    r.espn_id,
                    r.position,
                    r.made_cut,
                    r.total_score,
                )
                written += 1
    return written


# ---------------------------------------------------------------------------
# Golf model performance tracking (direct port of lib/db/client.ts's
# logGolfModelPredictions/logGolfTournamentPredictions and grading reads)
# ---------------------------------------------------------------------------


@dataclass
class GolfModelPredictionInput:
    event_id: str
    espn_id: str
    dimension: str
    round: int
    category: str  # 'birdie' | 'par' | 'bogey'
    predicted_prob: float
    league_rate: float | None


async def log_golf_model_predictions(rows: list[GolfModelPredictionInput]) -> int:
    """Upserts the LATEST prediction per (event, golfer, dimension, round)
    — but only while ungraded. Once a real outcome has graded a row, a
    later poll's "prediction" (made after the fact) must never overwrite it."""
    if not rows:
        return 0
    written = 0
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                status = await conn.execute(
                    """
                    INSERT INTO golf_model_predictions (event_id, espn_id, dimension, round, category, predicted_prob, league_rate, predicted_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, now())
                    ON CONFLICT (event_id, espn_id, dimension, round) DO UPDATE SET
                      category = excluded.category, predicted_prob = excluded.predicted_prob,
                      league_rate = excluded.league_rate, predicted_at = excluded.predicted_at
                    WHERE golf_model_predictions.graded_at IS NULL
                    """,
                    r.event_id,
                    r.espn_id,
                    r.dimension,
                    r.round,
                    r.category,
                    r.predicted_prob,
                    r.league_rate,
                )
                if _rowcount_from_status(status) > 0:
                    written += 1
    return written


@dataclass
class GolfTournamentPredictionInput:
    event_id: str
    espn_id: str
    prob_win: float
    prob_top5: float
    prob_top10: float
    prob_made_cut: float


async def log_golf_tournament_predictions(rows: list[GolfTournamentPredictionInput]) -> int:
    if not rows:
        return 0
    written = 0
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                status = await conn.execute(
                    """
                    INSERT INTO golf_tournament_predictions (event_id, espn_id, prob_win, prob_top5, prob_top10, prob_made_cut, predicted_at)
                    VALUES ($1, $2, $3, $4, $5, $6, now())
                    ON CONFLICT (event_id, espn_id) DO UPDATE SET
                      prob_win = excluded.prob_win, prob_top5 = excluded.prob_top5, prob_top10 = excluded.prob_top10,
                      prob_made_cut = excluded.prob_made_cut, predicted_at = excluded.predicted_at
                    WHERE golf_tournament_predictions.graded_at IS NULL
                    """,
                    r.event_id,
                    r.espn_id,
                    r.prob_win,
                    r.prob_top5,
                    r.prob_top10,
                    r.prob_made_cut,
                )
                if _rowcount_from_status(status) > 0:
                    written += 1
    return written


@dataclass
class GradeableHolePrediction:
    id: int
    event_id: str
    espn_id: str
    dimension: str
    round: int
    category: str
    predicted_prob: float
    actual_category: str


async def find_gradeable_hole_predictions() -> list[GradeableHolePrediction]:
    pool = await get_pool()
    hole_rows = await pool.fetch(
        """
        SELECT p.id AS id, p.event_id AS event_id, p.espn_id AS espn_id, p.dimension AS dimension, p.round AS round,
               p.category AS category, p.predicted_prob AS predicted_prob, hs.category AS actual_category
        FROM golf_model_predictions p
        JOIN golf_hole_scores hs
          ON hs.event_id = p.event_id AND hs.espn_id = p.espn_id AND hs.round = p.round
         AND hs.hole = CAST(SUBSTRING(p.dimension FROM 6) AS INTEGER)
        WHERE p.graded_at IS NULL AND p.dimension LIKE 'hole-%'
        """
    )
    round_rows = await pool.fetch(
        """
        SELECT p.id AS id, p.event_id AS event_id, p.espn_id AS espn_id, p.dimension AS dimension, p.round AS round,
               p.category AS category, p.predicted_prob AS predicted_prob, rs.category AS actual_category
        FROM golf_model_predictions p
        JOIN (
          SELECT event_id, espn_id, round,
                 CASE WHEN relative_to_par < 0 THEN 'birdie' WHEN relative_to_par = 0 THEN 'par' ELSE 'bogey' END AS category
          FROM golf_round_scores
        ) rs ON rs.event_id = p.event_id AND rs.espn_id = p.espn_id AND rs.round = p.round
        WHERE p.graded_at IS NULL AND p.dimension = 'round-score'
        """
    )
    return [
        GradeableHolePrediction(
            id=r["id"],
            event_id=r["event_id"],
            espn_id=r["espn_id"],
            dimension=r["dimension"],
            round=r["round"],
            category=r["category"],
            predicted_prob=r["predicted_prob"],
            actual_category=r["actual_category"],
        )
        for r in [*hole_rows, *round_rows]
    ]


@dataclass
class GradedHolePredictionInput:
    id: int
    hit: int  # 0 | 1
    actual_category: str
    brier_component: float


async def write_graded_hole_predictions(rows: list[GradedHolePredictionInput]) -> None:
    if not rows:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                await conn.execute(
                    "UPDATE golf_model_predictions SET graded_at = now(), actual_category = $1, hit = $2, brier_component = $3 WHERE id = $4",
                    r.actual_category,
                    bool(r.hit),
                    r.brier_component,
                    r.id,
                )


@dataclass
class GradeableTournamentPrediction:
    event_id: str
    espn_id: str
    prob_win: float
    prob_top5: float
    prob_top10: float
    prob_made_cut: float
    position: str | None
    made_cut: bool


async def find_gradeable_tournament_predictions() -> list[GradeableTournamentPrediction]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT p.event_id AS event_id, p.espn_id AS espn_id, p.prob_win AS prob_win, p.prob_top5 AS prob_top5,
               p.prob_top10 AS prob_top10, p.prob_made_cut AS prob_made_cut, r.position AS position, r.made_cut AS made_cut
        FROM golf_tournament_predictions p
        JOIN golf_tournament_results r ON r.event_id = p.event_id AND r.espn_id = p.espn_id
        WHERE p.graded_at IS NULL
        """
    )
    return [
        GradeableTournamentPrediction(
            event_id=r["event_id"],
            espn_id=r["espn_id"],
            prob_win=r["prob_win"],
            prob_top5=r["prob_top5"],
            prob_top10=r["prob_top10"],
            prob_made_cut=r["prob_made_cut"],
            position=r["position"],
            made_cut=r["made_cut"],
        )
        for r in rows
    ]


@dataclass
class GradedTournamentPredictionInput:
    event_id: str
    espn_id: str
    won: int  # 0 | 1
    top5: int
    top10: int
    made_cut: int
    brier_win: float
    brier_top5: float
    brier_top10: float
    brier_made_cut: float


async def write_graded_tournament_predictions(rows: list[GradedTournamentPredictionInput]) -> None:
    if not rows:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in rows:
                await conn.execute(
                    """
                    UPDATE golf_tournament_predictions SET
                      graded_at = now(), actual_won = $1, actual_top5 = $2, actual_top10 = $3, actual_made_cut = $4,
                      brier_win = $5, brier_top5 = $6, brier_top10 = $7, brier_made_cut = $8
                    WHERE event_id = $9 AND espn_id = $10
                    """,
                    bool(r.won),
                    bool(r.top5),
                    bool(r.top10),
                    bool(r.made_cut),
                    r.brier_win,
                    r.brier_top5,
                    r.brier_top10,
                    r.brier_made_cut,
                    r.event_id,
                    r.espn_id,
                )
