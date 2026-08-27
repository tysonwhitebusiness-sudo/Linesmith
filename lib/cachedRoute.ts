/**
 * The stale-while-revalidate pattern hand-rolled into ~9 API routes this
 * session (`/api/mlb`, `/api/nfl`, `/api/golf`, `/api/mlb/team/[teamId]`,
 * `/api/nfl/team/[teamId]`, `/api/mlb/team-form`, `/api/mlb/team-statcast`,
 * `/api/mlb/teams`, `/api/props/calibration`), extracted into one function.
 * Composes the three existing pieces — `lib/staleCache.ts`'s dedup guard,
 * `lib/db/client.ts`'s SQLite-persisted key/value cache, and
 * `lib/db/jsonPassthrough.ts`'s no-reparse response — instead of inventing
 * anything new.
 *
 * A route using this only needs to declare `export const dynamic =
 * 'force-dynamic';` itself (Next.js requires that as a literal top-level
 * export, can't be set from inside a helper) and call `cachedRoute()` from
 * its `GET` handler with a cache key, a TTL, and a `build()` function that
 * does the real work with no caching of its own.
 *
 * Gzip compression (2026-08-21): Next's built-in `compress: true` covers
 * page/static responses but was confirmed live NOT to apply to Route
 * Handler responses under `next start` (checked real response headers —
 * `/` got `content-encoding: gzip`, `/api/mlb` and `/api/selftest` didn't,
 * regardless of whether the handler used `NextResponse.json` or a raw
 * `Response`). Passing `request` here is what lets `jsonPassthrough`/
 * `jsonResponse` negotiate it correctly via `Accept-Encoding` — every
 * `cachedRoute()` caller gets this for free by supplying `request`, current
 * and future, rather than each route needing its own compression logic.
 */

import { NextResponse } from 'next/server';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { cacheControlFor, jsonPassthrough, jsonResponse } from '@/lib/db/jsonPassthrough';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';

export interface CachedRouteOptions<T, R = T> {
  /** Fully resolved by the caller before calling this, e.g. `nfl:team:${teamId}`. */
  cacheKey: string;
  ttlMs: number;
  /**
   * Computes the value to cache — no caching of its own, `cachedRoute` owns
   * the read/write. Return `null`/`undefined` only when `notFoundMessage` is
   * set (e.g. a bad id) — that combination is what triggers an uncached 404
   * instead of caching an empty result. Omit `notFoundMessage` when `build`
   * always either succeeds or throws.
   */
  build: () => Promise<T | null | undefined>;
  notFoundMessage?: string;
  /**
   * Post-read projection applied identically on hit/stale/miss — e.g.
   * `mlb/team-statcast`'s per-team slice out of a season-wide cached blob.
   * When set, every response goes through `jsonResponse(transform(...), ...)`
   * instead of the raw `jsonPassthrough`, since the wire payload differs
   * from what's actually stored in the cache.
   */
  transform?: (payload: T) => R;
  /** Log tag for the outer catch; defaults to `cacheKey`. Pass explicitly for high-cardinality dynamic keys so logs aren't split across every id. */
  routeName?: string;
  /** Message for the final 502 when nothing is cached and `build()` throws. */
  errorMessage?: string;
  /**
   * Set when `build()` already persists its own result under `cacheKey`
   * (e.g. `rebuildMlbSnapshot`, also called directly by the proactive
   * scheduler outside any route — it has to own its own write regardless of
   * what calls it). Skips `cachedRoute`'s own write-through so a large
   * payload isn't serialized to SQLite twice per rebuild.
   */
  skipWrite?: boolean;
  /**
   * Bypasses the TTL check entirely and goes straight to a real rebuild,
   * same as a genuine miss — for routes with their own `?force=` query param
   * where a caller explicitly asked to skip the cache (e.g. `golf/lines`,
   * mirroring `getMlbGameLines(force)`'s own bypass one layer down).
   */
  force?: boolean;
  /**
   * The route's own `Request` — read only for its `Accept-Encoding` header,
   * to negotiate gzip via `jsonPassthrough`/`jsonResponse`. Omit only when
   * a route genuinely has no `Request` in scope (a bare `GET()`); the route
   * still works, it just always sends uncompressed. Widening a `GET()` to
   * `GET(request: Request)` to pass this through is the whole ask — nothing
   * else is ever read from `request` here.
   */
  request?: Request;
}

export async function cachedRoute<T, R = T>(opts: CachedRouteOptions<T, R>): Promise<Response> {
  const { cacheKey, ttlMs, build, notFoundMessage, transform, routeName, errorMessage, skipWrite, force, request } = opts;
  const acceptEncoding = request?.headers.get('accept-encoding') ?? null;

  function respondCached(rawPayload: string, cacheState: 'hit' | 'stale'): Response {
    if (transform) {
      // Same real HTTP-layer caching as jsonPassthrough's own cacheState
      // handling (see that function's docstring) — a transform()ed value
      // is still deterministic per (cacheKey, transform) for a given
      // cache generation, so a genuine 'hit' is just as safe to let a
      // CDN/browser dedupe for a short window.
      return jsonResponse(transform(JSON.parse(rawPayload) as T), { 'cache-control': cacheControlFor(cacheState), 'x-cache': cacheState }, acceptEncoding);
    }
    return jsonPassthrough(rawPayload, cacheState, cacheKey, acceptEncoding);
  }

  async function rebuild(): Promise<T | null | undefined> {
    const payload = await build();
    if (payload != null && !skipWrite) {
      try { await writeSnapshotCache(cacheKey, JSON.stringify(payload)); } catch { /* ok */ }
    }
    return payload;
  }

  try {
    const cached = force ? null : await readSnapshotCache(cacheKey);
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

    if (cached && age < ttlMs) {
      return respondCached(cached.payload, 'hit');
    }
    if (cached) {
      triggerBackgroundRebuild(cacheKey, rebuild);
      return respondCached(cached.payload, 'stale');
    }

    const started = Date.now();
    const payload = await awaitRebuild(cacheKey, rebuild);
    if (payload == null) {
      if (notFoundMessage) {
        return NextResponse.json({ error: notFoundMessage }, { status: 404 });
      }
      throw new Error(`cachedRoute: build() returned null/undefined for "${cacheKey}" with no notFoundMessage set`);
    }
    const body = transform ? transform(payload) : payload;
    return jsonResponse(
      body,
      { 'cache-control': 'no-store', 'x-cache': 'miss', 'x-elapsed-ms': String(Date.now() - started) },
      acceptEncoding,
    );
  } catch (error) {
    console.error(`[${routeName ?? cacheKey}]`, error);
    const stale = await readSnapshotCache(cacheKey);
    if (stale) {
      return respondCached(stale.payload, 'stale');
    }
    return NextResponse.json(
      { error: errorMessage ?? 'Request failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
