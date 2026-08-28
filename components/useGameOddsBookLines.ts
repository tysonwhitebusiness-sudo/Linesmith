'use client';

import { useEffect, useState } from 'react';
import type { UnifiedGameLine } from '@/lib/odds/types';

export interface GameOddsBookLinesState {
  line: UnifiedGameLine | null;
  /** True until the first response lands, so the page can show a skeleton
   * instead of flashing "no line yet" during the real fetch. */
  loading: boolean;
  error: string | null;
}

/**
 * The real per-game bookmaker grid, for any sport — reads
 * game_odds_book_lines via /api/odds/game-line (odds-architecture rebuild
 * Phase 6). Replaces GameDetail.tsx's old per-sport `mlbGameLine`/
 * `nflGameLine` derivation (each pulling from a different ad hoc live-fetch
 * mechanism, and only ever populated for those two sports) with one
 * uniform read that works the same way for every sport.
 */
export function useGameOddsBookLines(sport: string | undefined, gameId: string | undefined): GameOddsBookLinesState {
  const [line, setLine] = useState<UnifiedGameLine | null>(null);
  const [loading, setLoading] = useState(Boolean(sport && gameId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sport || !gameId) {
      setLine(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/odds/game-line?sport=${sport}&gameId=${encodeURIComponent(gameId)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Game-line request failed (${res.status})`);
        setLine((json.line ?? null) as UnifiedGameLine | null);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [sport, gameId]);

  return { line, loading, error };
}

export default useGameOddsBookLines;
