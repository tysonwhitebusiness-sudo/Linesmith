'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HistorySport, PlayerBio, PlayerHistory } from '@/lib/sports/shared/playerResearchShapes';

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  /** Human text, never the API's own message. */
  error: string | null;
  reload: () => void;
}

/**
 * One JSON GET with loading, a human error and a retry — the player page's
 * sections each load on their own (plan §1 row 2), so each gets one of these.
 * `url` undefined idles: the hook runs for every sport and fetches for the
 * ones that have the data (rules of hooks).
 */
function useJson<T>(url: string | undefined, failure: string): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // Cleared on a new subject, so one player's numbers never sit under the next player's name.
    setData(null);
    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.status === 404) {
          setData(null);
        } else if (!res.ok) {
          setError(failure);
        } else {
          setData((await res.json()) as T);
        }
      } catch {
        if (!controller.signal.aborted) setError(failure);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [url, failure, nonce]);

  return { data, loading, error, reload };
}

/** A player's identity from the league's athlete endpoint (`/api/player-bio`). */
export function usePlayerBio(sport: HistorySport | 'golf' | null, athleteId: string | null): FetchState<PlayerBio> {
  const ok = sport && athleteId && /^\d+$/.test(athleteId);
  return useJson<PlayerBio>(ok ? `/api/player-bio?sport=${sport}&athleteId=${athleteId}` : undefined, "Couldn't load this player's profile.");
}

/** Every game held for a player, all seasons (`/api/player-history`). */
export function usePlayerHistory(sport: HistorySport | null, athleteId: string | null): FetchState<PlayerHistory> {
  const ok = sport && athleteId && /^\d+$/.test(athleteId);
  return useJson<PlayerHistory>(ok ? `/api/player-history?sport=${sport}&athleteId=${athleteId}` : undefined, "Couldn't load this player's game history.");
}
