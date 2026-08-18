import { NextResponse } from 'next/server';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { readSnapshotCache } from '@/lib/db/client';
import { jsonPassthrough } from '@/lib/db/jsonPassthrough';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';
import { rebuildMlbSnapshot, TODAY_CACHE_KEY, CACHE_TTL_MS, FUTURE_DATE_CACHE_TTL_MS } from '@/lib/sports/mlb/snapshotRebuild';
import { ensureSchedulerStarted } from '@/lib/scheduler';

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

  try {
    const cached = readSnapshotCache(cacheKey);
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

    if (cached && age < ttl) {
      return jsonPassthrough(cached.payload, 'hit');
    }

    if (cached) {
      // Stale but present — never make a real request wait on a rebuild.
      // Serve what's cached now, refresh quietly behind it (deduped, so
      // concurrent requests during the same stale window share one rebuild
      // rather than each starting their own).
      triggerBackgroundRebuild(cacheKey, () => rebuildMlbSnapshot(date, cacheKey, isToday));
      return jsonPassthrough(cached.payload, 'stale');
    }

    // Nothing cached yet at all — this request has no choice but to wait
    // for the first build. Should only happen on a truly cold start; the
    // proactive scheduler in instrumentation.ts exists specifically to make
    // this the rare case, not the common one. Routed through the same
    // dedup pool as the stale-path and the scheduler itself — if the
    // scheduler's own boot-time tick is already rebuilding this exact key,
    // this request joins that instead of starting a second, redundant
    // (and, per snapshotRebuild.ts's mapLimit comment, actively slower)
    // concurrent rebuild.
    const started = Date.now();
    const snapshot = await awaitRebuild(cacheKey, () => rebuildMlbSnapshot(date, cacheKey, isToday));
    const elapsed = Date.now() - started;

    return NextResponse.json(snapshot, {
      headers: {
        'cache-control': 'no-store',
        'x-cache': 'miss',
        'x-elapsed-ms': String(elapsed),
      },
    });
  } catch (error) {
    console.error('[api/mlb]', error);

    // Serve stale cache on error
    const stale = readSnapshotCache(cacheKey);
    if (stale) {
      return jsonPassthrough(stale.payload, 'stale');
    }

    return NextResponse.json(
      { error: 'MLB snapshot failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
