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
import asyncio
import json
import re
import ssl
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import asyncpg

from config import DATABASE_URL, DB_POOLER_MODE
# Safe one-way import: entity_resolution.py depends only on `re`/`unicodedata`
# and never imports db, so this cannot cycle. Used by
# write_game_odds_book_lines to canonicalise bookmaker spellings at the one
# choke point every Python game-line writer already passes through (task 5.3).
from entity_resolution import canonical_bookmaker

_pool: asyncpg.Pool | None = None

_EASTERN = ZoneInfo("America/New_York")

# Real, live-confirmed condition (2026-08-26): the shared Supabase pooler
# caps at 15 total connections across every consumer — this worker, the
# health-check cron job, the TS app, and any local script hitting the same
# database. A cron job spinning up a brand-new pool every 15 minutes can
# land on a moment where that cap is momentarily saturated by something
# else's own short-lived connections, and asyncpg.create_pool() has always
# failed outright on the first attempt rather than retrying — even TS's own
# withConnectionRetry (lib/db/pgClient.ts) doesn't cover this specific
# error (it only retries connection-reset/timeout, not "pool full"). A
# transient EMAXCONNSESSION deserves a short retry, not an immediate crash.
_POOL_CREATE_RETRIES = 3
_POOL_CREATE_RETRY_DELAY_S = 3.0


def _transaction_mode_dsn(dsn: str) -> str:
    """Session-mode DSNs (config.py's DATABASE_URL) point at Supavisor's
    port 5432. Transaction mode is the same host/user/db, just port 6543 —
    swap it rather than requiring a second, easy-to-drift env var.

    Idempotent since Phase 0.5 (docs/audit-remediation-plan.md): a DSN that
    already names :6543 comes back unchanged rather than raising. Before this,
    pointing DATABASE_URL straight at :6543 — which is exactly what 0.5 does to
    the TypeScript app's own copy, since lib/db/pgClient.ts has no swap logic
    of its own — would crash any Python process that ALSO had
    DB_POOLER_MODE=transaction set, at startup, with a ValueError. Two
    individually-correct settings combining into a boot failure is not a
    configuration anyone should have to hold in their head."""
    if re.search(r":6543(/|$)", dsn):
        return dsn
    swapped, n = re.subn(r":5432(/|$)", r":6543\1", dsn, count=1)
    if n == 0:
        raise ValueError(f"DB_POOLER_MODE=transaction but DATABASE_URL names neither :5432 nor :6543: {dsn!r}")
    return swapped


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        # The DSN's own port is authoritative, not just the flag. Phase 0.5
        # points DATABASE_URL straight at :6543 (the TypeScript app has no
        # swap logic of its own), which left a machine with DB_POOLER_MODE
        # unset — the default, "session" — talking to the TRANSACTION pooler
        # while believing it was in session mode. That combination is not a
        # crash, which is what makes it nasty: it turns asyncpg's statement
        # cache back on against a pooler that hands out a different physical
        # backend per transaction, and the first repeated query dies with
        # DuplicatePreparedStatementError. Reproduced locally on 2026-08-28,
        # immediately after this file's own 0.5 change. Deriving the mode from
        # the resolved DSN means the port and the behaviour cannot disagree.
        dsn = _transaction_mode_dsn(DATABASE_URL) if DB_POOLER_MODE == "transaction" else DATABASE_URL
        transaction_mode = bool(re.search(r":6543(/|$)", dsn))
        # server_settings applies statement_timeout as a session default on
        # every connection this pool ever opens — a single query (or a lock
        # wait inside one) that runs past 15s gets killed by Postgres itself
        # with a clean QueryCanceledError, instead of hanging indefinitely.
        # This is the query-execution half of the same 2026-08-22 hang fix
        # pool.acquire(timeout=...) below is the connection-acquisition half
        # of: acquire() only bounds getting a connection, not what happens
        # once a query is running on it — a real, plausible mechanism for
        # that incident, since write_prop_odds/write_game_odds_book_lines
        # both loop many individual INSERT/UPDATE statements inside one
        # transaction, and this exact table was, at the time, also being
        # written concurrently by the TS app's own now-removed
        # triggerFreshen() leftover (see app/api/props/lines/route.ts) — two
        # independent writers racing the same upsert keys, neither side
        # timeout-protected, is exactly the shape of thing that can leave
        # one side waiting on a row lock forever. Set at the connection
        # level (not per-transaction SET LOCAL) so it's automatic for every
        # query this pool ever runs, including any added later, rather than
        # something each new call site has to remember.
        last_error: Exception | None = None
        for attempt in range(_POOL_CREATE_RETRIES):
            try:
                # max_size=3 (2026-08-27, settled value, third change this
                # same day). Trimmed 5->3->2 earlier to free session-mode
                # room for the health-check cron's own connection, then
                # reverted all the way back to 5 once the cron moved to a
                # separate transaction-mode pool (config.py's
                # DB_POOLER_MODE) that no longer needs that room — but the
                # matching TS-side revert (lib/db/pgClient.ts, max:10)
                # immediately reproduced a real, live EMAXCONNSESSION on
                # that app itself. pg_stat_activity confirmed ~6 of
                # Supavisor's 15 session-mode slots are permanent Supabase
                # platform overhead (pg_net, pg_cron scheduler, Supavisor's
                # own auth_query/management connections, postgres_exporter,
                # PostgREST), leaving a real budget of ~9 — and a pool's
                # max_size is a ceiling it's ALLOWED to reach under real
                # concurrent load, not a fixed reservation, so TS alone at
                # max:10 could already claim the entire remaining budget
                # before this worker (which runs constantly in production)
                # touches it at all. Settled on 3 here + 6 on the TS side =
                # 9, matching the real measured budget exactly —
                # deliberately zero slack for ad-hoc local scripts, but no
                # structural overcommit between the two real, permanent
                # consumers.
                # statement_cache_size=0 (transaction mode only): asyncpg
                # caches prepared statements per physical connection, but a
                # transaction-mode pooler can hand a client a different
                # physical backend on every transaction — a cached statement
                # id from backend A is meaningless on backend B. Session mode
                # doesn't have this problem (one dedicated backend for the
                # connection's life), so the default (cache on) stays there.
                _pool = await asyncpg.create_pool(
                    dsn=dsn,
                    ssl=ctx,
                    min_size=1,
                    max_size=3,
                    server_settings={"statement_timeout": "15000"},
                    statement_cache_size=0 if transaction_mode else 100,
                )
                break
            except Exception as e:
                last_error = e
                if attempt < _POOL_CREATE_RETRIES - 1:
                    print(
                        f"[db] pool creation failed (attempt {attempt + 1}/{_POOL_CREATE_RETRIES}): "
                        f"{type(e).__name__}: {e} — retrying in {_POOL_CREATE_RETRY_DELAY_S}s",
                        flush=True,
                    )
                    await asyncio.sleep(_POOL_CREATE_RETRY_DELAY_S)
        else:
            raise last_error
    return _pool


# Every `pool.acquire()` call in this file passes `timeout=15.0` — without
# an explicit timeout, asyncpg's Pool.acquire() waits forever if every
# pooled connection is checked out. A real, confirmed contributor to a
# 4-day worker hang (2026-08-22 incident): every acquire() call site in
# this file had no timeout at the time, so a starved pool at the wrong
# moment blocked its caller indefinitely — no exception, no log line,
# nothing for job_queue.py's own watchdog to ever see (a fully blocking
# wait like that can also starve the watchdog's own polling loop of a turn
# on the event loop). A clean TimeoutError here is always better than an
# unbounded wait, watchdog or not.


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


