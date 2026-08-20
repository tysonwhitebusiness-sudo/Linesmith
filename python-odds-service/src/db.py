"""Postgres access — one asyncpg pool, shared by every job. Mirrors
lib/db/pgClient.ts's connection settings (Supabase's cert chain needs
rejectUnauthorized:false there; the equivalent here is an SSL context with
verification disabled) so this hits the exact same database the TS app uses.

Deliberately thin: no ORM, no query builder, just the handful of raw queries
this rough harness actually needs.
"""
import ssl
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
