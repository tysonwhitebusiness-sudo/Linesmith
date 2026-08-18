/**
 * Fire-and-forget wrapper around `refreshTier1()` — pulled out of
 * `/api/props/lines`'s route handler so `instrumentation.ts`'s proactive
 * scheduler can call the same trigger directly (a Next.js `route.ts` file
 * can only export the handful of names the framework recognizes).
 */

import { refreshTier1 } from './tier1Refresh';

const REFRESH_TTL_MS = 3 * 60_000;
let lastRefreshAt = 0;
let refreshInFlight: Promise<unknown> | null = null;

/**
 * Kicks off `refreshTier1()` if stale — awaited only when nothing has ever
 * run yet in this process, so the very first caller pays the real cost but
 * every one after that reads whatever's already in SQLite while the refresh
 * runs quietly behind it.
 */
export async function triggerFreshen(): Promise<void> {
  if (Date.now() - lastRefreshAt < REFRESH_TTL_MS) return;
  if (!refreshInFlight) {
    refreshInFlight = refreshTier1()
      .then((summary) => {
        lastRefreshAt = Date.now();
        return summary;
      })
      .catch((error) => {
        console.error('[tier1RefreshScheduler] refresh failed', error);
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  if (lastRefreshAt === 0) {
    // Nothing has ever completed in this process — this caller has no
    // choice but to wait for the first run, same as `/api/mlb`'s true
    // cold-cache path.
    await refreshInFlight;
  }
}