async def try_reserve(
    provider_id: str, period_kind: str, period_key: str, amount: int, limit: int, unit: str = "requests"
) -> bool:
    """Atomically claim `amount` of a provider's budget, or refuse.

    Task 5.12 (P4 M8). The increments were already safe
    (ON CONFLICT DO UPDATE SET count = count + excluded), and TS/Python agree
    on period keys. The race was CHECK-THEN-ACT: two processes both read
    "under cap" and both then spent. Reading and reserving are one statement
    here, so only one of them can win the last unit.

    The WHERE clause on DO UPDATE is what makes it conditional — when the
    increment would breach the limit the update matches no row, RETURNING
    yields nothing, and this returns False WITHOUT having incremented.
    """
    col = "object_count" if unit == "objects" else "request_count"
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        INSERT INTO provider_usage (provider_id, period_kind, period_key, {col}, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (provider_id, period_kind, period_key) DO UPDATE
           SET {col} = provider_usage.{col} + excluded.{col},
               updated_at = now()
         WHERE provider_usage.{col} + excluded.{col} <= $5
        RETURNING {col}
        """,
        provider_id,
        period_kind,
        period_key,
        amount,
        limit,
    )
    return row is not None


async def try_reserve_daily(provider_id: str, amount: int, limit: int) -> bool:
    return await try_reserve(provider_id, "daily", utc_date_key(), amount, limit)


async def try_reserve_monthly(provider_id: str, amount: int, limit: int, unit: str = "requests") -> bool:
    return await try_reserve(provider_id, "monthly", eastern_month_key(), amount, limit, unit)


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
        # Still non-fatal, for the reason above — but no longer INVISIBLE
        # (task 5.12, P4 M8). A swallowed spend-record failure makes recorded
        # spend a silent FLOOR rather than the real number, which means every
        # cap check downstream is reading an under-count and believing it.
        # Printing to stdout alone means it is only ever seen by someone
        # already tailing Render's log at the right moment.
        print(f"[db] record spend failed for {provider_id} (non-fatal): {type(e).__name__}: {e}", flush=True)
        try:
            await log_system_event(
                "error",
                "db.record_spend",
                f"spend record failed for {provider_id} — recorded spend is now an under-count",
                f"{period_kind} {period_key}: requests={requests} objects={objects}; {type(e).__name__}: {e}",
            )
        except Exception:
            # The event log lives in the same database. If that is what is
            # broken, the stdout line above is all there is; do not mask the
            # original failure behind a second one.
            pass


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

    Real writes to the exact tables the live TS app reads from.

    This docstring used to end: "this is the one function in this file that
    isn't a diagnostic/breadcrumb write, which is exactly why it stays
    disconnected from any live fetch path until that's a deliberate,
    separate decision." **That was false, and had been for a long time**
    (finding P2 M6.1). It is called by job_runner.run_provider_specs on
    every provider job, and had written 290,663 prop_odds rows by the time
    the audit measured it. It is the primary write path in the system, not
    a disconnected one.

    The sentence was true when written and nobody revisited it once the job
    runner started calling it — which is the whole reason rule 3 of
    docs/audit-remediation-plan.md exists: no comment describing runtime
    behaviour ships without the observation that proves it. Corrected in
    task 2.8. As of 2026-08-29 the callers are every ProviderSpec-driven
    job in jobs.py, via job_runner.
    """
    if not rows:
        return
    fetched_at = datetime.now(timezone.utc)

    # Deduplicate within the batch on the natural key, keeping the last row —
    # the per-row loop this replaced had that behaviour implicitly, since a
    # later write simply overwrote an earlier one's effect.
    latest: dict[tuple, PropOddsInput] = {}
    for r in rows:
        latest[(r.provider_id, r.game_id, r.subject_id, r.market_key, r.line, r.side, r.bookmaker)] = r
    batch = list(latest.values())

    pool = await get_pool()
    async with pool.acquire(timeout=30.0) as conn:
        async with conn.transaction():
            # ONE query for every prior price, not one per row — task 3.10,
            # finding P2 M7. This was 3 round-trips per row inside a single
            # transaction holding one pooled connection, which is the same
            # shape task 2.3 had to undo in write_game_odds_history where it
            # measured 290+ seconds on a real batch.
            #
            # `IS NOT DISTINCT FROM` on `line` is load-bearing and survives the
            # rewrite: line is nullable for categorical markets, and plain `=`
            # never matches NULL, so every categorical row would look new on
            # every cycle and append a history row forever.
            keys = list(latest.keys())
            prior_rows = await conn.fetch(
                """
                SELECT p.provider_id, p.game_id, p.subject_id, p.market_key, p.line, p.side, p.bookmaker, p.american_odds
                FROM prop_odds p
                JOIN unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::double precision[], $6::text[], $7::text[])
                     AS k(provider_id, game_id, subject_id, market_key, line, side, bookmaker)
                  ON p.provider_id = k.provider_id AND p.game_id = k.game_id AND p.subject_id = k.subject_id
                 AND p.market_key = k.market_key AND p.line IS NOT DISTINCT FROM k.line
                 AND p.side = k.side AND p.bookmaker = k.bookmaker
                """,
                [k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys], [k[3] for k in keys],
                [k[4] for k in keys], [k[5] for k in keys], [k[6] for k in keys],
            )
            prior = {
                (p["provider_id"], p["game_id"], p["subject_id"], p["market_key"], p["line"], p["side"], p["bookmaker"]): p["american_odds"]
                for p in prior_rows
            }

            # History is log-on-CHANGE only: a repeat of the same price on the
            # next cycle is not a history point.
            changed = [r for k, r in latest.items() if prior.get(k) != r.american_odds]
            if changed:
                await conn.executemany(
                    """
                    INSERT INTO prop_odds_history
                      (provider_id, game_id, subject_id, market_key, line, side, bookmaker,
                       american_odds, decimal_odds, observed_at, is_delayed, delay_seconds)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """,
                    [
                        (r.provider_id, r.game_id, r.subject_id, r.market_key, r.line, r.side, r.bookmaker,
                         r.american_odds, r.decimal_odds, fetched_at, r.is_delayed, r.delay_seconds)
                        for r in changed
                    ],
                )

            # Current state is upserted unconditionally, changed or not — the
            # fetched_at bump is what freshness checks read.
            await conn.executemany(
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
                [
                    (r.provider_id, r.game_id, r.subject_id, r.subject_name, r.market_key, r.line, r.side, r.bookmaker,
                     r.american_odds, r.decimal_odds, fetched_at, r.is_delayed, r.delay_seconds)
                    for r in batch
                ],
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
    # Required, not defaulted — team_elo_history was MLB-only by schema
    # until 2026-08-27's migration added this column; every writer must
    # say explicitly which sport's rating this is rather than risk a new
    # sport silently defaulting into MLB's own rows and corrupting both.
    sport: str


async def write_elo_history(rows: list[EloHistoryInput]) -> int:
    """Direct port of lib/db/client.ts's writeEloHistory. Append-only,
    idempotent via UNIQUE(sport, team_id, season, game_pk) — safe to call
    for an already-recorded game (no-op) or to re-run a full backfill
    without duplicating rows."""
    if not rows:
        return 0
    pool = await get_pool()
    written = 0
    async with pool.acquire(timeout=15.0) as conn:
        async with conn.transaction():
            for r in rows:
                status = await conn.execute(
                    """
                    INSERT INTO team_elo_history (sport, team_id, season, game_pk, game_date, elo, games_played, opponent_team_id, was_home)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (sport, team_id, season, game_pk) DO NOTHING
                    """,
                    r.sport,
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


async def get_current_elo(team_id: int, season: int, sport: str = "mlb") -> CurrentEloRow | None:
    """A team's most recent rating THIS season — None if they haven't
    played a rated game yet this season. `sport` defaults to 'mlb' so
    every pre-existing call site (elo_model.py) keeps working unchanged;
    new sports pass their own explicitly."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT elo, games_played, game_date, opponent_team_id, was_home
        FROM team_elo_history WHERE sport = $1 AND team_id = $2 AND season = $3
        ORDER BY game_date DESC, id DESC LIMIT 1
        """,
        sport,
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


async def get_latest_elo_before_season(team_id: int, season: int, sport: str = "mlb") -> CurrentEloRow | None:
    """A team's most recent rating from ANY season before the given one —
    the season-reversion path's source value."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT elo, games_played, game_date, opponent_team_id, was_home
        FROM team_elo_history WHERE sport = $1 AND team_id = $2 AND season < $3
        ORDER BY season DESC, game_date DESC, id DESC LIMIT 1
        """,
        sport,
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
# Player game history (persisted historical gamelogs, generic across sports)
# ---------------------------------------------------------------------------


@dataclass
class PlayerGameHistoryInput:
    sport: str
    athlete_id: str
    team_id: str | None
    season: int
    event_id: str
    game_date: str
    opponent_id: str | None
    is_home: bool
    stats: dict[str, float]


async def write_player_game_history(rows: list[PlayerGameHistoryInput]) -> int:
    """Append-only, idempotent via UNIQUE(sport, athlete_id, event_id) —
    safe to re-run the background historical pull for a player already
    partially recorded (no-op on rows already written).

    One multi-row INSERT per call (chunked), not a per-row loop: the
    ~5hr backfill (backfill_player_game_history.py) writes ~1.57M rows in
    batches of one game (~10-60 players) at a time, and a per-row round
    trip to the shared Supabase pooler made the write path — not the ESPN
    fetch — the run's real bottleneck (measured live: ~0.5 games/s, a
    projected >24h run). `RETURNING 1` gives the true inserted count
    (ON CONFLICT rows don't come back), so progress numbers stay honest."""
    if not rows:
        return 0
    pool = await get_pool()
    cols = 9
    # The real ceiling is 32,767, not 65,535: the Postgres wire protocol encodes
    # a statement's parameter count as a SIGNED 16-bit integer, and asyncpg
    # enforces that ("the number of query arguments cannot exceed 32767").
    # This said 60000 // 9 = 6,666 rows = ~60,000 parameters, i.e. nearly double
    # the limit, and the comment asserted it was "well under" it.
    #
    # It never fired because every caller until now wrote ONE GAME at a time
    # (~10-60 rows). Task 4.7's MLB branch writes a whole player-season in one
    # call (~130,000 rows) and hit it immediately. Latent since the function was
    # written; found by giving it a genuinely large batch for the first time.
    max_rows_per_stmt = 3000  # 27,000 parameters, a real margin under 32,767
    written = 0
    async with pool.acquire(timeout=30.0) as conn:
        async with conn.transaction():
            for start in range(0, len(rows), max_rows_per_stmt):
                chunk = rows[start:start + max_rows_per_stmt]
                params: list = []
                tuples: list[str] = []
                for i, r in enumerate(chunk):
                    b = i * cols
                    tuples.append(
                        f"(${b+1}, ${b+2}, ${b+3}, ${b+4}, ${b+5}, ${b+6}, ${b+7}, ${b+8}, ${b+9}::jsonb)"
                    )
                    params.extend(
                        [
                            r.sport,
                            r.athlete_id,
                            r.team_id,
                            r.season,
                            r.event_id,
                            _to_date(r.game_date),
                            r.opponent_id,
                            r.is_home,
                            json.dumps(r.stats),
                        ]
                    )
                returned = await conn.fetch(
                    "INSERT INTO player_game_history "
                    "(sport, athlete_id, team_id, season, event_id, game_date, opponent_id, is_home, stats) "
                    "VALUES " + ", ".join(tuples) +
                    " ON CONFLICT (sport, athlete_id, event_id) DO NOTHING RETURNING 1",
                    *params,
                )
                written += len(returned)
    return written


async def player_game_history_done_events(sport: str, season: int) -> set[str]:
    """Every event_id already fully recorded for one (sport, season) — the
    resume primitive for the ~5hr historical backfill
    (backfill_player_game_history.py). Because that job writes all of a
    game's players in one atomic batch, "has any row" is equivalent to
    "was fully processed", so the caller can skip the boxscore fetch
    entirely for anything in this set (docs/all-sports-prop-score-gameplan
    -2026-08-27.md's skip-before-fetch requirement — the row-level UNIQUE
    constraint alone would still re-pay for the network call)."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT DISTINCT event_id FROM player_game_history WHERE sport = $1 AND season = $2",
        sport,
        season,
    )
    return {r["event_id"] for r in rows}


async def player_game_history_progress() -> list[dict]:
    """The authoritative "where is the backfill" query — distinct games
    and total rows recorded per (sport, season), safe to run any time
    including after an unplanned restart."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT sport, season,
               COUNT(DISTINCT event_id) AS games_done,
               COUNT(*) AS rows_written,
               MAX(fetched_at) AS last_write
        FROM player_game_history
        GROUP BY sport, season
        ORDER BY sport, season
        """
    )
    return [dict(r) for r in rows]


async def fetch_player_game_stat(sport: str, athlete_id: str, event_id: str) -> dict | None:
    """One real (sport, athlete_id, event_id)'s stats dict — the read
    generic_prop_grading.py (Phase 7) needs to grade a real pick_history
    row: given the subject and the game that already finished, what did
    they actually record. `sport` here is player_game_history's own
    internal routing key (e.g. "soccer_epl", not the generic "soccer"
    pick_history stores) — see generic_prop_grading.py's own docstring
    for how a caller resolves that from pick_history's app-facing sport."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT stats FROM player_game_history WHERE sport = $1 AND athlete_id = $2 AND event_id = $3",
        sport,
        athlete_id,
        event_id,
    )
    if not row:
        return None
    stats = row["stats"]
    return json.loads(stats) if isinstance(stats, str) else stats


@dataclass
class UngradedPickRow:
    id: int
    subject_id: str
    dimension: str
    line: float | None
    game_id: str


async def ungraded_pick_history_for_sport(sport: str) -> list[UngradedPickRow]:
    """Every real pick_history row for one (app-facing) sport that hasn't
    been graded yet and has a real game_id to grade against — the read
    side of Phase 7's generic prop-grading job. Deliberately not scoped
    to "today" — an ungraded row from any past day should still get
    graded once its game turns out to be final, same reasoning
    game_pick_lock.py's own grading has no date filter either."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, subject_id, dimension, line, game_id FROM pick_history "
        "WHERE sport = $1 AND outcome IS NULL AND game_id IS NOT NULL",
        sport,
    )
    return [UngradedPickRow(id=r["id"], subject_id=r["subject_id"], dimension=r["dimension"], line=r["line"], game_id=r["game_id"]) for r in rows]


@dataclass
class PropModelCacheRow:
    sport: str
    game_id: str
    subject_id: str
    dimension: str
    category: str
    line: float | None
    model_prob: float | None
    model_std_dev: float | None
    model_sample_size: int | None
    league_rate: float | None
    matchup_favorable: bool | None
    model_version: int | None


async def write_prop_model_cache(rows: list[PropModelCacheRow]) -> int:
    """Current MLB prop model output, for lib/sports/mlb/adapter.ts to read
    instead of recomputing (task 2.7a). Upsert, not first-write-wins: this
    is mutable current state, deliberately unlike log_surfaced's immutable
    record of the same numbers — see migration 20260829010000 for why both
    exist and why they cannot disagree.

    One executemany, not a row loop. The write is per-candidate and a full
    slate is thousands of them; the per-row shape is what made
    write_game_odds_history take 290 seconds in task 2.3."""
    if not rows:
        return 0
    pool = await get_pool()
    async with pool.acquire(timeout=30.0) as conn:
        async with conn.transaction():
            await conn.executemany(
                """
                INSERT INTO mlb_prop_model_cache (
                  sport, game_id, subject_id, dimension, category, line,
                  model_prob, model_std_dev, model_sample_size, league_rate,
                  matchup_favorable, model_version, computed_at
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
                ON CONFLICT (sport, game_id, subject_id, dimension, category) DO UPDATE SET
                  line = excluded.line,
                  model_prob = excluded.model_prob,
                  model_std_dev = excluded.model_std_dev,
                  model_sample_size = excluded.model_sample_size,
                  league_rate = excluded.league_rate,
                  matchup_favorable = excluded.matchup_favorable,
                  model_version = excluded.model_version,
                  computed_at = excluded.computed_at
                """,
                [
                    (r.sport, r.game_id, r.subject_id, r.dimension, r.category, r.line,
                     r.model_prob, r.model_std_dev, r.model_sample_size, r.league_rate,
                     r.matchup_favorable, r.model_version)
                    for r in rows
                ],
            )
    return len(rows)


async def prune_prop_model_cache(before_days: int = 3) -> int:
    """Drops rows for slates that are well past. The cache only ever serves
    today's snapshot, so anything older is dead weight — and snapshot_cache
    growing unbounded at 8-15 MB/day is already a known problem
    (docs/audit-phase-2.md's growth projection). Not repeating it here."""
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM mlb_prop_model_cache WHERE computed_at < now() - ($1 || ' days')::interval",
        str(before_days),
    )
    return int(result.split()[-1]) if result.startswith("DELETE") else 0


@dataclass
class PickHistoryGrade:
    id: int
    outcome: str  # 'win' | 'loss'
    actual_value: float | None
    # The market's side of the edge, joined in at grading time (task 2.7b).
    # Grading is the first moment a row's surfaced_at can be matched against
    # the price history that was accumulating in prop_odds_history at the
    # same instant, so these are written here rather than at surface time.
    # All optional: a row with no two-sided price to join against is graded
    # on outcome alone, which is honest rather than a gap to fill in.
    market_prob: float | None = None
    edge: float | None = None
    price_source: str | None = None
    bookmaker: str | None = None
    price_captured_at: str | None = None


async def write_pick_history_grades(grades: list[PickHistoryGrade]) -> int:
    """`WHERE id = $1 AND outcome IS NULL` guard, same idempotent shape
    every other grading write in this codebase uses (db.grade_game_pick,
    lib/db/client.ts's writeGrades) — a race with a second grading pass
    is a harmless no-op, not a double-grade."""
    if not grades:
        return 0
    pool = await get_pool()
    graded = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            for g in grades:
                # COALESCE on the market-side columns, matching TS writeGrades:
                # a re-grade that finds no price must not blank a value an
                # earlier pass did manage to join.
                result = await conn.execute(
                    """
                    UPDATE pick_history SET
                      outcome = $1, actual_value = $2, graded_at = now(),
                      market_prob = COALESCE($4, market_prob),
                      edge = COALESCE($5, edge),
                      -- Task 4.9 (P3 H8). This writer's `edge` is
                      -- model_prob - devig(one book's two-sided price): "how
                      -- far our model is from a book". live_edge's
                      -- resolve_candidate_edge writes a DIFFERENT quantity
                      -- (sharp fair price minus what you would actually pay)
                      -- into the same column, and one threshold was being
                      -- applied to both. Each definition now also lands in its
                      -- own column, and this one names itself so a reader can
                      -- tell which it is holding.
                      edge_model_vs_market = COALESCE($5, edge_model_vs_market),
                      edge_source = COALESCE(edge_source, CASE WHEN $5::double precision IS NULL THEN NULL ELSE 'model_vs_market' END),
                      price_source = COALESCE($6, price_source),
                      bookmaker = COALESCE($7, bookmaker),
                      price_captured_at = COALESCE($8, price_captured_at)
                    WHERE id = $3 AND outcome IS NULL
                    """,
                    g.outcome,
                    g.actual_value,
                    g.id,
                    g.market_prob,
                    g.edge,
                    g.price_source,
                    g.bookmaker,
                    _parse_ts(g.price_captured_at),
                )
                if result == "UPDATE 1":
                    graded += 1
    return graded


@dataclass
class UngradedRow:
    id: int
    subject_id: str
    dimension: str
    category: str
    line: float | None
    market_key: str | None
    model_prob: float | None
    surfaced_at: str


async def list_ungraded_game_ids(sport: str = "mlb") -> list[str]:
    """Port of lib/db/client.ts's listUngradedGameIds, with one deliberate
    difference: it takes a `sport`. The TS original had none and scanned
    every ungraded row in the table regardless of sport, which was harmless
    while MLB was the only grader and is not now that generic_prop_grading
    also writes here."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT DISTINCT game_id FROM pick_history WHERE outcome IS NULL AND game_id IS NOT NULL AND sport = $1",
        sport,
    )
    return [r["game_id"] for r in rows]


async def list_ungraded_for_game(game_id: str, sport: str = "mlb") -> list[UngradedRow]:
    """Port of lib/db/client.ts's listUngradedForGame. Same `sport` scoping
    note as list_ungraded_game_ids above."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, subject_id, dimension, category, line, market_key, model_prob, surfaced_at
        FROM pick_history WHERE outcome IS NULL AND game_id = $1 AND sport = $2
        """,
        game_id,
        sport,
    )
    return [
        UngradedRow(
            id=r["id"], subject_id=r["subject_id"], dimension=r["dimension"], category=r["category"],
            line=r["line"], market_key=r["market_key"], model_prob=r["model_prob"],
            surfaced_at=r["surfaced_at"].isoformat() if r["surfaced_at"] else "",
        )
        for r in rows
    ]


@dataclass
class PropOddsHistoryPoint:
    provider_id: str
    bookmaker: str
    side: str
    american_odds: int
    observed_at: str


async def read_prop_odds_history_for_key(game_id: str, subject_id: str, market_key: str, line: float | None) -> list[PropOddsHistoryPoint]:
    """Every historical price point for one exact market+line — grading
    joins this against surfaced_at to recover the market's side of the edge
    after the fact. Port of readPropOddsHistoryForKey.

    `IS NOT DISTINCT FROM` on `line`, not `=`: a NULL line (moneyline, and
    any market whose line the provider didn't carry) must match NULL, which
    `=` never does. Carried over from the TS original deliberately."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT provider_id, bookmaker, side, american_odds, observed_at
        FROM prop_odds_history
        WHERE game_id = $1 AND subject_id = $2 AND market_key = $3 AND line IS NOT DISTINCT FROM $4
        """,
        game_id,
        subject_id,
        market_key,
        line,
    )
    return [
        PropOddsHistoryPoint(
            provider_id=r["provider_id"], bookmaker=r["bookmaker"], side=r["side"],
            american_odds=r["american_odds"],
            observed_at=r["observed_at"].isoformat() if r["observed_at"] else "",
        )
        for r in rows
    ]


async def fetch_player_games_from_db(sport: str, athlete_id: str, season: int | None = None) -> list["PlayerGameStat"]:
    """Reads persisted player_game_history back into the exact same
    PlayerGameStat shape predict/generic_player_gamelog.py's live-ESPN
    fetch_player_gamelog() returns, so generic_prop_score.py's callers can
    swap data sources (live fetch -> DB read) with zero changes to the
    scoring code itself once the historical backfill has landed. `season`
    omitted returns every season persisted so far, most-recent-first
    within each; pass it to scope to one season the way a live fetch call
    already must."""
    from predict.generic_player_gamelog import PlayerGameStat  # local import: avoids a db.py -> predict/ import cycle

    pool = await get_pool()
    if season is not None:
        rows = await pool.fetch(
            """
            SELECT event_id, game_date, opponent_id, is_home, stats
            FROM player_game_history
            WHERE sport = $1 AND athlete_id = $2 AND season = $3
            ORDER BY game_date ASC
            """,
            sport,
            athlete_id,
            season,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT event_id, game_date, opponent_id, is_home, stats
            FROM player_game_history
            WHERE sport = $1 AND athlete_id = $2
            ORDER BY game_date ASC
            """,
            sport,
            athlete_id,
        )
    return [
        PlayerGameStat(
            event_id=r["event_id"],
            game_date=r["game_date"].isoformat(),
            opponent_id=int(r["opponent_id"]) if r["opponent_id"] is not None else None,
            is_home=r["is_home"],
            stats=json.loads(r["stats"]) if isinstance(r["stats"], str) else dict(r["stats"]),
        )
        for r in rows
    ]


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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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

    BATCHED 2026-08-28 (task 2.3, pulling forward P4 H1's fix #2 which
    task 3.10 owns generally). This was one SELECT plus one conditional
    INSERT per row, inside a single transaction holding one pooled
    connection. Measured on the real workload task 2.3 hands it — the
    ~3,500 propline/sharpapi rows in game_odds_book_lines — that shape ran
    for over 290 seconds and had not finished. mlbOddsLinesCycleJob's
    interval is 300s and SequentialQueue's per-job timeout is 600s, so
    shipping 2.3 on the per-row loop would have produced a job that
    overran its own interval and eventually got cancelled mid-write.

    Now: one DISTINCT ON query for every prior price, an in-memory diff,
    and one executemany for the rows that actually changed. Semantics are
    unchanged — still log-on-change, still keyed on
    (event_id, market, side, bookmaker, source), still the
    (observed_at DESC, id DESC) ordering whose tiebreaker is load-bearing
    above.
    """
    if not rows:
        return
    observed_at = datetime.now(timezone.utc)

    # Deduplicate within the batch first, keeping the LAST row for a key —
    # same rule the per-row loop this replaced had by construction (a later
    # write simply overwrote an earlier one's effect). Two rows for one key
    # in a single call are real and expected; see _game_odds_history_rows
    # in predict/odds_lines_cycle.py for why.
    # Bookmaker is canonicalised BEFORE the dedup key is built (task 5.3,
    # extended to this table). The key below IS the log-on-change comparison,
    # so a split spelling means one book keeps two independent price histories
    # — a real move gets compared against the wrong history and missed, or a
    # first sighting under the other spelling looks like a change and is
    # inserted spuriously. This table had 36 spellings for 22 real books, and
    # it is also what task 6.1's line-movement charts will read.
    rows = [replace(r, bookmaker=canonical_bookmaker(r.bookmaker) or r.bookmaker) for r in rows]

    latest_in_batch: dict[tuple[str, str, str, str, str], GameOddsHistoryInput] = {}
    for r in rows:
        latest_in_batch[(r.event_id, r.market, r.side, r.bookmaker, r.source)] = r

    pool = await get_pool()
    async with pool.acquire(timeout=15.0) as conn:
        async with conn.transaction():
            # One query for every prior price, not one per row. DISTINCT ON
            # with the same (observed_at DESC, id DESC) ordering the per-row
            # SELECT used — the id tiebreaker is load-bearing, see this
            # function's docstring.
            keys = list(latest_in_batch.keys())
            prior_rows = await conn.fetch(
                """
                SELECT DISTINCT ON (event_id, market, side, bookmaker, source)
                       event_id, market, side, bookmaker, source, american_odds
                FROM game_odds_history
                WHERE (event_id, market, side, bookmaker, source) IN (
                    SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
                )
                ORDER BY event_id, market, side, bookmaker, source, observed_at DESC, id DESC
                """,
                [k[0] for k in keys],
                [k[1] for k in keys],
                [k[2] for k in keys],
                [k[3] for k in keys],
                [k[4] for k in keys],
            )
            prior = {
                (p["event_id"], p["market"], p["side"], p["bookmaker"], p["source"]): p["american_odds"]
                for p in prior_rows
            }

            changed = [r for k, r in latest_in_batch.items() if prior.get(k) != r.american_odds]
            if not changed:
                return
            await conn.executemany(
                """
                INSERT INTO game_odds_history (event_id, market, side, bookmaker, american_odds, point, observed_at, source)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                [(r.event_id, r.market, r.side, r.bookmaker, r.american_odds, r.point, observed_at, r.source) for r in changed],
            )


@dataclass
class ClosingPriceRow:
    american_odds: int
    observed_at: datetime
    bookmaker: str


async def get_closing_price(
    event_id: str, market: str, side: str, before: datetime, bookmaker_like: str
) -> ClosingPriceRow | None:
    """The last real observed price for one (event, market, side) at a
    specific reference book, strictly before `before` (a game's own
    commence_time) — this is what predict/clv_backtest.py means by "the
    closing line," read from game_odds_history's real observation log
    rather than game_picks' own two fixed capture-window snapshots (which
    can price a DIFFERENT side at the final capture than what was actually
    picked at the initial one, if the model's own pick flipped — wrong
    input for CLV, which needs the closing price of the side you actually
    entered). `bookmaker_like` is matched case-insensitively — the same
    nominal book shows up under inconsistent casing between writers
    (the-odds-api's 'DraftKings' vs oddsharvester's lowercase 'draftkings'),
    confirmed live 2026-08-27, not yet worth a full normalization pass."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT american_odds, observed_at, bookmaker FROM game_odds_history
        WHERE event_id = $1 AND market = $2 AND side = $3
          AND LOWER(bookmaker) = LOWER($4) AND observed_at < $5
        ORDER BY observed_at DESC, id DESC LIMIT 1
        """,
        event_id,
        market,
        side,
        bookmaker_like,
        before,
    )
    return ClosingPriceRow(american_odds=row["american_odds"], observed_at=row["observed_at"], bookmaker=row["bookmaker"]) if row else None


def _parse_ts(value: str | None) -> "datetime | None":
    """ISO-8601 string -> datetime, for TIMESTAMPTZ parameters asyncpg
    will not coerce from a string. Tolerates the trailing 'Z' ESPN's own
    `date` field uses, which datetime.fromisoformat rejects before Python
    3.11 — this service pins 3.12, but the shape is cheap to keep and the
    same strings flow through code paths that have been wrong about it
    before (see price_captured_at's comment in log_surfaced).

    Returns None rather than raising on an unparseable value: a bad
    timestamp should cost one row its leakage-auditability, not fail the
    whole batch insert it happens to be in."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


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
    # Which real reference actually produced market_prob/edge (2026-08-27
    # redesign, docs/edge-redesign-and-prop-score-gameplan-2026-08-27.md):
    # a named sharp book ('pinnacle'/'circa'/'novig'/'kalshi', Tier 1) or
    # 'consensus' (Tier 2, median across available books) — None when
    # neither existed for this candidate (edge/market_prob are also None
    # in that case).
    edge_source: str | None = None
    # Real bettable american-odds price at candidate-generation time
    # (live_edge.CandidateEdgeInfo.price) — added 2026-08-27 for Phase 7's
    # simulated $10 bankroll, which needs a real price to compute
    # profit/loss from (market_prob/edge are devigged, not a raw price).
    # None when no live price existed for this candidate, same as every
    # other price_* field here.
    price: int | None = None
    # When the predicted game actually starts (task 2.2, finding P3 H4).
    # A row is auditable for leakage only if this is set: `surfaced_at >=
    # commence_time` means the prediction was built after the game began,
    # and the ESPN gamelog it was built from may already contain the
    # outcome. NULL means "not auditable", never "safe" — the TypeScript
    # writer does not populate it, and every row written before 2026-08-28
    # predates the column. See the migration for why it stays nullable.
    commence_time: str | None = None


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
    async with pool.acquire(timeout=15.0) as conn:
        async with conn.transaction():
            for r in entries:
                await conn.execute(
                    """
                    INSERT INTO pick_history
                      (sport, subject_id, subject_name, dimension, category, market_key, line, game_id,
                       sample_size, distance, event_context, model_prob, market_prob, edge, price_source, bookmaker, price_captured_at,
                       prop_score, score_grade, trust_tier, model_version, edge_source, price, commence_time,
                       -- Task 4.9 (P3 H8): this writer's `edge` is the
                       -- SHARP-VS-SOFT quantity (a sharp book's fair price
                       -- minus what you would actually pay) — expected value in
                       -- probability units. The grading-time writer puts a
                       -- different quantity in `edge`, so each now also lands
                       -- in its own column. `edge_source` here carries the real
                       -- reference tier ('pinnacle'/'consensus'/...), which is
                       -- strictly more informative than a definition label;
                       -- WHICH COLUMN is populated is what identifies the
                       -- definition.
                       edge_sharp_vs_soft)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $14)
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
                    # r.price_captured_at is a str (SurfacedEntry/CandidateEdgeInfo/
                    # PropOddsRow all type it as str, matching TS's JSON-serializable
                    # fetchedAt: string shape — correct for the JSON responses those
                    # types also feed) but pick_history.price_captured_at is a real
                    # TIMESTAMPTZ column; asyncpg requires an actual datetime for a
                    # timestamptz parameter, not an ISO string. Real bug found live
                    # 2026-08-26: computeMlbPropPredictionsJob failing every run with
                    # "expected a datetime.date or datetime.datetime instance, got
                    # 'str'" the moment a candidate actually had a real price
                    # (chosen.fetched_at non-null) to log. Parsed back here, at the
                    # one place that needs a real datetime, rather than changing the
                    # type through the whole chain and risking the JSON use case.
                    datetime.fromisoformat(r.price_captured_at) if r.price_captured_at else None,
                    r.prop_score,
                    r.score_grade,
                    r.trust_tier,
                    r.model_version,
                    r.edge_source,
                    r.price,
                    # Same str -> datetime conversion price_captured_at
                    # needs above, and for the same reason: the column is
                    # TIMESTAMPTZ and asyncpg will not coerce an ISO
                    # string. ESPN's own `date` field carries a trailing
                    # 'Z' that fromisoformat rejects before 3.11.
                    _parse_ts(r.commence_time),
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


