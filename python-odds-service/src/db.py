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


def eastern_date_key(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.astimezone(_EASTERN).strftime("%Y-%m-%d")


def eastern_month_key(now: datetime | None = None) -> str:
    return eastern_date_key(now)[:7]


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
        eastern_date_key(),
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
    await _increment_usage(provider_id, "daily", eastern_date_key(), requests, objects)


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
    import json

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
