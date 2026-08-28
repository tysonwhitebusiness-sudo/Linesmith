'use client';

import { useEffect, useState } from 'react';
import type { NbaLiveGameDetail } from '@/lib/sports/nba/liveGame';

export interface NbaLiveGameState {
  data: NbaLiveGameDetail | null;
  loading: boolean;
}

/** Polls `/api/nba/game/:id/live` while `enabled` — mirrors `useLiveGame.ts`'s shape exactly. */
export function useNbaLiveGame(eventId: string | undefined, enabled: boolean, refreshMs?: number | null): NbaLiveGameState {
  const [data, setData] = useState<NbaLiveGameDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || eventId == null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(`/api/nba/game/${eventId}/live`, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as NbaLiveGameDetail;
        if (!cancelled) setData(json);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
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
  }, [eventId, enabled, refreshMs]);

  return { data, loading };
}
