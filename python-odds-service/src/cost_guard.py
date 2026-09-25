"""The cost guard (D25) — `costGuardJob`, hourly, in the worker.

D25: $50/month all-in across Supabase, Render and (later) Vercel, enforced by
caps in OUR code, not the providers' spend caps. This job adds up everything
that is MEASURED into a projection for the month, lists everything that is
not, and sets a brake the scraper bridge obeys (it holds rows on the laptop,
as it does for the disk guard's pause).

NOTHING IS ESTIMATED. A component with no measurement is named in
`cost_guard_state.unmeasured` and costs nothing in the projection. That makes
the projection a FLOOR, which the health check says: it alerts when an input
stays unmeasured for more than 7 days, rather than showing a total that
silently leaves it out.

Where each number comes from (results/P6-cost-audit.md):
  * prices                   `cost_prices.json` (each with its source and date)
  * Supabase disk            the provisioned size (config; the guard holds use under it)
  * Supabase storage         an S3 listing of the corpus bucket
  * Render worker            its plan's price
  * Render cron run time     `usage_meters` cron.run_seconds (the cron logs itself)
  * bridge egress            `usage_meters` bridge.egress_bytes (the bridge counts its own)
  * Supabase egress, compute size, Render billed bandwidth
                             `usage_meters` observed.* — figures read off the
                             providers' usage pages and recorded with
                             `record_observed_cost.py`; stale after 7 days
"""
from __future__ import annotations

import calendar
import json
import os
from datetime import date, datetime, timedelta, timezone

import db

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBSERVED_MAX_AGE_DAYS = 7


def load_prices() -> dict:
    with open(os.path.join(HERE, "cost_prices.json"), encoding="utf-8") as fh:
        return json.load(fh)


def project(month_to_date: float, as_of: datetime, month_start: date) -> float:
    """Straight-line projection of a usage total to the end of its month."""
    days = calendar.monthrange(month_start.year, month_start.month)[1]
    elapsed = (as_of - datetime.combine(month_start, datetime.min.time(), timezone.utc)).total_seconds() / 86400
    return month_to_date * days / max(elapsed, 1 / 24)


def compute(prices: dict, now: datetime, meters: dict[str, list[tuple[date, float]]],
            storage_gb: float | None) -> dict:
    """The month's projection from what is measured. Pure: `test_cost_guard.py`."""
    month = now.date().replace(day=1)
    sb, rd = prices["supabase"], prices["render"]
    parts: dict[str, float] = {}
    unmeasured: list[str] = []

    def mtd(name: str) -> float:
        return sum(v for d, v in meters.get(name, []) if d >= month)

    def observed(name: str) -> tuple[date, float] | None:
        rows = [(d, v) for d, v in meters.get(name, []) if d >= month and (now.date() - d).days <= OBSERVED_MAX_AGE_DAYS]
        return max(rows) if rows else None

    parts["supabase.plan"] = sb["plan_usd"]
    comp = observed("observed.supabase_compute_usd")
    if comp:
        parts["supabase.compute"] = max(0.0, comp[1] - sb["compute_credit_usd"])
    else:
        unmeasured.append("supabase.compute")
    parts["supabase.disk"] = max(0.0, sb["provisioned_disk_gb"] - sb["disk_included_gb"]) * sb["disk_usd_per_gb"]
    if storage_gb is None:
        unmeasured.append("supabase.storage")
    else:
        parts["supabase.storage"] = max(0.0, storage_gb - sb["storage_included_gb"]) * sb["storage_usd_per_gb"]
    egress = observed("observed.supabase_egress_gb_mtd")
    egress_proj = None
    if egress:
        egress_proj = project(egress[1], datetime.combine(egress[0], datetime.max.time(), timezone.utc), month)
        parts["supabase.egress"] = max(0.0, egress_proj - sb["egress_included_gb"]) * sb["egress_usd_per_gb"]
    else:
        unmeasured.append("supabase.egress")

    for sid, svc in rd["services"].items():
        if svc["kind"] == "worker":
            parts[f"render.{svc['name']}"] = svc["usd_month"]
        elif svc["kind"] == "cron":
            secs = mtd("cron.run_seconds")
            usd = project(secs / 60 * rd["cron_usd_per_min"][svc["plan"]], now, month)
            parts[f"render.{svc['name']}"] = max(rd["cron_min_usd_per_service"], usd)
            if not meters.get("cron.run_seconds"):
                unmeasured.append("render.cron_run_time")
    bw = observed("observed.render_bandwidth_gb_mtd")
    tier = observed("observed.render_bandwidth_included_gb")
    if bw and tier:
        bw_proj = project(bw[1], datetime.combine(bw[0], datetime.max.time(), timezone.utc), month)
        parts["render.bandwidth"] = max(0.0, bw_proj - tier[1]) * rd["bandwidth_usd_per_gb"]
    else:
        unmeasured.append("render.bandwidth")

    total = round(sum(parts.values()), 2)
    brake, reason = False, None
    if total > prices["brake_usd"]:
        brake, reason = True, f"projected ${total:.2f} > brake ${prices['brake_usd']:.2f}"
    elif egress_proj is not None and egress_proj > 0.9 * sb["egress_included_gb"]:
        brake, reason = True, f"Supabase egress projected {egress_proj:.0f} GB > 90% of {sb['egress_included_gb']:.0f} GB"
    return {"month": month, "projected_usd": total, "parts": {k: round(v, 2) for k, v in parts.items()},
            "unmeasured": unmeasured, "brake": brake, "reason": reason,
            "bridge_egress_gb_mtd": round(mtd("bridge.egress_bytes") / 1e9, 3),
            "egress_projected_gb": None if egress_proj is None else round(egress_proj, 1)}


