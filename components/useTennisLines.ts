'use client';

import { useEffect, useState } from 'react';
import type { TennisTour } from '@/lib/core/types';
import type { TennisLinesResult } from '@/lib/odds/tennisLines';

export interface TennisLinesState {
  result: TennisLinesResult | null;
  loading: boolean;
  error: string | null;
}

/** Tournament Winner futures for one real tournament — parallel to useGolfLines.ts. `tournamentName` null means nothing selected yet. */
export function useTennisLines(tour: TennisTour, tournamentName: string | null): TennisLinesState {
  const [result, setResult] = useState<TennisLinesResult | null>(null);
  const [loading, setLoading] = useState(Boolean(tournamentName));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentName) {
      setResult(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const qs = new URLSearchParams({ tournamentName });
        const res = await fetch(`/api/tennis/${tour}/lines?${qs}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Tennis lines request failed (${res.status})`);
        setResult(json as TennisLinesResult);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [tour, tournamentName]);

  return { result, loading, error };
}

export default useTennisLines;