async def attach_market_prob(
    sport: str, game_id: str, market: str, slot: str, prob: float, bookmaker: str
) -> None:
    """Store the de-vigged MARKET probability for the side this pick took.

    Q28 / task 4.2. Until this existed, 4.2's activation gate ("activate only
    if Brier beats market_prob's Brier") was not merely failing for the two
    live game models — it was UNCOMPUTABLE, because `game_picks` had no
    market-probability column and pick_history.market_prob is non-null on zero
    'moneyline' and zero 'total' rows.

    `market` is 'ml' or 'total'; `slot` is 'initial' or 'final'. Both halves
    are stored because CLV (task 4.5) is the difference between them.

    The caller is responsible for the part that matters: `prob` must come from
    ONE bookmaker's two-sided price, and for totals from ONE point. Mixing two
    books, or two points, produces a number that is not a probability of
    anything — that is precisely the P3 C1 defect task 5.5 fixed on the
    display side, and it must not be reintroduced here.
    """
    if market not in ("ml", "total") or slot not in ("initial", "final"):
        raise ValueError(f"bad market/slot: {market}/{slot}")
    column = f"{market}_{slot}_market_prob"
    pool = await get_pool()
    # `IS NULL` guard, matching attach_moneyline_price/attach_total_price
    # exactly. Write-once per slot means the stored market reference describes
    # the SAME moment as the stored price beside it, which is what makes CLV
    # (task 4.5) a comparison of two captures rather than of two moving
    # numbers.
    await pool.execute(
        f"UPDATE game_picks SET {column} = $1, {column}_book = $2 "
        f"WHERE sport = $3 AND game_id = $4 AND {column} IS NULL",
        prob,
        bookmaker,
        sport,
        game_id,
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


async def list_captured_game_picks(sport: str) -> list[GamePickRow]:
    """Every pick that got at least an initial moneyline capture — the
    analysis/backtest read path (predict/clv_backtest.py), distinct from
    list_game_picks_for_lock_cycle's live "still has open work" filter
    above. Includes both graded and still-in-flight games; callers that
    need only graded outcomes filter on ml_outcome/total_outcome
    themselves, since a CLV backtest cares about entry-vs-close price
    movement, which doesn't require the game to be final yet."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT {_GAME_PICK_COLUMNS} FROM game_picks WHERE sport = $1 AND ml_initial_captured_at IS NOT NULL ORDER BY commence_time",
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
    # Task 4.4 / Q6: True = compute, log and grade but never render. Defaults
    # True so a construction site that predates the column keeps the SAFE
    # meaning (hidden), never accidentally publishing a model. Independent of
    # `active`, which is about which version is current: Q24's "deactivate a
    # model that loses to the market" acts on `active`, Q6's "hidden until it
    # beats the market" acts on this.
    shadow: bool = True


def _json_or_none(s: str | None):
    return json.loads(s) if s is not None else None


async def market_gate_sample(sport: str, market: str) -> list[tuple[float, float, float]]:
    """Graded picks carrying BOTH the model's probability and the market's, for
    task 4.2's activation gate. Returns (model_prob, market_prob, actual).

    `market` is 'moneyline' or 'total'.

    These are LIVE captures, not backfilled history: a row only qualifies once
    the pick was locked with a model probability, a market reference was
    attached from a real two-sided book price (Q28), and the game finished.
    That is the only population on which "did the model beat the market" means
    anything — comparing a fitted model to a market number reconstructed after
    the fact would be measuring hindsight.

    The `initial` slot is used rather than `final` because that is the moment
    the model committed. Beating a closing line you were shown is a much weaker
    claim than beating the line you actually bet into.
    """
    prefix = "ml" if market == "moneyline" else "total"
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        SELECT {prefix}_initial_prob AS model_prob,
               {prefix}_initial_market_prob AS market_prob,
               {prefix}_outcome AS outcome
          FROM game_picks
         WHERE sport = $1
           AND {prefix}_outcome IN ('win', 'loss')
           AND {prefix}_initial_prob IS NOT NULL
           AND {prefix}_initial_market_prob IS NOT NULL
        """,
        sport,
    )
    return [
        (float(r["model_prob"]), float(r["market_prob"]), 1.0 if r["outcome"] == "win" else 0.0)
        for r in rows
    ]


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
        shadow=row["shadow"] if "shadow" in row else True,
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
    async with pool.acquire(timeout=15.0) as conn:
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
        shadow=row["shadow"] if "shadow" in row else True,
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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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


