/**
 * The MLB snapshot rebuild, pulled out of `/api/mlb`'s route handler so it
 * has one home both `GET` and `instrumentation.ts`'s proactive scheduler can
 * call directly — a Next.js `route.ts` file can only export the handful of
 * names the framework recognizes (GET, POST, dynamic, ...), not arbitrary
 * helpers.
 */

import { getMlbSnapshot } from './adapter';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { dedupeHistoryForList } from './historyTrim';
import { fullRawCacheKey } from './playerGamelogCache';
import type { SportSnapshot } from '@/lib/core/types';

export const TODAY_CACHE_KEY = 'mlb:snapshot';
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Future dates move slowly (lineups/odds firm up, not re-simulated), so they're worth caching longer than today's live slate. */
export const FUTURE_DATE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Everything a real rebuild does: fetch from the MLB API, then trim and
 * cache the result. It used to also run five write side effects for today's
 * slate; all five moved to the Python worker (see the note at the bottom of
 * the function). This is now a fetch-and-cache path and nothing else.
 * Callers decide whether to `await` this inline (nothing cached yet) or fire
 * it in the background (something stale to serve in the meantime) — the
 * function itself doesn't know or care which.
 */
export async function rebuildMlbSnapshot(date: string, cacheKey: string, isToday: boolean): Promise<SportSnapshot> {
  const snapshot = await getMlbSnapshot(new Date(`${date}T12:00:00Z`));

  // Stash the untrimmed candidates server-side before trimming, so a
  // player-detail "show all games" click can still recover full box-score
  // history for older games — see player-gamelog/route.ts. Never sent to a
  // browser in bulk, so its size doesn't matter the way the main response's does.
  try {
    await writeSnapshotCache(fullRawCacheKey(date), JSON.stringify(snapshot.candidates));
  } catch {
    // Non-critical — "show all games" on an older date just won't find extra detail
  }

  // Dedupe + trim before this snapshot is cached or sent anywhere — see
  // historyTrim.ts: strips each candidate's history down to
  // {period, result, category} and moves the shared per-player detail (date
  // labels, box scores) into one place instead of once per dimension.
  // useSnapshot.ts reconstructs the original shape client-side right after
  // fetch, so no rendering component needed to change.
  const { candidates: dedupedCandidates, playerGamelogs } = dedupeHistoryForList(snapshot.candidates);
  snapshot.candidates = dedupedCandidates;
  snapshot.context = { ...snapshot.context, other: { ...snapshot.context?.other, playerGamelogs } };

  try {
    await writeSnapshotCache(cacheKey, JSON.stringify(snapshot));
  } catch {
    // Non-critical — next request will just rebuild again
  }

  // NOTHING ELSE HAPPENS HERE ANY MORE, and that is the point of task 2.7.
  //
  // This function used to run five write side effects for today's slate:
  // logSnapshotCandidates and logGameModelPredictions into pick_history,
  // gradeFinishedGames over pick_history, gradeFinishedGamePicks over
  // game_picks, and Elo/pitcher-game-score maintenance. Every one of them
  // is now owned by a Python job on its own schedule —
  // computeMlbPropPredictionsJob, computeMlbGameModelJob, gradeMlbPropsJob,
  // gradeFinishedMlbPicksJob and maintainMlbEloJob respectively.
  //
  // Each of those wrote through an idempotent guard (first-surfaced-wins,
  // or `outcome IS NULL`), so the duplication never corrupted a row. What
  // it did do was tie the model's own bookkeeping to whether somebody had
  // loaded the MLB page recently, and run it once per app instance. That is
  // finding P3 §4 — one system implemented twice — and this is where it
  // stopped being true for MLB.
  //
  // `isToday` is kept in the signature: callers pass it meaningfully and
  // the caching TTLs above still differ for today vs a future date.

  return snapshot;
}
