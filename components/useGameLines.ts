'use client';

import { useEffect, useState } from 'react';
import type { Sport } from '@/lib/core/types';
import type { UnifiedLinesResult } from '@/lib/odds/types';

export interface GameLinesState {
  result: UnifiedLinesResult | null;
  /** True until the first response lands, so cards can show odds skeletons. */
  loading: boolean;
  error: string | null;
}

/**
 * Game lines for the current slate.
 *
 * Deliberately has no timer of its own: it re-fetches when `refreshKey`
 * changes, which the caller ties to the snapshot's own 3-minute cycle. A
 * second poll would spend Odds API credits on a schedule nobody chose.
 *
 * Every sport except golf has a game-line feed (odds-architecture rebuild
 * Phase 6 — /api/odds/lines reads game_odds_book_lines directly for every
 * sport now, not just MLB/NFL's old special-cased paths). Golf has no
 * game-line concept (no team-vs-team line to build) and keeps its own
 * separate tournament-lines pipeline (useTournamentLines), so it still
 * returns immediately with nothing here.
 */
export function useGameLines(sport: Sport, refreshKey?: string | null): GameLinesState {
  const hasLines = sport !== 'golf';
  const [result, setResult] = useState<UnifiedLinesResult | null>(null);
  const [loading, setLoading] = useState(hasLines);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasLines) {
      setResult(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/odds/lines?sport=${sport}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Odds request failed (${res.status})`);
        setResult(json as UnifiedLinesResult);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [sport, refreshKey]);

  return { result, loading, error };
}

export default useGameLines;
