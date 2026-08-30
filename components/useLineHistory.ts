'use client';

import { useEffect, useState } from 'react';
import type { LineHistoryResult } from '@/lib/odds/props/lineHistory';

export interface LineHistoryState {
  data: LineHistoryResult | null;
  loading: boolean;
}

/**
 * Price movement for one prop — the client half of Phase 6.16.
 *
 * Same shape as `useTeamStatcast` and `useMlbPitchProfile`: an `AbortController`
 * and an `enabled` gate expressed as an undefined argument rather than a branch
 * on the hook call itself, since the rules of hooks mean this runs on every
 * render for every sport and simply does not fetch when it has nothing to ask
 * for.
 *
 * NOT part of the slate snapshot, deliberately — the snapshot is built for
 * Scan, which shows no charts, and a per-prop history is the largest payload on
 * the page. Same reasoning as the two hooks above.
 */
export function useLineHistory(
  gameId: string | undefined,
  subjectId: string | undefined,
  marketKey: string | undefined,
  side: 'over' | 'under' = 'over',
  hours = 48,
): LineHistoryState {
  const [data, setData] = useState<LineHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!gameId || !subjectId || !marketKey) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    // Cleared on every key change: leaving the previous prop's movement on
    // screen under the next prop's heading is how a page shows one bet's
    // numbers labelled as another's.
    setData(null);

    void (async () => {
      try {
        const params = new URLSearchParams({ gameId, subjectId, marketKey, side, hours: String(hours) });
        const res = await fetch(`/api/props/line-history?${params}`, { signal: controller.signal });
        if (res.ok) setData((await res.json()) as LineHistoryResult);
      } catch {
        // AbortError on unmount or prop change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [gameId, subjectId, marketKey, side, hours]);

  return { data, loading };
}
