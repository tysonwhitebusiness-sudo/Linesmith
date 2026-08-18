import { easternDate } from '@/lib/sports/mlb/statsapi';
import { rebuildMlbSnapshot, TODAY_CACHE_KEY, CACHE_TTL_MS, FUTURE_DATE_CACHE_TTL_MS } from '@/lib/sports/mlb/snapshotRebuild';
import { ensureSchedulerStarted } from '@/lib/scheduler';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Module-level side effect, not inside GET — runs once when this route
// module first loads (at boot under `next start`, on first request under
// `next dev`; see scheduler.ts's own comment for why this lives here
// instead of instrumentation.ts). Idempotent, so it's harmless that other
// routes could in principle trigger the same load.
ensureSchedulerStarted();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** P4 — browsing a future date is a preview, not "today's real picks": never
 * log candidates or grade games for anything but the actual current date.
 * Fetching the same future game's snapshot on three different days as odds
 * firm up would otherwise log it as "surfaced" three separate times and
 * corrode calibration with speculative, pre-market data. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const today = easternDate();
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : today;
  const isToday = date === today;
  const cacheKey = isToday ? TODAY_CACHE_KEY : `mlb:snapshot:${date}`;
  const ttl = isToday ? CACHE_TTL_MS : FUTURE_DATE_CACHE_TTL_MS;

  // rebuildMlbSnapshot writes its own cache entry (and a second raw-candidates
  // side-key) — it's also called directly by the proactive scheduler outside
  // any route, so it has to own that write regardless of caller. skipWrite
  // avoids cachedRoute serializing the same multi-MB payload to SQLite again.
  return cachedRoute({
    cacheKey,
    ttlMs: ttl,
    build: () => rebuildMlbSnapshot(date, cacheKey, isToday),
    skipWrite: true,
    errorMessage: 'MLB snapshot failed',
  });
}
