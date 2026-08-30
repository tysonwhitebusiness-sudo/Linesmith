'use client';

import { useEffect, useState } from 'react';
import type { TeamRatingHistory } from '@/lib/sports/shared/teamRatingShapes';

export interface TeamRatingHistoryState {
  history: TeamRatingHistory | null;
  loading: boolean;
}

/**
 * One team's rating trajectory — the client half of Phase 6.14's rating block.
 *
 * Same shape as `useNflTargetMap` and the shot-profile hooks: an
 * `AbortController`, and an `enabled` gate expressed as an undefined argument
 * rather than a branch on the hook call itself (rules of hooks).
 *
 * `sportKey` is the TABLE's vocabulary — callers get it from `eloSportKey`,
 * which returns `null` for tennis and golf, so those two never fetch.
 */
export function useTeamRatingHistory(sportKey?: string | null, teamId?: number): TeamRatingHistoryState {
  const [history, setHistory] = useState<TeamRatingHistory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sportKey || !teamId) {
      setHistory(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setHistory(null);

    void (async () => {
      try {
        const res = await fetch(`/api/team-rating-history?sport=${sportKey}&teamId=${teamId}`, {
          signal: controller.signal,
        });
        if (res.ok) setHistory((await res.json()) as TeamRatingHistory | null);
      } catch {
        // AbortError on unmount or team change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [sportKey, teamId]);

  return { history, loading };
}