async def get_historical_odds_for_season(season: int) -> dict[tuple[str, int, int], HistoricalOddsRow]:
    """Every historical_odds row for a season, in ONE query, keyed by
    (game_date ISO string, home_team_id, away_team_id).

    WHY THIS EXISTS. `get_historical_odds` above is a per-game lookup, and
    model_fit.py called it once per game inside the training-set loop -- about
    2,430 round trips per season through the transaction pooler. Measured
    2026-08-29 with scripts/gate/probe-training-set-cost.py: 355ms per call and
    55% of the entire per-game cost, which is round-trip latency, not query
    work. One season of training data took ~26 minutes and over half of that
    was waiting on the network.

    Same rows, same shape, fetched once. A season is ~2,430 rows of eleven
    small numeric columns, so holding it in memory is nothing next to the
    training set being built alongside it.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT game_date, home_team_id, away_team_id,
               ml_home_consensus_prob, ml_away_consensus_prob, total_line, total_over_consensus_prob,
               total_under_consensus_prob, ml_home_open_prob, ml_away_open_prob,
               total_open_line, total_open_over_prob, total_open_under_prob, book_count
        FROM historical_odds WHERE season = $1
        """,
        season,
    )
    return {
        (row["game_date"].isoformat(), row["home_team_id"], row["away_team_id"]): HistoricalOddsRow(
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
        for row in rows
    }


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


async def get_current_book_line(sport: str, game_id: str, market: str, side: str, bookmaker_like: str) -> GameOddsBookLineRow | None:
    """Single-row lookup against game_odds_book_lines — the CURRENT-state
    table (one row per key, upserted on every write; not an append-only
    log the way game_odds_history is). For a game that's already finished,
    "current" effectively means "whatever the last real price was before
    writers stopped updating it," which is a reasonable, honest proxy for
    a closing price when game_odds_history has no correctly-keyed
    historical row for the same game (see predict/clv_backtest.py, which
    uses this as its fallback reference — real but short-window data,
    since this table has only existed since 2026-08-25). `bookmaker_like`
    matched case-insensitively, same reasoning as get_closing_price above."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT sport, game_id, market, side, bookmaker, source, american_odds, point, decimal_odds, fetched_at
        FROM game_odds_book_lines
        WHERE sport = $1 AND game_id = $2 AND market = $3 AND side = $4 AND LOWER(bookmaker) = LOWER($5)
        """,
        _GENERIC_SPORT_KEY.get(sport, sport),
        game_id,
        market,
        side,
        bookmaker_like,
    )
    return _map_game_odds_book_line_row(row) if row else None


