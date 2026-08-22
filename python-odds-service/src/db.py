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
    ml_final_side: str | None
    ml_final_prob: float | None
    ml_final_captured_at: str | None
    ml_final_late: bool
    ml_final_price: int | None
    ml_final_prob_lower: float | None
    ml_final_prob_upper: float | None
    total_initial_side: str | None
    total_initial_prob: float | None
    total_initial_line: float | None
    total_initial_captured_at: str | None
    total_initial_late: bool
    total_initial_price: int | None
    total_initial_prob_lower: float | None
    total_initial_prob_upper: float | None
    total_final_side: str | None
    total_final_prob: float | None
    total_final_line: float | None
    total_final_captured_at: str | None
    total_final_late: bool
    total_final_price: int | None
    total_final_prob_lower: float | None
    total_final_prob_upper: float | None
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
  ml_initial_prob_lower, ml_initial_prob_upper,
  ml_final_side, ml_final_prob, ml_final_captured_at, ml_final_late, ml_final_price,
  ml_final_prob_lower, ml_final_prob_upper,
  total_initial_side, total_initial_prob, total_initial_line, total_initial_captured_at,
  total_initial_late, total_initial_price, total_initial_prob_lower, total_initial_prob_upper,
  total_final_side, total_final_prob, total_final_line, total_final_captured_at,
  total_final_late, total_final_price, total_final_prob_lower, total_final_prob_upper,
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
        ml_final_side=row["ml_final_side"],
        ml_final_prob=row["ml_final_prob"],
        ml_final_captured_at=_iso_or_none(row["ml_final_captured_at"]),
        ml_final_late=row["ml_final_late"],
        ml_final_price=row["ml_final_price"],
        ml_final_prob_lower=row["ml_final_prob_lower"],
        ml_final_prob_upper=row["ml_final_prob_upper"],
        total_initial_side=row["total_initial_side"],
        total_initial_prob=row["total_initial_prob"],
        total_initial_line=row["total_initial_line"],
        total_initial_captured_at=_iso_or_none(row["total_initial_captured_at"]),
        total_initial_late=row["total_initial_late"],
        total_initial_price=row["total_initial_price"],
        total_initial_prob_lower=row["total_initial_prob_lower"],
        total_initial_prob_upper=row["total_initial_prob_upper"],
        total_final_side=row["total_final_side"],
        total_final_prob=row["total_final_prob"],
        total_final_line=row["total_final_line"],
        total_final_captured_at=_iso_or_none(row["total_final_captured_at"]),
        total_final_late=row["total_final_late"],
        total_final_price=row["total_final_price"],
        total_final_prob_lower=row["total_final_prob_lower"],
        total_final_prob_upper=row["total_final_prob_upper"],
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


async def get_earliest_observed_total_point(event_id: str) -> float | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT point FROM game_odds_history WHERE event_id = $1 AND market = 'total' AND point IS NOT NULL ORDER BY observed_at ASC LIMIT 1",
        event_id,
    )
    return row["point"] if row else None


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
