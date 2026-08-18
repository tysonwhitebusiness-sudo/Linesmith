'use client';

import { useEffect, useState } from 'react';
import type { LiveGameDetail } from '@/lib/sports/mlb/liveGame';

export interface LiveGameState {
  data: LiveGameDetail | null;
  loading: boolean;
  error: string | null;
}

/**
 * Polls `/api/mlb/game/:id/live` while `enabled` — the Live tab is open on a
 * game that's actually in progress. Matches `useGamePickRecord.ts`'s plain
 * fetch+interval shape rather than `useSnapshot.ts`'s stale-while-revalidate
 * one: there's no cached-paint need for a single game's live poll, and the
 * design spec's "refreshes at each half-inning" cadence is well served by a
 * short flat interval.
 */
export function useLiveGame(
  gamePk: string | number | undefined,
  enabled: boolean,
  /** Pass `null` to fetch once and skip the recurring poll — for a game that's already final, there's nothing left to refresh. (`undefined` keeps the 15s default; JS substitutes defaults for `undefined` but not `null`.) */
  refreshMs?: number | null,
  /** When set, the route also returns `data.player` — that subject's live batting/pitching line. */
  subjectId?: string,
): LiveGameState {
  const [data, setData] = useState<LiveGameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || gamePk == null) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const url = subjectId
          ? `/api/mlb/game/${gamePk}/live?subjectId=${encodeURIComponent(subjectId)}`
          : `/api/mlb/game/${gamePk}/live`;
        const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!cancelled) setError(err instanceof Error ? err.message : 'Fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const effectiveRefreshMs = refreshMs === undefined ? 15_000 : refreshMs;
    const interval = effectiveRefreshMs != null ? setInterval(load, effectiveRefreshMs) : null;
    return () => {
      cancelled = true;
      controller.abort();
      if (interval != null) clearInterval(interval);
    };
  }, [gamePk, enabled, refreshMs, subjectId]);

  return { data, loading, error };
}