async def read_game_odds_book_lines_for_sport(sport: str) -> list[GameOddsBookLineRow]:
    """Every current row for a sport, across every source — unlike
    read_game_odds_book_lines_for_source below, not scoped to one writer.
    Used to build a per-game reference total/spread from whichever
    non-OddsHarvester provider already has real data for a game (Phase 1's
    recovered SportsGameOdds/SharpAPI/Propline rows), so OddsHarvester's own
    dynamic line-discovery has something real to target instead of guessing
    which of many discovered lines is the actual current one.

    `sport` is normalized through the same _GENERIC_SPORT_KEY map
    write_game_odds_book_lines uses — callers here (harvester_scrape.py's
    run_dynamic_lines_target) pass their own internal routing key
    (target.sport, e.g. 'soccer_epl'), but the table is only ever keyed by
    the generic app-facing value, so querying with the raw internal key
    would silently return zero rows for exactly the sports that need this
    reference lookup most (soccer/tennis, which don't have MLB's simpler
    1:1 internal-key-to-app-sport mapping)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT sport, game_id, market, side, bookmaker, source, american_odds, point, decimal_odds, fetched_at
        FROM game_odds_book_lines WHERE sport = $1
        """,
        _GENERIC_SPORT_KEY.get(sport, sport),
    )
    return [_map_game_odds_book_line_row(r) for r in rows]


