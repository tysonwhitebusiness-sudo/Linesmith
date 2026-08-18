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
import { logSnapshotCandidates, logGameModelPredictions } from '@/lib/odds/props/pickHistoryLog';
import { gradeFinishedGames } from '@/lib/odds/props/grading';
import { gradeFinishedGamePicks } from '@/lib/core/gamePickLock';
import { updateEloForFinishedGame, logPitcherGameScore } from './eloModel';
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
    writeSnapshotCache(fullRawCacheKey(date), JSON.stringify(snapshot.candidates));
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
    writeSnapshotCache(cacheKey, JSON.stringify(snapshot));
  } catch {
    // Non-critical — next request will just rebuild again
  }

  if (isToday) {
    // Log what was surfaced, for Phase C's grading + calibration. Only on a
    // genuine rebuild (not every cache hit) — the candidate set hasn't
    // changed between hits, and INSERT OR IGNORE would just no-op anyway.
    try {
      logSnapshotCandidates('mlb', snapshot);
      logGameModelPredictions('mlb', snapshot);
    } catch (error) {
      console.error('[snapshotRebuild] logSnapshotCandidates failed', error);
    }

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

      gradeFinishedGamePicks(
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

    // Elo rating update — one team-pair update per game that just went
    // Final, so tomorrow's prediction sees today's result immediately
    // instead of waiting for the next backfill. Idempotent (safe to call on
    // every refresh cycle for a game already recorded).
    try {
      const season = Number(today.slice(0, 4));
      const games = ((snapshot.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{
        gamePk: number | string;
        status: 'pre' | 'live' | 'done';
        homeTeamId: number;
        awayTeamId: number;
        firstPitch?: string | null;
        liveScore?: { home: string; away: string };
      }>;
      for (const g of games) {
        if (g.status !== 'done' || !g.liveScore) continue;
        const homeRuns = Number(g.liveScore.home);
        const awayRuns = Number(g.liveScore.away);
        if (!Number.isFinite(homeRuns) || !Number.isFinite(awayRuns) || homeRuns === awayRuns) continue;
        updateEloForFinishedGame(season, Number(g.gamePk), g.firstPitch ?? today, g.homeTeamId, g.awayTeamId, homeRuns, awayRuns);
      }
    } catch (error) {
      console.error('[snapshotRebuild] Elo update failed', error);
    }

    // Starting pitcher Game Score logging — one row per starter once their
    // game is Final, feeding the rolling trend the live pitcher adjustment
    // (Elo item 4) reads. writePitcherGameScore's UNIQUE constraint makes
    // this idempotent across refresh cycles. Runs concurrently rather than
    // blocking the response — each is one getLiveFeed call, and there are
    // at most ~15 of these on a given day.
    try {
      const season = Number(today.slice(0, 4));
      const games = ((snapshot.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{
        gamePk: number | string;
        status: 'pre' | 'live' | 'done';
        homeTeamId: number;
        awayTeamId: number;
        homeStarterId?: number | null;
        awayStarterId?: number | null;
        firstPitch?: string | null;
      }>;
      const jobs: Promise<void>[] = [];
      for (const g of games) {
        if (g.status !== 'done') continue;
        const gameDate = g.firstPitch ?? today;
        if (g.homeStarterId) jobs.push(logPitcherGameScore(Number(g.gamePk), season, g.homeStarterId, g.homeTeamId, gameDate));
        if (g.awayStarterId) jobs.push(logPitcherGameScore(Number(g.gamePk), season, g.awayStarterId, g.awayTeamId, gameDate));
      }
      if (jobs.length > 0) void Promise.allSettled(jobs);
    } catch (error) {
      console.error('[snapshotRebuild] pitcher Game Score logging failed', error);
    }
  }

  return snapshot;
}