def storage_gb_measured() -> float | None:
    """Total bytes in the corpus bucket, via the same S3 credentials the corpus uses."""
    try:
        import boto3
        from corpus_location import S3Corpus, corpus_location

        b = corpus_location()
        if not isinstance(b, S3Corpus):
            return None
        s3 = boto3.client("s3", endpoint_url=b.endpoint, region_name=b.region,
                          aws_access_key_id=b.key_id, aws_secret_access_key=b.secret)
        total, token = 0, None
        while True:
            kw = {"Bucket": b.bucket}
            if token:
                kw["ContinuationToken"] = token
            r = s3.list_objects_v2(**kw)
            total += sum(o["Size"] for o in r.get("Contents", []))
            if not r.get("IsTruncated"):
                break
            token = r["NextContinuationToken"]
        return total / 1e9
    except Exception as e:                                   # noqa: BLE001
        print(f"[cost_guard] storage unmeasured: {type(e).__name__}: {e}", flush=True)
        return None


async def read_meters(conn, since: date) -> dict[str, list[tuple[date, float]]]:
    rows = await conn.fetch("SELECT meter, day, value FROM usage_meters WHERE day >= $1", since)
    out: dict[str, list[tuple[date, float]]] = {}
    for r in rows:
        out.setdefault(r["meter"], []).append((r["day"], float(r["value"])))
    return out


async def add_meter(meter: str, value: float, day: date | None = None, replace: bool = False) -> None:
    """Add to (or with `replace`, set) one meter for a UTC day. Never raises: a
    meter write must not break the work it measures."""
    try:
        pool = await db.get_pool()
        d = day or datetime.now(timezone.utc).date()
        if replace:
            sql = """INSERT INTO usage_meters (meter, day, value, updated_at) VALUES ($1, $2, $3, now())
                     ON CONFLICT (meter, day) DO UPDATE SET value = excluded.value, updated_at = now()"""
        else:
            sql = """INSERT INTO usage_meters (meter, day, value, updated_at) VALUES ($1, $2, $3, now())
                     ON CONFLICT (meter, day) DO UPDATE SET value = usage_meters.value + excluded.value, updated_at = now()"""
        await pool.execute(sql, meter, d, float(value))
    except Exception as e:                                   # noqa: BLE001
        print(f"[cost_guard] meter {meter} not recorded: {type(e).__name__}: {e}", flush=True)


async def run_cost_guard() -> dict:
    import asyncio

    prices = load_prices()
    now = datetime.now(timezone.utc)
    storage = await asyncio.to_thread(storage_gb_measured)
    pool = await db.get_pool()
    async with pool.acquire(timeout=30.0) as conn:
        meters = await read_meters(conn, now.date().replace(day=1) - timedelta(days=OBSERVED_MAX_AGE_DAYS))
        r = compute(prices, now, meters, storage)
        await conn.execute(
            """INSERT INTO cost_guard_state (id, measured_at, month, projected_usd, ceiling_usd, unmeasured, brake, reason, detail)
               VALUES (true, now(), $1, $2, $3, $4, $5, $6, $7::jsonb)
               ON CONFLICT (id) DO UPDATE SET measured_at = excluded.measured_at, month = excluded.month,
                 projected_usd = excluded.projected_usd, ceiling_usd = excluded.ceiling_usd,
                 unmeasured = excluded.unmeasured, brake = excluded.brake, reason = excluded.reason,
                 detail = excluded.detail""",
            r["month"], r["projected_usd"], prices["ceiling_usd"], r["unmeasured"], r["brake"], r["reason"],
            json.dumps({"parts": r["parts"], "storage_gb": storage, "bridge_egress_gb_mtd": r["bridge_egress_gb_mtd"],
                        "egress_projected_gb": r["egress_projected_gb"], "prices_fetched": prices["fetched"]}))
    return {"projected_usd": r["projected_usd"], "unmeasured": r["unmeasured"], "brake": r["brake"],
            "reason": r["reason"], "parts": r["parts"]}


async def read_state(conn) -> dict | None:
    row = await conn.fetchrow("SELECT * FROM cost_guard_state WHERE id")
    return dict(row) if row else None