async def read_game_odds_book_lines_for_source(sport: str, source: str) -> list[GameOddsBookLineRow]:
    """Every current row a given source has written for a sport — the read
    half of write_game_odds_book_lines. Not filtered to "today's games";
    callers cross-reference against their own real slate (a source's row
    for a game that's no longer on today's slate is simply ignored by that
    join, same discipline _game_odds_book_line_rows already uses when a
    GameLine doesn't match any current SnapshotGame). `sport` normalized
    through _GENERIC_SPORT_KEY, same reasoning as read_game_odds_book_lines_
    for_sport above — no real caller passes an internal league/tour key
    today, but the table is only ever keyed generically, so this stays
    correct if one does later."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT sport, game_id, market, side, bookmaker, source, american_odds, point, decimal_odds, fetched_at
        FROM game_odds_book_lines WHERE sport = $1 AND source = $2
        """,
        _GENERIC_SPORT_KEY.get(sport, sport),
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


# game_odds_book_lines is keyed by the app's generic Sport type (lib/core/
# types.ts: 'mlb' | 'nfl' | 'soccer' | 'cfb' | 'nba' | 'nhl' | 'tennis' |
# 'golf') — every TS reader (readGameOddsBookLines/readGameOddsBookLinesFor
# Sport) queries by exactly that value. Python's OWN internal job/provider-
# routing keys are more granular where a sport needs per-league/per-tour
# wiring (soccer_epl/soccer_mls need different ESPN league codes and
# provider sets; tennis_atp/tennis_wta need different tour rosters — see
# game_context.py's load_sport_games/load_tennis_games, jobs.py's
# _soccer_epl_specs/_job_tennis) and every GameOddsBookLineInput builder
# (harvester_scrape.py, providers.py's _sgo_game_line_rows/
# _propline_game_line_rows/_sharpapi_game_line_rows) constructs its rows
# from `Game.sport`/a job's own `sport` param, which carries that granular
# key — never the generic one. Confirmed live: before this normalization,
# game_odds_book_lines held real, fresh rows tagged 'soccer_epl'/
# 'soccer_mls'/'tennis_atp'/'tennis_wta', and every TS query for the
# generic 'soccer'/'tennis' silently returned zero rows — Soccer and
# Tennis's Game Detail/Scan pages never actually received real per-book
# data through this table despite the jobs themselves working correctly.
# Normalizing once here, at the one write choke point every builder already
# goes through, means a new granular key added to Python's own routing
# later doesn't need a matching fix repeated at each of N call sites.
_GENERIC_SPORT_KEY = {
    "soccer_epl": "soccer",
    "soccer_mls": "soccer",
    "tennis_atp": "tennis",
    "tennis_wta": "tennis",
}


