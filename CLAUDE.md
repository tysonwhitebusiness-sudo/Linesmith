# CLAUDE.md

Project-specific guidance for working in this codebase.

## API route caching

Every new `app/api/**/route.ts` GET handler that does a live external fetch or non-trivial computation must go through one of these two patterns — not a third, hand-rolled one:

1. **`cachedRoute()`** (`lib/cachedRoute.ts`) — the default choice. Stale-while-revalidate: serves cached data instantly (including stale-but-usable data while refreshing in the background), never blocks a real request on a full rebuild except on a genuine cold cache. See `app/api/mlb/team-form/route.ts` for the simplest real example to copy from — resolve a cache key, pick a TTL grounded in how fast the underlying data actually changes, write a `build()` function that does the real work with no caching of its own, call `cachedRoute({ cacheKey, ttlMs, build, ... })` from `GET`. Options exist for a few real, narrow variations already found in this codebase — read the JSDoc on `CachedRouteOptions` before assuming you need something new:
   - `notFoundMessage` — when `build()` can legitimately return "not found" (a bad id), see `app/api/mlb/team/[teamId]/route.ts`.
   - `transform` — when the cached payload isn't the wire shape (e.g. a season-wide cache sliced down to one team's rows before responding), see `app/api/mlb/team-statcast/route.ts`.
   - `skipWrite` — only when `build()` already persists its own result under the same key for a reason outside this route's control (e.g. also called directly by the proactive scheduler in `lib/scheduler.ts`), see `app/api/mlb/route.ts`.

2. **Direct SQLite reads + a background-refresh trigger** — for a route whose data already lives in its own real table, not a snapshot blob. See `app/api/props/lines/route.ts` (reads `prop_odds` directly, calls `triggerFreshen()` from `lib/staleCache.ts` non-blocking).

Both patterns compose the same three underlying pieces: `lib/staleCache.ts` (`triggerBackgroundRebuild`/`awaitRebuild` — dedup guard so only one rebuild per cache key runs at a time), `lib/db/client.ts` (`readSnapshotCache`/`writeSnapshotCache` — the SQLite-persisted cache itself, survives server restarts unlike a plain in-memory `Map`), and `lib/db/jsonPassthrough.ts` (`jsonPassthrough` — returns an already-serialized JSON string without a costly re-parse/re-serialize round trip on large payloads).

**Before picking a `cacheKey`, grep for it.** `readSnapshotCache`/`writeSnapshotCache` share one flat `snapshot_cache` table — there's no per-caller namespacing, so a route's cache key can silently collide with a key some constituent function already uses for its own, differently-shaped internal cache (`grep -rn "cacheKey\|CACHE_KEY" lib/` to see what's taken). This happened for real: `app/api/golf/schedule/route.ts` originally reused `golf:schedule:${year}`, the exact key `getSeasonSchedule()` (`lib/sports/golf/schedule.ts`) already used internally to cache just the raw `events` array — the route ended up reading that entry back and serving a bare array instead of its own `{events, fetchedAt, ...}` wrapper. Fixed by namespacing the route's key distinctly (`golf:schedule:route:${year}`). Bugs like this pass `tsc --noEmit` cleanly and only show up as a real shape mismatch in the response body — diff the actual bytes, not just the status code, when verifying a new route.

**The only routes allowed to skip both patterns:**
- POST-triggered user actions (e.g. `app/api/props/scan-player/route.ts`) — these are explicit, user-initiated refreshes, not passive page-load cost.
- Admin/diagnostic/backfill/model-fitting routes (anything under `/api/*backfill*`, `/api/*fit-weights*`, `/api/*ingest-*`, `/api/selftest`, `/api/diagnostics/*`, and similar) — not on a real user's page-load path.
- Routes with a documented per-request write side-effect or a genuinely-live-data contract that a cache would break. This isn't a loophole for "didn't want to bother caching it" — write a comment explaining the real reason, the way `app/api/odds/lines/route.ts`, `app/api/bets/route.ts`, and `app/api/mlb/game/[gameId]/live/route.ts` already do, before adding a new instance of this category.

**Why this matters**: a route built without either pattern makes every visitor pay the full external-call or computation cost on every single page load — this was found and fixed on the same handful of routes repeatedly across one session before this convention existed. The fix is always the same shape; there's no reason to rediscover it per route.
