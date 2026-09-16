'use client';

import { useEffect, useState } from 'react';
import type { GolfResearchPayload } from '@/lib/sports/golf/playerResearchShapes';

export interface GolfResearchState {
  data: GolfResearchPayload | null;
  loading: boolean;
  /** Human text. */
  error: string | null;
}

/**
 * One golfer's rounds, holes and shot summary (R6.6) — `/api/golf/player-research`.
 * The rounds key on the ESPN id the page has; the shots on the name, which
 * comes from the bio. An undefined id idles the hook, which runs for every
 * sport (rules of hooks).
 */
export function useGolfResearch(espnId?: string, name?: string): GolfResearchState {
  const [state, setState] = useState<GolfResearchState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!espnId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Cleared on a change of golfer, so one golfer's rounds never sit under another's name.
    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const query = `espnId=${encodeURIComponent(espnId)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;
        const res = await fetch(`/api/golf/player-research?${query}`, { signal: controller.signal });
        if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this golfer's rounds and shots." });
        else setState({ data: (await res.json()) as GolfResearchPayload, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this golfer's rounds and shots." });
      }
    })();
    return () => controller.abort();
  }, [espnId, name]);

  return state;
}
