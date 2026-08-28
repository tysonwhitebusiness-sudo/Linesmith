'use client';

import { useEffect, useState } from 'react';
import type { NhlLiveGameDetail } from '@/lib/sports/nhl/liveGame';

export interface NhlLiveGameState {
  data: NhlLiveGameDetail | null;
  loading: boolean;
}

/** Polls `/api/nhl/game/:id/live` while `enabled` — mirrors `useLiveGame.ts`'s shape exactly (plain fetch+interval, no stale-while-revalidate paint need for a single game). */
export function useNhlLiveGame(gameId: string | undefined, enabled: boolean, refreshMs?: number | null): NhlLiveGameState {
  const [data, setData] = useState<NhlLiveGameDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || gameId == null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(`/api/nhl/game/${gameId}/live`, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as NhlLiveGameDetail;
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
  }, [gameId, enabled, refreshMs]);

  return { data, loading };
}
