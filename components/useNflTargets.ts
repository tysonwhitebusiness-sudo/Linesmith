'use client';

import { useEffect, useState } from 'react';
import type { NflTargetsPayload } from '@/lib/sports/nfl/targetShapes';

export interface NflTargetsState {
  data: NflTargetsPayload | null;
  loading: boolean;
  /** Human text. A player with no rows is not an error: `data` comes back empty. */
  error: string | null;
}

/**
 * One NFL player's located passes (R6.2) — `/api/nfl/targets`, keyed by the
 * page's own ESPN athlete id and the role his position implies.
 *
 * Every season held comes back in one response (three seasons, a few hundred
 * rows for a busy receiver), so the section's season control re-reads the same
 * payload instead of firing a fetch per season. An undefined id idles — the
 * hook runs for every sport (rules of hooks).
 */
export function useNflTargets(athleteId?: string, role?: 'receiver' | 'passer'): NflTargetsState {
  const [state, setState] = useState<NflTargetsState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!athleteId || !role) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Cleared on a key change, so one player's passes never sit under another's name.
    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/nfl/targets?athleteId=${encodeURIComponent(athleteId)}&role=${role}`, { signal: controller.signal });
        if (res.status === 404) setState({ data: null, loading: false, error: null });
        else if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this player's play-by-play." });
        else setState({ data: (await res.json()) as NflTargetsPayload | null, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this player's play-by-play." });
      }
    })();
    return () => controller.abort();
  }, [athleteId, role]);

  return state;
}
