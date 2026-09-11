"""Local disk cache for `snapshot_cache` payloads — a VALIDATION cache, not a TTL one.

WHY THIS EXISTS, AND THE NUMBER THAT JUSTIFIES IT. Measured 2026-09-11 against
Supabase's own usage graph: the project was billed **19.483 GB/day** of egress
against a 250 GB/month allowance (623.32 GB used, 373.32 GB overage). Two
independent methods agreed that **~16 GB/day of that — 80% — was `snapshot_cache`
reads**:

    blocks touched : 53,212 B/call x 265,538 calls/day
    residual       : (19.483 - 3.6 GB) / 265,536 rows  ->  ~60 KB/read

Every other live query in the system — all 24.3M rows/day of it — came to about
3.6 GB/day put together.

The cause is architectural rather than a bad query: **Postgres is being used as
a blob cache, and on a hosted database every cache HIT is a network transfer
that gets billed.** A cache that lives in the database does not save traffic, it
manufactures it. `mlb:snapshot` is 6.6 MB and `load_mlb_games()` has 32 call
sites; `mlb:full-raw:<date>` is 12.3 MB; `nfl:boxscoreRaw:*` is ~106 KB across
612 keys, read per-game inside loops.

VALIDATION, NOT EXPIRY — and the distinction is the whole design. A TTL cache
trades correctness for traffic: pick 60s and you serve odds up to a minute
stale; pick 5s and you barely save anything. There is no need for that trade
here, because `snapshot_cache.fetched_at` IS a version stamp. So:

    1. ask Postgres for `fetched_at` ONLY          (~8 bytes on the wire)
    2. if the local copy carries that same stamp, serve it from disk
    3. otherwise fetch the payload once and store it under its own stamp

A 6.6 MB transfer becomes ~30 bytes, and a stale read is impossible by
construction rather than by tuning. The version lives in the FILENAME, so a hit
is a single `open()` — the cache never reads a file it is about to reject.

DISK, NOT MEMORY, AND DELIBERATELY. Worker RAM is the other Phase 5 ceiling and
it had already regressed once during the phase (385 MB -> 560 MB peak) before
being brought back to 311 MB resting. CPython does not return freed arenas to
the OS, so an in-memory blob cache is permanent once touched — fixing the egress
ceiling by re-pressuring the RAM one would be a poor trade. The Render worker
has no persistent disk (`disk: None`, plan `starter`), so this uses the
container's EPHEMERAL filesystem, which is the right lifetime anyway: the
repetition being exploited happens *within* one worker lifetime. A restart
simply means each blob is fetched once more.

IT MUST NEVER MAKE THINGS WORSE. Every failure path here falls through to a
direct database read, which is exactly today's behaviour. An unwritable
directory, a full disk, a truncated file, a permission error — all degrade to
"no cache", never to an error and never to wrong data.
"""
from __future__ import annotations

import hashlib
import os
import tempfile
import threading
from datetime import datetime

# Cap total bytes on disk. Modest on purpose: the container filesystem is
# shared with everything else the worker does, and the working set that
# actually matters (a handful of multi-MB snapshots plus ~600 boxscores) fits
# comfortably. Oldest-accessed files are evicted first.
CACHE_MAX_BYTES = int(os.environ.get("LINESMITH_BLOB_CACHE_MAX_BYTES", 256 * 1024 * 1024))
CACHE_DIR = os.environ.get("LINESMITH_BLOB_CACHE_DIR") or os.path.join(
    tempfile.gettempdir(), "linesmith-blob-cache")

_lock = threading.Lock()
_enabled = True
_stats = {"hits": 0, "misses": 0, "bytes_served": 0, "bytes_fetched": 0,
          "evictions": 0, "errors": 0}


def _ensure_dir() -> bool:
    """True if the cache directory is usable. Disables the cache permanently
    for this process on failure rather than raising on every call."""
    global _enabled
    if not _enabled:
        return False
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        return True
    except Exception:   # noqa: BLE001 - ValueError on embedded NUL, OSError otherwise
        _enabled = False
        return False


