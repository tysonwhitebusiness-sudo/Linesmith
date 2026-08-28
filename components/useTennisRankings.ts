'use client';

import { useEffect, useState } from 'react';
import type { TennisTour } from '@/lib/core/types';
import type { RankingRow } from '@/lib/sports/tennis/rankings';

export interface TennisRankingsState {
  rankings: RankingRow[];
  loading: boolean;
  error: string | null;
}

export function useTennisRankings(tour: TennisTour): TennisRankingsState {
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/tennis/${tour}/rankings`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Tennis rankings request failed (${res.status})`);
        setRankings(json.rankings ?? []);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [tour]);

  return { rankings, loading, error };
}

export default useTennisRankings;
