'use client';

import { useEffect, useState } from 'react';
import type { AdvancedStat, GolferStrokesGained } from '@/lib/sports/golf/pgatourStats';
import type { PlayerSeasonLog } from '@/lib/sports/golf/playerSeason';

export interface GolfPlayerStatsResult {
  strokesGained: GolferStrokesGained | null;
  seasonLog: PlayerSeasonLog;
  advancedStats: AdvancedStat[];
  advancedWarnings: string[];
}

export interface GolfPlayerStatsState {
  result: GolfPlayerStatsResult | null;
  loading: boolean;
  error: string | null;
}

/** Season strokes-gained + tournament log for one golfer — GET /api/golf/player/[playerId]. */
export function useGolfPlayerStats(espnId: string | null): GolfPlayerStatsState {
  const [result, setResult] = useState<GolfPlayerStatsResult | null>(null);
  const [loading, setLoading] = useState(!!espnId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!espnId) {
      setResult(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/golf/player/${encodeURIComponent(espnId)}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Golf player stats request failed (${res.status})`);
        setResult(json as GolfPlayerStatsResult);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [espnId]);

  return { result, loading, error };
}

export default useGolfPlayerStats;
