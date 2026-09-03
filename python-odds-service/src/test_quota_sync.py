"""db.mark_provider_exhausted — the write half of the vendor quota sync.

THE PROPERTY THAT MATTERS IS "NEVER LOWERS". Sync corrects provider_usage
toward what the vendor reports, and the two directions are not symmetric:

  Raising is safe. It closes the gap that let sgo_k1 sit at 2 in our records
  while the vendor had it at 2500/2500 — a gap that did not merely mis-report,
  it defeated pooling, because job_runner reserves against provider_usage and so
  kept choosing a key the vendor had already cut off.

  LOWERING IS NOT SAFE. If a vendor reports lazily, or a sync response is stale
  or partial, a counter that moves DOWN hands back budget that was really spent
  — and the next cycle happily spends it again. That is a worse failure than the
  undercount, because it is self-reinforcing rather than self-limiting.

So the write is GREATEST(existing, incoming), and this pins it. Uses a synthetic
provider_id so it never touches a real provider's record.

Run with:  python test_quota_sync.py
"""
import asyncio
import sys

import db

_failures = 0
FAKE = "test_quota_sync_synthetic"


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}  ({actual})")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


async def _count(period_kind: str, unit: str) -> int:
    col = "object_count" if unit == "objects" else "request_count"
    # Mirrors db.mark_provider_exhausted: utc for daily, eastern month for monthly.
    key = db.utc_date_key() if period_kind == "daily" else db.eastern_month_key()
    pool = await db.get_pool()
    async with pool.acquire(timeout=15.0) as c:
        v = await c.fetchval(
            f"SELECT {col} FROM provider_usage WHERE provider_id=$1 "
            "AND period_kind=$2 AND period_key=$3",
            FAKE, period_kind, key)
    return int(v or 0)


async def _cleanup() -> None:
    pool = await db.get_pool()
    async with pool.acquire(timeout=15.0) as c:
        await c.execute("DELETE FROM provider_usage WHERE provider_id=$1", FAKE)


async def main() -> int:
    await _cleanup()
    print("\nmark_provider_exhausted — raise-only semantics")

    # Fresh row: the counter is created at the vendor's number.
    await db.mark_provider_exhausted(FAKE, "monthly", 1364, unit="objects")
    check("creates the row at the vendor's count", await _count("monthly", "objects"), 1364)

    # Vendor reports higher: we move up.
    await db.mark_provider_exhausted(FAKE, "monthly", 2500, unit="objects")
    check("raises when the vendor reports more", await _count("monthly", "objects"), 2500)

    # Vendor reports LOWER: we must not move down. This is the whole point.
    await db.mark_provider_exhausted(FAKE, "monthly", 5, unit="objects")
    check("REFUSES to lower on a lazy/stale vendor read",
          await _count("monthly", "objects"), 2500)

    # Repeating the same number changes nothing — a 429 every cycle must not
    # inflate the counter past the cap it is reporting.
    await db.mark_provider_exhausted(FAKE, "monthly", 2500, unit="objects")
    await db.mark_provider_exhausted(FAKE, "monthly", 2500, unit="objects")
    check("idempotent under repeated 429s", await _count("monthly", "objects"), 2500)

    # requests vs objects are separate columns; writing one must not touch the
    # other, or a request-billed provider and an object-billed one sharing a
    # period row would corrupt each other.
    await db.mark_provider_exhausted(FAKE, "monthly", 900, unit="requests")
    check("requests column written independently", await _count("monthly", "requests"), 900)
    check("objects column untouched by a requests write",
          await _count("monthly", "objects"), 2500)

    # Daily is its own period row.
    await db.mark_provider_exhausted(FAKE, "daily", 777, unit="requests")
    check("daily period is a separate row", await _count("daily", "requests"), 777)
    check("monthly unaffected by the daily write",
          await _count("monthly", "requests"), 900)

    await _cleanup()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all quota_sync checks passed")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
