'use client';

import { useEffect, useState } from 'react';
import type { GolferStrokesGained } from '@/lib/sports/golf/pgatourStats';

export interface GolfFieldStatsResult {
  golfers: GolferStrokesGained[];
  year: number;
}

export interface GolfFieldStatsState {
  result: GolfFieldStatsResult | null;
  loading: boolean;
  error: string | null;
}

/** Season strokes-gained for the whole current field at once — GET /api/golf/field-stats. Fetched once per refresh key rather than per-golfer, for the Tournament Detail page's Advanced Stats section. */
export function useGolfFieldStats(refreshKey: string | null): GolfFieldStatsState {
  const [result, setResult] = useState<GolfFieldStatsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!refreshKey) return;
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch('/api/golf/field-stats', { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Golf field stats request failed (${res.status})`);
        setResult(json as GolfFieldStatsResult);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [refreshKey]);

  return { result, loading, error };
}

export default useGolfFieldStats;
