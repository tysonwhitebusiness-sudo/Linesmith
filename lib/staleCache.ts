/**
 * Server-side stale-while-revalidate — the piece `/api/mlb`, `/api/props/lines`,
 * and `/api/props/calibration` were each missing: on a stale cache, they
 * blocked the HTTP response on a full rebuild (30-40s for the MLB snapshot,
 * 9-15s for the others) instead of serving what's already cached and
 * refreshing quietly behind it. `useSnapshot.ts` already does this
 * client-side; this is the same idea, one layer down.
 *
 * Deliberately just a dedupe guard, not a cache store — each caller decides
 * where its own "stale but usable" data lives (a `snapshot_cache` blob, the
 * `prop_odds` tables, whatever). This only makes sure that no matter who
 * triggers a rebuild for a given key — a request landing on a stale cache, a
 * request landing on a true miss, or `instrumentation.ts`'s proactive
 * scheduler — there's ever only one rebuild in flight at a time. Without
 * that guarantee, a cold-boot request racing the scheduler's own first tick
 * has already been observed to run two full MLB-snapshot rebuilds
 * concurrently, which is *slower* than one — see snapshotRebuild.ts's
 * `mapLimit` comment on why hammering MLB's API with extra concurrency
 * backfires instead of helping.
 */

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Calling an `async` function runs its body *synchronously* up to its first
 * real `await` — if that function has no internal await at all (confirmed
 * true of `computeCalibrationPayload`, whose SQLite calls are all
 * synchronous), calling it blocks the caller for its entire duration before
 * anything is "in the background" at all. `setImmediate` forces a genuine
 * yield to the event loop before `task` starts, so the response already in
 * flight (the stale payload) actually gets sent before this begins, no
 * matter what `task` itself looks like inside.
 */
function getOrStart<T>(key: string, task: () => Promise<T>): Promise<T> {
  let promise = inFlight.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = new Promise<T>((resolve, reject) => {
      setImmediate(() => {
        task().then(resolve, reject);
      });
    }).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
  }
  return promise;
}

/**
 * Kicks off `task` in the background for `key`, unless one's already running
 * for that key (from any caller — this one, `awaitRebuild`, or the proactive
 * scheduler). Never awaited by the caller — errors are logged, not thrown,
 * since by the time this runs, the response serving stale data has usually
 * already gone out.
 */
export function triggerBackgroundRebuild(key: string, task: () => Promise<unknown>): void {
  void getOrStart(key, task).catch((error) => {
    console.error(`[staleCache:${key}] background rebuild failed`, error);
  });
}

/**
 * Same dedup pool as `triggerBackgroundRebuild`, but awaited — for the one
 * case that genuinely has to wait: nothing cached yet at all. If a
 * background rebuild for this key is already running (e.g. the proactive
 * scheduler's boot-time tick got there first), this joins that same
 * in-flight promise instead of starting a second, redundant rebuild.
 */
export async function awaitRebuild<T>(key: string, task: () => Promise<T>): Promise<T> {
  return getOrStart(key, task);
}

/** True while a background rebuild for `key` is in flight — lets a caller avoid redundant work (e.g. the proactive scheduler skipping a tick that a request-triggered rebuild is already covering). */
export function isRebuildInFlight(key: string): boolean {
  return inFlight.has(key);
}