def _path(cache_key: str, fetched_at: datetime) -> str:
    """The version is IN THE FILENAME, so a stale entry simply does not exist
    at the path we look up — no read, no compare, no chance of serving it."""
    h = hashlib.sha256(cache_key.encode("utf-8")).hexdigest()[:32]
    stamp = int(fetched_at.timestamp() * 1_000_000)
    return os.path.join(CACHE_DIR, f"{h}.{stamp}.blob")


def get(cache_key: str, fetched_at: datetime) -> str | None:
    """The payload stored under exactly this version, or None."""
    if not _ensure_dir():
        return None
    try:
        p = _path(cache_key, fetched_at)
        with open(p, "rb") as f:
            data = f.read()
    except Exception:   # noqa: BLE001 - a bad path must be a miss, never a raise
        with _lock:
            _stats["misses"] += 1
        return None
    try:
        payload = data.decode("utf-8")
    except UnicodeDecodeError:
        # A truncated or corrupted file is a miss, not an error. Drop it.
        with _lock:
            _stats["errors"] += 1
        try:
            os.remove(p)
        except OSError:
            pass
        return None
    with _lock:
        _stats["hits"] += 1
        _stats["bytes_served"] += len(data)
    try:                     # refresh atime/mtime so LRU eviction sees usage
        os.utime(p, None)
    except OSError:
        pass
    return payload


def put(cache_key: str, fetched_at: datetime, payload: str) -> None:
    """Store a payload under its version. Best-effort: never raises."""
    if not _ensure_dir():
        return
    data = payload.encode("utf-8")
    try:
        p = _path(cache_key, fetched_at)
        tmp = f"{p}.tmp{os.getpid()}.{threading.get_ident()}"
        with open(tmp, "wb") as f:
            f.write(data)
        # Atomic. A reader must never observe a half-written blob under a
        # version stamp that claims to be complete.
        os.replace(tmp, p)
    except Exception:   # noqa: BLE001
        with _lock:
            _stats["errors"] += 1
        try:
            os.remove(tmp)
        except Exception:  # noqa: BLE001
            pass
        return
    with _lock:
        _stats["bytes_fetched"] += len(data)
    _drop_other_versions(cache_key, keep=p)
    _enforce_cap()


def _drop_other_versions(cache_key: str, keep: str) -> None:
    """Superseded versions of the same key are dead weight the moment a newer
    one lands — nothing will ever look them up again, since lookups are by
    exact stamp."""
    h = hashlib.sha256(cache_key.encode("utf-8")).hexdigest()[:32]
    try:
        for name in os.listdir(CACHE_DIR):
            if name.startswith(h + ".") and name.endswith(".blob"):
                full = os.path.join(CACHE_DIR, name)
                if full != keep:
                    try:
                        os.remove(full)
                    except OSError:
                        pass
    except OSError:
        pass


def _enforce_cap() -> None:
    """Evict least-recently-used until under CACHE_MAX_BYTES."""
    try:
        entries = []
        total = 0
        for name in os.listdir(CACHE_DIR):
            if not name.endswith(".blob"):
                continue
            full = os.path.join(CACHE_DIR, name)
            try:
                st = os.stat(full)
            except OSError:
                continue
            entries.append((st.st_mtime, st.st_size, full))
            total += st.st_size
        if total <= CACHE_MAX_BYTES:
            return
        entries.sort()                      # oldest touched first
        for _mtime, size, full in entries:
            if total <= CACHE_MAX_BYTES:
                break
            try:
                os.remove(full)
                total -= size
                with _lock:
                    _stats["evictions"] += 1
            except OSError:
                pass
    except OSError:
        pass


def stats() -> dict:
    """Counters for the health check. `saved_bytes` is the egress this cache
    prevented: payload bytes served from disk that would otherwise have crossed
    the pooler."""
    with _lock:
        s = dict(_stats)
    s["enabled"] = _enabled
    s["dir"] = CACHE_DIR
    total = s["hits"] + s["misses"]
    s["hit_rate"] = (s["hits"] / total) if total else 0.0
    s["saved_bytes"] = s["bytes_served"]
    return s


def reset_stats() -> None:
    with _lock:
        for k in _stats:
            _stats[k] = 0
