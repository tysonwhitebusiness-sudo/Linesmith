"""Correctness gate for the snapshot validation cache (Phase 5, egress).

Run: .venv/Scripts/python.exe test_blob_cache.py

The failure this guards against is worse than the bill it exists to cut: a
cache that serves a stale or corrupted payload would feed wrong odds into the
models silently. So the assertions are about IDENTITY and INVALIDATION, not
about hit rates.
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

# Point the cache somewhere disposable BEFORE importing it.
os.environ["LINESMITH_BLOB_CACHE_DIR"] = os.path.join(
    tempfile.gettempdir(), "linesmith-blob-cache-test")

import blob_cache                                            # noqa: E402
import db                                                    # noqa: E402

FAILS: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        FAILS.append(name)


async def main() -> int:
    from datetime import datetime, timedelta, timezone

    for f in os.listdir(blob_cache.CACHE_DIR) if os.path.isdir(blob_cache.CACHE_DIR) else []:
        os.remove(os.path.join(blob_cache.CACHE_DIR, f))
    blob_cache.reset_stats()

    print(f"\n{'=' * 74}\nBLOB CACHE — unit behaviour\n{'=' * 74}")
    t0 = datetime(2026, 9, 11, 12, 0, 0, tzinfo=timezone.utc)
    t1 = t0 + timedelta(seconds=1)

    blob_cache.put("k:one", t0, "PAYLOAD-A")
    check("stores and returns the exact payload", blob_cache.get("k:one", t0) == "PAYLOAD-A")

    # THE CENTRAL PROPERTY: a different version must not hit.
    check("a newer fetched_at is a MISS, not a stale hit",
          blob_cache.get("k:one", t1) is None)

    blob_cache.put("k:one", t1, "PAYLOAD-B")
    check("new version returns new payload", blob_cache.get("k:one", t1) == "PAYLOAD-B")
    check("superseded version is dropped", blob_cache.get("k:one", t0) is None)

    check("unknown key misses", blob_cache.get("k:never", t0) is None)

    big = "x" * (3 * 1024 * 1024)
    blob_cache.put("k:big", t0, big)
    got = blob_cache.get("k:big", t0)
    check("3 MB payload round-trips byte-identical", got == big,
          f"{len(got or ''):,} chars")

    uni = "héllo — 日本語 — \U0001F600 mixed"
    blob_cache.put("k:uni", t0, uni)
    check("non-ASCII round-trips exactly", blob_cache.get("k:uni", t0) == uni)

    # A corrupted file must degrade to a miss, never an exception.
    p = blob_cache._path("k:corrupt", t0)
    blob_cache.put("k:corrupt", t0, "fine")
    with open(p, "wb") as f:
        f.write(b"\xff\xfe\x00 not utf-8")
    check("corrupted file is a miss, not a raise", blob_cache.get("k:corrupt", t0) is None)

    # An unwritable directory must disable cleanly, not raise.
    saved_dir, saved_enabled = blob_cache.CACHE_DIR, blob_cache._enabled
    blob_cache.CACHE_DIR = "\x00illegal"
    blob_cache._enabled = True
    try:
        blob_cache.put("k:x", t0, "y")
        check("unusable cache dir degrades silently", blob_cache.get("k:x", t0) is None)
    except Exception as e:                                    # noqa: BLE001
        check("unusable cache dir degrades silently", False, f"raised {type(e).__name__}")
    blob_cache.CACHE_DIR, blob_cache._enabled = saved_dir, saved_enabled

    # ---------------------------------------------------------------- live DB
    print(f"\n{'=' * 74}\nAGAINST THE REAL DATABASE\n{'=' * 74}")
    pool = await db.get_pool()
    async with pool.acquire(timeout=60.0) as c:
        # STABLE keys only. The first version of this test took the six
        # LARGEST keys -- which are mlb:snapshot and mlb:full-raw, rewritten by
        # the live worker every few minutes. Every "identity" comparison then
        # raced a writer and failed, and the cache never hit because each read
        # saw a new fetched_at. The cache was correct; the test was measuring
        # the worker's write cadence.
        keys = [r["cache_key"] for r in await c.fetch(
            """SELECT cache_key FROM snapshot_cache
                WHERE fetched_at < now() - interval '2 hours'
                ORDER BY pg_column_size(snapshot_cache.*) DESC LIMIT 6""")]
        if len(keys) < 3:
            raise SystemExit("not enough settled keys to test against")
        raw = {}
        for k in keys:
            row = await c.fetchrow(
                "SELECT payload, fetched_at FROM snapshot_cache WHERE cache_key=$1", k)
            raw[k] = (row["payload"], row["fetched_at"])

    blob_cache.reset_stats()
    # First pass: cold. Second pass: must be served from disk, byte-identical.
    first = {k: await db.read_snapshot(k) for k in keys}
    cold = blob_cache.stats()
    second = {k: await db.read_snapshot(k) for k in keys}
    warm = blob_cache.stats()

    ident = all(first[k] == raw[k][0] for k in keys)
    check("cold read matches the database exactly", ident)
    same = all(second[k] == first[k] for k in keys)
    check("warm read is byte-identical to cold", same)
    check("warm pass actually hit the cache",
          warm["hits"] > cold["hits"],
          f"hits {cold['hits']} -> {warm['hits']}, served {warm['bytes_served']/1e6:,.1f} MB")

    aged = await db.read_snapshot_with_age(keys[0])
    check("read_snapshot_with_age returns (payload, age)",
          aged is not None and aged[0] == raw[keys[0]][0] and aged[1] >= 0,
          f"age={aged[1]:,.0f}s" if aged else "")

    check("missing key returns None", await db.read_snapshot("nope:does-not-exist") is None)
    check("missing key returns None (with_age)",
          await db.read_snapshot_with_age("nope:does-not-exist") is None)

    # Invalidation end-to-end: write a new payload, the next read must see it.
    probe = "python-harness:blobcache-selftest"
    await db.write_snapshot(probe, "VERSION-ONE")
    v1 = await db.read_snapshot(probe)
    await db.write_snapshot(probe, "VERSION-TWO")
    v2 = await db.read_snapshot(probe)
    check("a rewritten key is NOT served stale", v1 == "VERSION-ONE" and v2 == "VERSION-TWO",
          f"{v1!r} -> {v2!r}")

    async with pool.acquire(timeout=30.0) as c:
        await c.execute("DELETE FROM snapshot_cache WHERE cache_key=$1", probe)

    s = blob_cache.stats()
    print(f"\n  cache: {s['hits']} hits / {s['misses']} misses, "
          f"{s['bytes_served']/1e6:,.1f} MB served from disk, "
          f"{s['errors']} errors, {s['evictions']} evictions")

    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                         # noqa: BLE001
        pool.terminate()

    print(f"\n{'=' * 74}")
    if FAILS:
        print(f"{len(FAILS)} FAILURE(S): {', '.join(FAILS)}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
