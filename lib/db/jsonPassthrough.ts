/**
 * Send JSON, gzip-compressed whenever the client supports it and the payload
 * is big enough to be worth it (2026-08-21 — see the API-payload-compression
 * investigation this session: the real MLB snapshot is 24.5MB uncompressed,
 * ~1.24MB gzipped — a ~20x reduction, 607ms of CPU at level 6 on that size).
 *
 * `cachedRoute()` (lib/cachedRoute.ts) is the ONLY intended caller — every
 * route already going through that shared function gets this automatically,
 * present and future, matching this codebase's "one shared implementation,
 * not hand-rolled per route" convention. A route that needs raw JSON
 * sending outside `cachedRoute()` should still route through here rather
 * than reinventing compression.
 *
 * Never compresses unconditionally — a client that doesn't advertise gzip
 * support in `Accept-Encoding` would receive unreadable bytes. Below
 * `COMPRESS_THRESHOLD_BYTES` compression is skipped even when supported:
 * gzip has real fixed overhead (header/footer, a slower code path) that
 * isn't worth it for a small payload — same 1KB default threshold Express's
 * `compression` middleware uses.
 */
import zlib from 'zlib';

const COMPRESS_THRESHOLD_BYTES = 1024;

function shouldCompress(payload: string, acceptEncoding: string | null): boolean {
  return !!acceptEncoding && acceptEncoding.includes('gzip') && Buffer.byteLength(payload) >= COMPRESS_THRESHOLD_BYTES;
}

function gzip(payload: string): Buffer {
  // Level 6 (Node's default) measured on the real 24.5MB MLB snapshot:
  // 607ms, 5.1% of original size. Level 9 measured 2058ms for only 0.2
  // percentage points more compression — not a real trade worth taking.
  return zlib.gzipSync(payload, { level: 6 });
}

/**
 * The snapshot cache stores JSON text. Handing it to `NextResponse.json`
 * means parsing it into objects and immediately re-serialising them to get
 * back the same bytes — which on these payloads (an MLB slate is 500+
 * candidates each carrying a full game log; golf's is larger still) costs
 * seconds of CPU per request and was enough to keep the dev server pegged.
 *
 * Reuses the compressed bytes across requests for the same `cacheKey` when
 * the underlying string hasn't changed — a hot cache re-serves the same
 * gzip output instead of re-paying the ~600ms compression cost on every
 * single request; only a real rebuild (a genuinely different string)
 * triggers recompression. Safe specifically because the passthrough path's
 * string IS the literal response for every caller sharing a cacheKey —
 * unlike a `transform`ed value, which can legitimately differ per request
 * from the same base cacheKey (e.g. a per-team slice), see `jsonResponse`.
 */
const compressedCache = new Map<string, { raw: string; gzipped: Buffer }>();

/**
 * Real HTTP-layer caching, added 2026-08-27 to fix a confirmed, live
 * egress problem: every cachedRoute() response set cache-control:
 * no-store unconditionally, meaning a warm Postgres-level cache HIT was
 * still re-transferred in full on every single HTTP request — the real
 * MLB snapshot (11MB, `mlb:snapshot`) confirmed as 81% of snapshot_cache
 * and the dominant driver of a 103GB overage against a 5GB Supabase
 * plan. This doesn't touch the app-level snapshot_cache TTL at all
 * (still whatever each route's own ttlMs says) — it's a short, separate
 * window that only dedupes a burst of near-simultaneous requests
 * (multiple tabs/users loading the same page seconds apart, or a client
 * re-fetching faster than the data could possibly have changed) from
 * re-hitting Postgres for literally identical bytes.
 *
 * 'stale' deliberately keeps no-store: a stale response already means
 * the app knows a rebuild is due (triggerBackgroundRebuild just fired) —
 * caching it further downstream would compound how long real users see
 * old data after that rebuild actually lands. Only a genuine 'hit'
 * (confirmed fresh per the app's own TTL) gets the short public window.
 */
export function cacheControlFor(cacheState: 'hit' | 'stale'): string {
  return cacheState === 'hit' ? 'public, s-maxage=30, stale-while-revalidate=60' : 'no-store';
}

export function jsonPassthrough(payload: string, cacheState: 'hit' | 'stale', cacheKey: string, acceptEncoding: string | null): Response {
  if (shouldCompress(payload, acceptEncoding)) {
    let cached = compressedCache.get(cacheKey);
    if (!cached || cached.raw !== payload) {
      cached = { raw: payload, gzipped: gzip(payload) };
      compressedCache.set(cacheKey, cached);
    }
    // TS's BodyInit type doesn't accept Node's Buffer directly (a type
    // definitions gap, not a runtime one — Buffer works fine as a body).
    // `new Uint8Array(buffer)` does copy here (TypedArray-from-TypedArray
    // construction copies per spec), but at this size (~1.2MB compressed)
    // that's sub-millisecond — negligible next to the ~600ms gzip call.
    return new Response(new Uint8Array(cached.gzipped), {
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        vary: 'accept-encoding',
        'cache-control': cacheControlFor(cacheState),
        'x-cache': cacheState,
      },
    });
  }
  return new Response(payload, {
    headers: { 'content-type': 'application/json', 'cache-control': cacheControlFor(cacheState), 'x-cache': cacheState },
  });
}

/**
 * Same compression policy as `jsonPassthrough`, for a value that still
 * needs `JSON.stringify` — `cachedRoute()`'s `transform` path and its
 * cold-miss path. No cross-request compressed-bytes reuse here: `transform`
 * output can legitimately differ per request from the same base cacheKey
 * (e.g. `mlb/team-statcast`'s per-team slice out of one season-wide cache),
 * so caching by cacheKey alone would risk serving one caller's slice,
 * compressed, to a different caller asking for a different slice.
 * Compresses fresh each call instead — correct over cheap; these payloads
 * are typically far smaller than the passthrough path's anyway.
 */
export function jsonResponse(value: unknown, extraHeaders: Record<string, string>, acceptEncoding: string | null): Response {
  const payload = JSON.stringify(value);
  if (shouldCompress(payload, acceptEncoding)) {
    return new Response(new Uint8Array(gzip(payload)), {
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', vary: 'accept-encoding', ...extraHeaders },
    });
  }
  return new Response(payload, { headers: { 'content-type': 'application/json', ...extraHeaders } });
}
