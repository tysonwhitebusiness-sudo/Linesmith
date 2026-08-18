'use client';

import { useEffect, useState } from 'react';
import type { GolfLinesResult } from '@/lib/odds/golfLines';

export interface GolfLinesState {
  result: GolfLinesResult | null;
  loading: boolean;
  error: string | null;
}

/**
 * Match Winner odds for the current PGA Tour event — parallel to
 * useGameLines.ts. Re-fetches when `refreshKey` changes, tied to the golf
 * snapshot's own refresh cycle rather than polling on its own timer,
 * matching every other odds hook in the app. `enabled` lets AppShell mount
 * this unconditionally (React's rules of hooks) while still never firing a
 * request while the MLB tab is active — same shape as useGameLines' own
 * sport check.
 */
export function useGolfLines(refreshKey?: string | null, enabled = true): GolfLinesState {
  const [result, setResult] = useState<GolfLinesResult | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch('/api/golf/lines', { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Golf lines request failed (${res.status})`);
        setResult(json as GolfLinesResult);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [refreshKey, enabled]);

  return { result, loading, error };
}

export default useGolfLines;
