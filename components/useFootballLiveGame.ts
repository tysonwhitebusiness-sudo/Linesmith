'use client';

import { useEffect, useState } from 'react';
import type { FootballLiveGameDetail } from '@/lib/sports/multiSport/footballLiveGame';

export interface FootballLiveGameState {
  data: FootballLiveGameDetail | null;
  loading: boolean;
}

/** Polls `/api/{nfl|cfb}/game/:id/live` while `enabled` — mirrors `useLiveGame.ts`'s shape exactly. */
export function useFootballLiveGame(
  sport: 'nfl' | 'cfb',
  eventId: string | undefined,
  enabled: boolean,
  refreshMs?: number | null,
): FootballLiveGameState {
  const [data, setData] = useState<FootballLiveGameDetail | null>(null);
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
        const res = await fetch(`/api/${sport}/game/${eventId}/live`, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as FootballLiveGameDetail;
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
  }, [sport, eventId, enabled, refreshMs]);

  return { data, loading };
}
