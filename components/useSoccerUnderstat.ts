'use client';

import { useEffect, useState } from 'react';
import type { SoccerUnderstatPayload } from '@/lib/sports/soccer/playerUnderstatShapes';

export interface SoccerUnderstatState {
  data: SoccerUnderstatPayload | null;
  loading: boolean;
  /** Human text. A player Understat does not cover is not an error: `data` stays null. */
  error: string | null;
}

/**
 * One soccer player's Understat shots and matches (R6.3) — `/api/soccer/understat`,
 * resolved by the player's own name because Understat publishes no id this app
 * can join on.
 *
 * MLS players are left undefined by the caller: Understat covers the big five
 * leagues, and American Soccer Analysis carries no shot coordinates, so there is
 * nothing to ask for. An undefined name idles the hook, which runs for every
 * sport (rules of hooks).
 */
export function useSoccerUnderstat(name?: string): SoccerUnderstatState {
  const [state, setState] = useState<SoccerUnderstatState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!name) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Cleared on a change of player, so one player's shots never sit under another's name.
    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/soccer/understat?name=${encodeURIComponent(name)}`, { signal: controller.signal });
        if (res.status === 404 || res.status === 400) setState({ data: null, loading: false, error: null });
        else if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this player's shot data." });
        else setState({ data: (await res.json()) as SoccerUnderstatPayload | null, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this player's shot data." });
      }
    })();
    return () => controller.abort();
  }, [name]);

  return state;
}
