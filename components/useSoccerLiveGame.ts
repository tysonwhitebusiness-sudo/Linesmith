'use client';

import { useEffect, useState } from 'react';
import type { SoccerLiveGameDetail } from '@/lib/sports/soccer/liveGame';

export interface SoccerLiveGameState {
  data: SoccerLiveGameDetail | null;
  loading: boolean;
}

/** Polls `/api/soccer/:league/game/:id/live` while `enabled` — mirrors `useLiveGame.ts`'s shape exactly. */
export function useSoccerLiveGame(league: string | undefined, eventId: string | undefined, enabled: boolean, refreshMs?: number | null): SoccerLiveGameState {
  const [data, setData] = useState<SoccerLiveGameDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || eventId == null || league == null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(`/api/soccer/${league}/game/${eventId}/live`, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as SoccerLiveGameDetail;
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
  }, [league, eventId, enabled, refreshMs]);

  return { data, loading };
}
