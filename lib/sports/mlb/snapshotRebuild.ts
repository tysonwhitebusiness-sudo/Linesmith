/**
 * The MLB snapshot rebuild, pulled out of `/api/mlb`'s route handler so it
 * has one home both `GET` and `instrumentation.ts`'s proactive scheduler can
 * call directly — a Next.js `route.ts` file can only export the handful of
 * names the framework recognizes (GET, POST, dynamic, ...), not arbitrary
 * helpers.
 */

import { getMlbSnapshot } from './adapter';
import { easternDate } from './statsapi';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { dedupeHistoryForList } from './historyTrim';
import { fullRawCacheKey } from './playerGamelogCache';
import { gradeFinishedGames } from '@/lib/odds/props/grading';
import { gradeFinishedGamePicks } from '@/lib/core/gamePickLock';
import type { SportSnapshot } from '@/lib/core/types';

export const TODAY_CACHE_KEY = 'mlb:snapshot';
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Future dates move slowly (lineups/odds firm up, not re-simulated), so they're worth caching longer than today's live slate. */
export const FUTURE_DATE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Everything a real rebuild does: fetch from the MLB API, trim/cache the
 * result, and — for today only — run the grading/logging side effects that
 * are supposed to happen exactly once per rebuild (not once per request).
 * Callers decide whether to `await` this inline (nothing cached yet) or fire
 * it in the background (something stale to serve in the meantime) — the
 * function itself doesn't know or care which.
 */
export async function rebuildMlbSnapshot(date: string, cacheKey: string, isToday: boolean): Promise<SportSnapshot> {
  const today = easternDate();
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

  if (isToday) {
    // logSnapshotCandidates + logGameModelPredictions ran here, writing
    // pick_history on this file's own 4-minute per-process timer. Both are
    // owned by the Python worker now — computeMlbPropPredictionsJob (5 min)
    // and computeMlbGameModelJob (15 min) respectively. The second was
    // ported in task 2.7b; the first had already been ported and was
    // running in parallel with this call, which is the duplication finding
    // P3 §4 is about.
    //
    // Both wrote through log_surfaced/logSurfaced's first-surfaced-wins
    // ON CONFLICT DO NOTHING, so the two writers could never corrupt each
    // other — but which one won was decided by whichever tick landed
    // first, which is not a property anyone chose.

    // Grade whatever's gone final since the last rebuild. Piggybacked on
    // this same rebuild cadence rather than a separate cron — cheap when
    // there's nothing ungraded, which is the common case.
    try {
      const summary = await gradeFinishedGames();
      if (summary.rowsGraded > 0) console.log('[snapshotRebuild] graded', summary);
    } catch (error) {
      console.error('[snapshotRebuild] gradeFinishedGames failed', error);
    }

    // Linesmith Pick lock system — grading only. Capturing the picks
    // themselves (both moneyline and total) now happens in /api/odds/lines,
    // since that's the only route with market odds available to blend
    // against — grading just needs the final score, which this route
    // already has natively from the schedule fetch.
    try {
      const games = ((snapshot.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{
        gamePk: number | string;
        status: 'pre' | 'live' | 'done';
        homeTeamId: number;
        awayTeamId: number;
        firstPitch?: string | null;
        liveScore?: { home: string; away: string };
      }>;

      await gradeFinishedGamePicks(
        'mlb',
        games.map((g) => {
          const home = g.liveScore ? Number(g.liveScore.home) : null;
          const away = g.liveScore ? Number(g.liveScore.away) : null;
          return {
            gameId: String(g.gamePk),
            isFinal: g.status === 'done',
            homeScore: home != null && Number.isFinite(home) ? home : null,
            awayScore: away != null && Number.isFinite(away) ? away : null,
          };
        }),
      );
    } catch (error) {
      console.error('[snapshotRebuild] gamePickLock (moneyline) failed', error);
    }

    // Elo rating updates and starting-pitcher Game Score logging used to
    // happen here — moved to the Python worker's maintainMlbEloJob (Phase
    // J of docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md,
    // 2026-08-22). That job reads the same team_elo_history/
    // pitcher_game_score_history tables via the same idempotent UNIQUE-
    // constraint writes this code used, so removing this duplicate path
    // doesn't change what either table contains — it just stops writing it
    // twice. See health_check.py's staleness check on that job for the
    // ongoing verification this removal is safe.
  }

  return snapshot;
}
