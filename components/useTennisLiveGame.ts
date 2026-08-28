'use client';

import { useEffect, useState } from 'react';
import type { TennisLiveGameDetail } from '@/lib/sports/tennis/liveGame';

export interface TennisLiveGameState {
  data: TennisLiveGameDetail | null;
  loading: boolean;
}

/** Polls `/api/tennis/:tour/game/:id/live` while `enabled` — mirrors `useLiveGame.ts`'s shape exactly. */
export function useTennisLiveGame(tour: string | undefined, matchId: string | undefined, enabled: boolean, refreshMs?: number | null): TennisLiveGameState {
  const [data, setData] = useState<TennisLiveGameDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || matchId == null || tour == null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(`/api/tennis/${tour}/game/${matchId}/live`, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TennisLiveGameDetail;
        if (!cancelled) setData(json);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const effectiveRefreshMs = refreshMs === undefined ? 20_000 : refreshMs;
    const interval = effectiveRefreshMs != null ? setInterval(load, effectiveRefreshMs) : null;
    return () => {
      cancelled = true;
      controller.abort();
      if (interval != null) clearInterval(interval);
    };
  }, [tour, matchId, enabled, refreshMs]);

  return { data, loading };
}
