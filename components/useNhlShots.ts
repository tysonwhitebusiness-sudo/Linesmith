'use client';

import { useEffect, useState } from 'react';
import type { NhlShotsPayload } from '@/lib/sports/nhl/playerShotMapShapes';

export interface NhlShotsState {
  data: NhlShotsPayload | null;
  loading: boolean;
  /** Human text. A player the feed holds no attempts for is not an error: `data` stays null. */
  error: string | null;
}

/**
 * One NHL player's attempts (R6.5) — `/api/nhl/shots`, keyed by the NHL player
 * id the page already has. The route decides whether that id is a shooter or a
 * goalie by which column finds rows. An undefined id idles the hook, which runs
 * for every sport (rules of hooks).
 */
export function useNhlShots(playerId?: string): NhlShotsState {
  const [state, setState] = useState<NhlShotsState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!playerId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Cleared on a change of player, so one player's shots never sit under another's name.
    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/nhl/shots?playerId=${encodeURIComponent(playerId)}`, { signal: controller.signal });
        if (res.status === 404 || res.status === 400) setState({ data: null, loading: false, error: null });
        else if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this player's shots." });
        else setState({ data: (await res.json()) as NhlShotsPayload | null, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this player's shots." });
      }
    })();
    return () => controller.abort();
  }, [playerId]);

  return state;
}
