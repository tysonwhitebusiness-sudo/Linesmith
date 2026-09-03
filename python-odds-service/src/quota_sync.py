"""Reconcile provider_usage against what each VENDOR says we have spent.

WHY. `provider_usage` is a DERIVED count: job_runner reserves one unit as an
entry ticket and records the rest from whatever a fetch reports it used. Every
step there can be wrong, and when it is wrong it is wrong silently and in the
dangerous direction. Measured 2026-09-03: SportsGameOdds key sgo_k1 reported
per-month entities 2500/2500 — fully spent on the 3rd — while provider_usage had
it at 2 objects. A ~50x undercount, so the 2,000 soft cap never fired and every
request 429'd.

The cost was not the wasted requests. It was that the undercount defeated
POOLING, the one mechanism built to survive a dead key: job_runner reserves
against provider_usage, saw sgo_k1 far under cap, and chose the dead key every
cycle while sgo_k2 sat on 1,136 unused entities.

A 429 now retires a key (job_runner), but that is a backstop — it reacts after
the budget is already gone. This closes the cause: ask the vendor, on a
schedule, and correct the record before anything is spent against a wrong number.

WHAT IS AND IS NOT COVERED, and why it is not uniform.

  SportsGameOdds — a FREE account endpoint (/v2/account/usage) returning exact
  per-month entity usage. Pollable, so it is synced here.

  ParlayAPI (`ratelimit-policy`), Propline (`x-daily-limit` / `x-daily-used`)
  and The Odds API (`x-requests-remaining`) publish quota ONLY as response
  headers on real odds calls. There is no free endpoint to poll, so syncing
  them from a timer would mean spending quota to measure quota. They belong in
  the fetch path — read the header on the call you were making anyway — which
  is a change to providers.py, not to this job. Deliberately NOT stubbed here:
  a registry entry that never runs reads like coverage.

  Odds-API.io and SharpAPI publish nothing (measured, docs/odds-sources §14).
  SharpAPI has no cap to reconcile, so it needs nothing.

NEVER LOWERS A COUNTER. Sync raises toward the vendor's number and never below
it, so a vendor that reports lazily cannot hand back budget we really spent.
Under-reporting is safe; over-reporting is not.
"""
from __future__ import annotations

import httpx

import config
import db

SGO_USAGE_URL = "https://api.sportsgameodds.com/v2/account/usage"

# Material drift worth surfacing. Below this, normal in-flight accounting lag
# accounts for it and a warning every hour would just be noise.
_DRIFT_WARN = 50


async def _sgo_used(client: httpx.AsyncClient, api_key: str) -> int | None:
    """Per-month entities this key has spent, straight from the vendor."""
    res = await client.get(SGO_USAGE_URL, headers={"X-Api-Key": api_key}, timeout=30.0)
    if res.status_code != 200:
        return None
    per_month = ((res.json().get("data") or {}).get("rateLimits") or {}).get("per-month") or {}
    used = per_month.get("current-entities")
    return used if isinstance(used, int) else None


async def sync_all() -> dict:
    """Correct provider_usage from every vendor that can be asked for free."""
    corrected: list[str] = []
    warnings: list[str] = []
    checked = 0

    keys = [(pid, key) for pid, key in getattr(__import__("provider_matrix"),
                                               "KEY_POOLS", {}).get("sportsgameodds", ())]
    async with httpx.AsyncClient() as client:
        for pid, api_key in keys:
            if not api_key:
                continue  # never provisioned — not a failure, just absent
            checked += 1
            try:
                vendor_used = await _sgo_used(client, api_key)
            except Exception as e:
                warnings.append(f"{pid}: usage lookup failed ({type(e).__name__}: {e})")
                continue
            if vendor_used is None:
                warnings.append(f"{pid}: usage endpoint returned no per-month entity count")
                continue

            ours = await db.monthly_status(pid, config.SPORTSGAMEODDS_MONTHLY_SOFT_CAP,
                                           unit="objects")
            drift = vendor_used - int(ours or 0)
            if drift > 0:
                # Raise only. See the module docstring: a vendor reporting low
                # must never hand back budget we actually spent.
                await db.mark_provider_exhausted(pid, "monthly", vendor_used, unit="objects")
                corrected.append(f"{pid} {ours}->{vendor_used}")
                if drift >= _DRIFT_WARN:
                    warnings.append(
                        f"{pid}: our count was {drift} BELOW the vendor "
                        f"({ours} vs {vendor_used}) — the cap gate was running on a "
                        f"number that low, which is how a key goes dark unnoticed")

    return {
        "providers_checked": checked,
        "corrected": corrected,
        "warnings": warnings,
        "rows_written": len(corrected),
    }