async def write_game_odds_book_lines(rows: list[GameOddsBookLineInput]) -> None:
    """Upserts current per-bookmaker game-line prices. Safe to call with a
    fresh full snapshot every cycle — ON CONFLICT DO UPDATE means a
    bookmaker that drops out of this cycle's results simply stops being
    refreshed (its last-known row stays, timestamped), it is never deleted;
    only a matching (sport, game_id, market, side, bookmaker, source) key
    is ever touched, so this can never affect a different source's rows.

    Bookmaker names are canonicalised HERE rather than in each producer
    (task 5.3, P3 H9). All four Python callers — _propline_game_line_rows, the
    SharpAPI and SportsGameOdds builders in providers.py, and
    odds_lines_cycle.py's the-odds-api path — used to pass the provider's raw
    string through untouched, and every one of them would have had to remember
    the same rule. Doing it at the single choke point every writer already goes
    through means a fifth producer gets it for free, which is the same reasoning
    job_runner.run_provider_specs applies to cap-checking. Note this also makes
    the ON CONFLICT key above do real work: `Fanduel` and `fanduel` used to be
    two distinct keys for one book, so they never collided and never merged."""
    if not rows:
        return
    fetched_at = datetime.now(timezone.utc)
    pool = await get_pool()
    async with pool.acquire(timeout=15.0) as conn:
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
                    _GENERIC_SPORT_KEY.get(r.sport, r.sport),
                    r.game_id,
                    r.market,
                    r.side,
                    canonical_bookmaker(r.bookmaker),
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
# Unresolved provider rows (task 5.1 / P2 H2) — direct port of
# lib/db/client.ts's replaceUnresolvedForProvider.
#
# Python NEVER HAD THIS. run_provider_specs collected every FetchOutcome's
# `unresolved` list and only COUNTED it into the job summary; nothing wrote it
# anywhere. The sole writer of odds_unresolved was the TypeScript pipeline,
# which task 2.5 deleted — so the table's newest row is 2026-08-26 while
# Propline has kept fetching every day since. That is exactly P2 H2's
# "monitoring must be written by the LIVE pipeline, not the dead one": the
# table looked populated, so the gap was invisible.
#
# Delete-then-insert per provider, matching the TS semantics: this table is a
# snapshot of what is UNRESOLVED RIGHT NOW, not an append-only log. A market
# key that starts resolving should disappear from it.
# ---------------------------------------------------------------------------


