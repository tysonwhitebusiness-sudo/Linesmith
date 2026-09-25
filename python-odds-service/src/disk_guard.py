"""The disk guard (P5 amendment A2, decision D24) — `diskGuardJob`, every 15
minutes, in the worker.

D24 holds the database at its provisioned 27 GB so Supabase never autoscales
the disk (its next step is 40.5 GB, and the bill with it). This job measures
the database plus its WAL, and when the total passes 85% of the provisioned
size it SHORTENS THE HOT WINDOW of the compact history tables: the mover
(`history_mover.py`, in the health-check cron) then moves the oldest days to the
Parquet corpus and drops them. Nothing is deleted here and nothing is lost:
every day leaves Postgres only after its corpus copy is read back and verified.

If the window is already at its floor and the total is still over the limit, it
sets `bridge_paused`. The P6 bridge reads that before every write and holds its
rows on the laptop (the scraper keeps everything) until the flag clears.

It also keeps 14 days of daily partitions created ahead, so a write never finds
its day missing.

MEASURED 2026-09-25: database 5,253 MB, WAL 1,024 MB (`max_wal_size` 4,096 MB).
The provisioned size is not readable through SQL (it needs a Management API
token), so it is configuration: `DISK_GUARD_PROVISIONED_GB`.

Deciding is a pure function (`decide_window`) so `test_disk_guard.py` can call
it; the job only measures, decides and writes one row.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import db
import price_history as ph
from config import env

# Decimal gigabytes: the smaller reading of "27 GB", so the guard can only err early.
GB = 10 ** 9

PROVISIONED_GB = float(env("DISK_GUARD_PROVISIONED_GB") or 27)
LIMIT_PCT = float(env("DISK_GUARD_LIMIT_PCT") or 0.85)
TARGET_PCT = float(env("DISK_GUARD_TARGET_PCT") or 0.80)
HOT_DAYS = int(env("HISTORY_HOT_DAYS") or 10)
MIN_HOT_DAYS = int(env("HISTORY_MIN_HOT_DAYS") or 3)
PARTITIONS_AHEAD = 14


@dataclass
class Decision:
    hot_days: int
    bridge_paused: bool
    reason: str | None
    projected_bytes: int


def decide_window(total_bytes: int, provisioned_bytes: int, day_bytes: dict[date, int], today: date,
                  hot_days: int = HOT_DAYS, min_days: int = MIN_HOT_DAYS,
                  limit_pct: float = LIMIT_PCT, target_pct: float = TARGET_PCT) -> Decision:
    """The hot window that keeps the disk under its limit.

    `day_bytes` is the measured size of each held day, summed over the history
    tables. A window of `w` days keeps every day on or after `today - w`; the
    mover drops the rest once exported. Under the limit, the normal window.
    Over it, the longest window whose projected total (the measured total less
    the days it would drop) falls under the TARGET, which sits below the limit
    so the window does not flap across it. If even `min_days` cannot, the
    bridge pauses: the history never shrinks below the floor to make room.
    """
    limit = int(provisioned_bytes * limit_pct)
    target = int(provisioned_bytes * target_pct)

    def projected(w: int) -> int:
        cut = today - timedelta(days=w)
        return total_bytes - sum(b for d, b in day_bytes.items() if d < cut)

    if total_bytes <= limit:
        return Decision(hot_days, False, None, projected(hot_days))
    for w in range(hot_days, min_days - 1, -1):
        p = projected(w)
        if p <= target:
            return Decision(w, False,
                            f"over {limit_pct:.0%}: window {hot_days} -> {w} days brings the total to "
                            f"{p / GB:.2f} GB", p)
    p = projected(min_days)
    return Decision(min_days, True,
                    f"over {limit_pct:.0%} even at the {min_days}-day floor ({p / GB:.2f} GB projected): "
                    f"bridge writes paused", p)


async def measure(conn) -> dict:
    row = await conn.fetchrow(
        "SELECT pg_database_size(current_database()) AS db, (SELECT coalesce(sum(size), 0) FROM pg_ls_waldir()) AS wal")
    return {"db_bytes": int(row["db"]), "wal_bytes": int(row["wal"])}


async def run_disk_guard() -> dict:
    today = datetime.now(timezone.utc).date()
    pool = await db.get_pool()
    async with pool.acquire(timeout=30.0) as conn:
        made = await conn.fetchval("SELECT odds_history_ensure_partitions($1::date, $2)", today, PARTITIONS_AHEAD)
        sizes = await measure(conn)
        day_bytes: dict[date, int] = {}
        ahead = None
        for table in ph.HISTORY_TABLES:
            parts = await ph.partition_days(conn, table)
            for p in parts:
                day_bytes[p["day"]] = day_bytes.get(p["day"], 0) + p["bytes"]
            n_ahead = sum(1 for p in parts if p["day"] > today)
            ahead = n_ahead if ahead is None else min(ahead, n_ahead)
        total = sizes["db_bytes"] + sizes["wal_bytes"]
        provisioned = int(PROVISIONED_GB * GB)
        d = decide_window(total, provisioned, day_bytes, today)
        detail = {
            "provisioned_gb": PROVISIONED_GB, "limit_pct": LIMIT_PCT, "target_pct": TARGET_PCT,
            "default_hot_days": HOT_DAYS, "min_hot_days": MIN_HOT_DAYS,
            "projected_bytes": d.projected_bytes, "partitions_created": made,
            "history_bytes": sum(day_bytes.values()),
            "oldest_day": min(day_bytes).isoformat() if day_bytes else None,
        }
        await conn.execute(
            """INSERT INTO disk_guard_state (id, measured_at, db_bytes, wal_bytes, limit_bytes, hot_days,
                                             bridge_paused, partitions_ahead, reason, detail)
               VALUES (true, now(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb)
               ON CONFLICT (id) DO UPDATE SET
                 measured_at = excluded.measured_at, db_bytes = excluded.db_bytes, wal_bytes = excluded.wal_bytes,
                 limit_bytes = excluded.limit_bytes, hot_days = excluded.hot_days,
                 bridge_paused = excluded.bridge_paused, partitions_ahead = excluded.partitions_ahead,
                 reason = excluded.reason, detail = excluded.detail""",
            sizes["db_bytes"], sizes["wal_bytes"], int(provisioned * LIMIT_PCT), d.hot_days, d.bridge_paused,
            ahead or 0, d.reason, json.dumps(detail))
    return {
        "db_mb": round(sizes["db_bytes"] / 1e6), "wal_mb": round(sizes["wal_bytes"] / 1e6),
        "used_pct": round(total / provisioned * 100, 1), "hot_days": d.hot_days,
        "bridge_paused": d.bridge_paused, "partitions_ahead": ahead, "partitions_created": made,
        "reason": d.reason,
    }


async def read_state(conn) -> dict | None:
    """The guard's last row — the mover's window and the bridge's pause flag."""
    row = await conn.fetchrow("SELECT * FROM disk_guard_state WHERE id")
    return dict(row) if row else None
