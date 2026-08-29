/**
 * Proactive background refresh for `/api/mlb` and `/api/props/calibration` —
 * keeps each cache warm on a timer instead of relying on a real request to be
 * the one that triggers a rebuild. Combined with each route's own stale-serve
 * logic, a real request almost never has to wait on anything.
 *
 * WHAT THIS FILE STILL DOES, as of task 2.8 (2026-08-29), because the header
 * that used to be here described a version of it that had not existed for
 * some time (finding P2 M6.5):
 *
 *   * `refreshMlb` rebuilds `snapshot_cache['mlb:snapshot']` every 4 minutes.
 *     Since task 2.7 that rebuild is fetch-trim-cache only — every model and
 *     grading write it used to perform belongs to a Python job now, and the
 *     prop probabilities it renders are read from `mlb_prop_model_cache`
 *     rather than computed here.
 *   * `refreshCalibration` recomputes the calibration payload every 30
 *     minutes. This is the one piece of model math still running in
 *     TypeScript, and it is deliberate: standing decision Q18 defers the port
 *     to Phase 4, which rewrites this logic anyway (tasks 4.2/4.3).
 *
 * Both run under `withJobLock`, so N app instances produce one rebuild per
 * interval rather than N. That matters before Phase 8 and not before: these
 * are `setInterval` timers inside the Next.js server process, so the
 * duplication is invisible on a single-instance laptop and automatic the
 * moment there are two.
 *
 * The old header enumerated five odds-provider jobs this file no longer runs
 * (they moved to the Python worker on 2026-08-20) and explained the file's
 * existence in terms of `better-sqlite3` bundling — a dependency it had
 * already stopped using, and which task 2.6 moved to devDependencies. The
 * `instrumentation.ts` reasoning below survives that correction because it is
 * still true and still the reason this file exists rather than that one.
 *
 * This is *not* `instrumentation.ts` — that is Next's official run-once
 * startup hook, and it looked like the natural home for this, but its
 * dev-mode bundling doesn't code-split a dynamic `import()` the way a normal
 * route does: a native module needing `fs` got pulled into the same
 * edge-compatible bundle instrumentation.ts is built against and failed to
 * resolve, taking every request down with a 500. Confirmed by trying it —
 * this file exists because that one didn't work.
 *
 * Instead, `ensureSchedulerStarted()` is called once from a module-level side
 * effect in a route file guaranteed to load early. In `next start` (this
 * app's real deployment — one persistent process, not serverless), Next loads
 * every route module before serving the first request, so this genuinely
 * starts at boot. In `next dev`, route modules compile lazily on first hit, so
 * it starts on whichever request happens to load first instead; the ongoing
 * warm-cache benefit is identical either way.
 */

import { rebuildMlbSnapshot, TODAY_CACHE_KEY } from '@/lib/sports/mlb/snapshotRebuild';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { computeCalibrationPayload, calibrationCacheKey } from '@/lib/odds/props/calibrationSnapshot';
import { writeSnapshotCache } from '@/lib/db/client';
import { withJobLock } from '@/lib/db/pgClient';
import { awaitRebuild } from '@/lib/staleCache';

const MLB_INTERVAL_MS = 4 * 60_000;
// 30 minutes, not 2 (Phase 1.7, audit finding P2 C2). At 2 minutes this tick
// drove roughly 36 full scans of pick_history — now 365k rows — per tick across
// the three scopes below, which is a large, continuous database cost for a
// payload that barely changes: calibration is an aggregate over months of
// graded history, so a 2-minute refresh cannot show anything a 30-minute one
// misses. The reactive stale-serve path still covers any scope this doesn't
// pre-warm, so the only thing a longer interval costs is a slightly colder
// cache on the first request after a gap.
const CALIBRATION_INTERVAL_MS = 30 * 60_000;
/** The scope defaults real traffic actually asks for without a `dimension` param — the Model Health page's per-dimension split view is rarer and still served correctly by the reactive stale-serve path, just without proactive pre-warming. */
const CALIBRATION_SCOPES = ['all', 'player', 'game'] as const;

let started = false;

// Both routed through the same dedup pool their route handlers use — a
// request landing at the exact moment one of these ticks is rebuilding the
// same key joins that rebuild instead of racing it with a second one.
//
// `awaitRebuild` dedupes within ONE process. `withJobLock` dedupes ACROSS
// processes, and that is the gap task 2.7 closes: these are `setInterval`
// timers living inside the Next.js server process, so N instances of the app
// meant N timers, N rebuilds, and N sets of writes on every tick. Nothing
// about that is visible on a single-instance laptop, which is exactly why it
// had to be fixed before Phase 8 puts this behind a real deployment rather
// than discovered afterwards.
//
// `pg_try_advisory_lock`, not the blocking form: a second instance finding
// the lock held skips its tick outright. A skipped run is correct here, not
// an error — the next tick is four minutes away and the cache is still warm.
async function refreshMlb() {
  try {
    // Lease shorter than MLB_INTERVAL_MS (4 min) so a tick is never refused
    // by its own predecessor's lease, and longer than a real rebuild takes.
    const outcome = await withJobLock(
      'scheduler:refreshMlb',
      () => awaitRebuild(TODAY_CACHE_KEY, () => rebuildMlbSnapshot(easternDate(), TODAY_CACHE_KEY, true)),
      3 * 60_000,
    );
    if (!outcome.acquired) console.log('[scheduler] refreshMlb skipped — another instance holds the lease');
  } catch (error) {
    console.error('[scheduler] proactive MLB refresh failed', error);
  }
}

async function refreshCalibration() {
  try {
    // Same rule against CALIBRATION_INTERVAL_MS (30 min).
    const outcome = await withJobLock('scheduler:refreshCalibration', async () => {
    for (const scope of CALIBRATION_SCOPES) {
      // MLB only — this proactive scheduler job predates Phase 2 of docs/
      // scan-playerdetail-parity-gameplan-2026-08-27.md's sport param and
      // was never asked to warm every sport's cache proactively; the other
      // sports still get a real, correct payload on demand via the route's
      // own cachedRoute() build path, just without this warm-cache head start.
      const key = calibrationCacheKey('mlb', scope, null);
      await awaitRebuild(key, async () => {
        const payload = await computeCalibrationPayload('mlb', scope, null);
        await writeSnapshotCache(key, JSON.stringify(payload));
        return payload;
      });
    }
    }, 25 * 60_000);
    if (!outcome.acquired) console.log('[scheduler] refreshCalibration skipped — another instance holds the lease');
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