async def replace_unresolved_for_provider(provider_id: str, rows: list) -> None:
    pool = await get_pool()
    async with pool.acquire(timeout=15.0) as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM odds_unresolved WHERE provider_id = $1", provider_id)
            for r in rows:
                await conn.execute(
                    "INSERT INTO odds_unresolved (provider_id, kind, raw_value, context) VALUES ($1, $2, $3, $4)",
                    provider_id,
                    r.kind,
                    r.raw_value,
                    r.context,
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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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
    async with pool.acquire(timeout=15.0) as conn:
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


# ---------------------------------------------------------------------------
# Retention (Phase 0.2 of docs/audit-remediation-plan.md — findings P2 H5,
# P2 L4, P3 M10, P4 M10)
# ---------------------------------------------------------------------------

# (table, predicate, human reason). Ordered biggest-win-first so a partial run
# (statement timeout, a dropped connection) still frees the space that matters.
#
# What is deliberately NOT here: prop_odds_history and game_odds_history. Those
# are the line-movement dataset — append-only, log-on-change, slow-growing, and
# the thing Phase 5/6 identify as the actual product asset. They are not
# regenerable from any public source. Never add them to this list.
#
# player_game_history is also absent, for a different reason: it is 830 MB of
# training data that Phase 4.7 wants MORE of, not less. It is the single reason
# this database cannot reach the Free tier's 500 MB ceiling by pruning alone,
# which is why Phase 8.1 (Supabase Pro) was pulled forward on 2026-08-28 rather
# than deleting from it. See the Phase 0 entry in the plan's phase log.
RETENTION_RULES: list[tuple[str, str, str]] = [
    (
        "snapshot_cache",
        "cache_key LIKE 'mlb:full-raw:%' AND fetched_at < now() - interval '3 days'",
        "the largest single payloads in the database (~70 MB each); a raw MLB day older than 3 days is never read again",
    ),
    (
        "snapshot_cache",
        "cache_key LIKE 'mlb:injuries:%' AND fetched_at < now() - interval '2 days'",
        "an injury list older than 2 days is not an injury list",
    ),
    (
        "prop_odds",
        "fetched_at < now() - interval '7 days'",
        "current prop lines for games that finished a week ago; the history of how they moved lives in prop_odds_history, which this never touches",
    ),
    (
        "game_odds_book_lines",
        "fetched_at < now() - interval '2 days'",
        "current per-book game lines; same reasoning as prop_odds, with game_odds_history holding the movement record",
    ),
    (
        "system_events",
        "occurred_at < now() - interval '30 days'",
        "operational log, not a record anything reads back beyond a month (P2 L4)",
    ),
]


async def run_retention() -> dict:
    """Delete rows past their retention window and report what went.

    Idempotent by construction — every rule is a time-window predicate, so a
    second run in the same minute deletes zero rows. The Phase 0 gate asserts
    exactly that, because a retention job that is not idempotent is a job that
    quietly deletes a little more every time somebody runs it by hand.

    Deliberately does NOT VACUUM. `DELETE` marks rows dead; only VACUUM FULL
    returns the space to the filesystem, and VACUUM FULL takes an ACCESS
    EXCLUSIVE lock that would block every reader for its duration. Autovacuum
    reclaims the space for reuse within Postgres, which is what keeps steady
    state steady; the one-time reclaim after the first big prune is an operator
    action, run deliberately, not something a scheduled job should be doing
    behind your back.
    """
    pool = await get_pool()
    deleted: dict[str, int] = {}
    total = 0
    for table, predicate, _reason in RETENTION_RULES:
        status = await pool.execute(f"DELETE FROM {table} WHERE {predicate}")  # noqa: S608 - predicates are literals in this module, never user input
        n = _rowcount_from_status(status)
        deleted[f"{table}: {predicate.split(' AND ')[0][:48]}"] = n
        total += n

    size_row = await pool.fetchrow(
        "SELECT pg_database_size(current_database()) AS bytes, pg_size_pretty(pg_database_size(current_database())) AS pretty"
    )
    return {
        "deleted_by_rule": deleted,
        "rows_deleted": total,
        "db_size": size_row["pretty"],
        "db_size_mb": round(size_row["bytes"] / 1048576),
    }
