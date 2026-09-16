'use client';

import { useEffect, useState } from 'react';
import type { NbaShotsPayload } from '@/lib/sports/nba/playerShotShapes';

export interface NbaShotsState {
  data: NbaShotsPayload | null;
  loading: boolean;
  /** Human text. A player the feed holds no shots for is not an error: `data` stays null. */
  error: string | null;
}

/**
 * One NBA shooter's attempts (R6.5) — `/api/nba/shots`, keyed by the same
 * athlete id the page already has. An undefined id idles the hook, which runs
 * for every sport (rules of hooks).
 */
export function useNbaShots(shooterId?: string): NbaShotsState {
  const [state, setState] = useState<NbaShotsState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!shooterId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Cleared on a change of player, so one player's shots never sit under another's name.
    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/nba/shots?shooterId=${encodeURIComponent(shooterId)}`, { signal: controller.signal });
        if (res.status === 404 || res.status === 400) setState({ data: null, loading: false, error: null });
        else if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this player's shots." });
        else setState({ data: (await res.json()) as NbaShotsPayload | null, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this player's shots." });
      }
    })();
    return () => controller.abort();
  }, [shooterId]);

  return state;
}
