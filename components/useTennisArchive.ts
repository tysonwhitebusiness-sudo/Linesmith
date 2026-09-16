'use client';

import { useEffect, useState } from 'react';
import type { TennisArchivePayload } from '@/lib/sports/tennis/playerArchiveShapes';

export interface TennisArchiveState {
  data: TennisArchivePayload | null;
  loading: boolean;
  /** Human text. A player the archive does not name is not an error: `data` stays null. */
  error: string | null;
}

/**
 * One player's TennisMyLife matches (R6.4) — `/api/tennis/archive`, resolved by
 * name through the same matcher the snapshot build uses. An undefined name
 * idles the hook, which runs for every sport (rules of hooks).
 */
export function useTennisArchive(tour?: 'atp' | 'wta', name?: string): TennisArchiveState {
  const [state, setState] = useState<TennisArchiveState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!tour || !name) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Cleared on a change of player, so one player's serve never sits under another's name.
    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/tennis/archive?tour=${tour}&name=${encodeURIComponent(name)}`, { signal: controller.signal });
        if (res.status === 404 || res.status === 400) setState({ data: null, loading: false, error: null });
        else if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this player's match archive." });
        else setState({ data: (await res.json()) as TennisArchivePayload | null, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this player's match archive." });
      }
    })();
    return () => controller.abort();
  }, [tour, name]);

  return state;
}
