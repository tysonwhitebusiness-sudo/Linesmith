/**
 * Proactive background refresh for `/api/mlb` and `/api/props/calibration` —
 * keeps each cache warm on a timer instead of relying on a real request to
 * be the one that triggers a rebuild. Combined with each route's own
 * stale-serve logic (serve cached, refresh in the background), a real
 * request almost never has to wait on anything.
 *
 * Cutover (2026-08-20): the five odds-provider refresh jobs this file used
 * to own directly — Tier 1, SportsGameOdds, NFL, CFB, Soccer/EPL — are now
 * owned solely by the Python worker (`python-odds-service`, `JOB_REGISTRY`
 * in `jobs.py`), not run from here anymore. See
 * docs/phase2-hardening-gameplan-2026-08-20.md for the full hardening pass
 * that preceded this cutover. `refreshMlb` and `refreshCalibration` stay
 * here deliberately — MLB's snapshot rebuild isn't an odds-provider job, and
 * calibration is pure Postgres aggregation with no provider calls, out of
 * scope for the Python port from the start.
 *
 * IMPORTANT: this edit must not reach production while the Python worker is
 * suspended — with both this file's old jobs gone and the worker down,
 * nothing refreshes prop odds at all. Confirm the worker is resumed and
 * healthy before deploying.
 *
 * This is *not* `instrumentation.ts` — that's Next's official run-once
 * startup hook, and it looked like the natural home for this, but its
 * dev-mode bundling doesn't code-split a dynamic `import()` the way a
 * normal route does: `better-sqlite3` (a native module, needs `fs`) got
 * pulled into the same edge-compatible bundle instrumentation.ts is built
 * against and failed to resolve, taking every request down with a 500.
 * Confirmed by trying it — this file exists because that one didn't work.
 *
 * Instead, `ensureSchedulerStarted()` is called once from a module-level
 * side effect in a route file that's guaranteed to load early. In `next
 * start` (this app's real deployment — one persistent process, not
 * serverless), Next loads every route module before serving the first
 * request, so this genuinely starts at boot. In `next dev`, route modules
 * compile lazily on first hit, so it starts on whichever request happens to
 * load first instead — the ongoing warm-cache benefit is identical either
 * way; only the very-first-request timing differs between dev and prod.
 */

import { rebuildMlbSnapshot, TODAY_CACHE_KEY } from '@/lib/sports/mlb/snapshotRebuild';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { computeCalibrationPayload, calibrationCacheKey } from '@/lib/odds/props/calibrationSnapshot';
import { writeSnapshotCache } from '@/lib/db/client';
import { awaitRebuild } from '@/lib/staleCache';

const MLB_INTERVAL_MS = 4 * 60_000;
const CALIBRATION_INTERVAL_MS = 2 * 60_000;
/** The scope defaults real traffic actually asks for without a `dimension` param — the Model Health page's per-dimension split view is rarer and still served correctly by the reactive stale-serve path, just without proactive pre-warming. */
const CALIBRATION_SCOPES = ['all', 'player', 'game'] as const;

let started = false;

// Both routed through the same dedup pool their route handlers use — a
// request landing at the exact moment one of these ticks is rebuilding the
// same key joins that rebuild instead of racing it with a second one.
async function refreshMlb() {
  try {
    await awaitRebuild(TODAY_CACHE_KEY, () => rebuildMlbSnapshot(easternDate(), TODAY_CACHE_KEY, true));
  } catch (error) {
    console.error('[scheduler] proactive MLB refresh failed', error);
  }
}

async function refreshCalibration() {
  try {
    for (const scope of CALIBRATION_SCOPES) {
      const key = calibrationCacheKey(scope, null);
      await awaitRebuild(key, async () => {
        const payload = await computeCalibrationPayload(scope, null);
        await writeSnapshotCache(key, JSON.stringify(payload));
        return payload;
      });
    }
  } catch (error) {
    console.error('[scheduler] proactive calibration refresh failed', error);
  }
}

/** Idempotent — safe to call from more than one route's module scope; only the first call actually starts anything. */
export function ensureSchedulerStarted(): void {
  if (started) return;
  started = true;

  // Fire once immediately — not waiting a full interval — so the window
  // where a real request could still land on a truly empty cache is
  // seconds, not minutes. Then repeat on each job's own cadence.
  void refreshMlb();
  void refreshCalibration();
  setInterval(() => void refreshMlb(), MLB_INTERVAL_MS);
  setInterval(() => void refreshCalibration(), CALIBRATION_INTERVAL_MS);
}
