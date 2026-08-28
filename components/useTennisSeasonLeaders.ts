'use client';

import { useEffect, useState } from 'react';
import type { TennisTour } from '@/lib/core/types';
import type { LeaderStat, SeasonLeaderRow } from '@/lib/sports/tennis/seasonLeaders';

export interface TennisSeasonLeadersState {
  leaders: SeasonLeaderRow[];
  loading: boolean;
  error: string | null;
}

export function useTennisSeasonLeaders(tour: TennisTour, stat: LeaderStat): TennisSeasonLeadersState {
  const [leaders, setLeaders] = useState<SeasonLeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/tennis/${tour}/season-leaders?stat=${stat}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Tennis season leaders request failed (${res.status})`);
        setLeaders(json.leaders ?? []);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [tour, stat]);

  return { leaders, loading, error };
}

export default useTennisSeasonLeaders;
