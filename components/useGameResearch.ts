'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameResearchPayload } from '@/lib/sports/shared/gameResearchShapes';

export interface GameResearchState<P extends GameResearchPayload = GameResearchPayload> {
  data: P | null;
  loading: boolean;
  /** Human text. */
  error: string | null;
  reload: () => void;
}

/** How often a live game is refetched. The route caches a live game for 15 s and serves the last build at once. */
const LIVE_POLL_MS = 15_000;

/**
 * A game page's payload (R8) — `/api/game-research`. An undefined sport or game
 * idles the hook. While the game is live it refetches every 15 seconds, keeping
 * the last payload on screen between fetches, so a final game never shows a
 * live loading state (F-B10) and a live one never blanks.
 */
export function useGameResearch<P extends GameResearchPayload = GameResearchPayload>(sport?: string, gameId?: string): GameResearchState<P> {
  const [state, setState] = useState<Omit<GameResearchState<P>, 'reload'>>({ data: null, loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const live = state.data?.state === 'live';
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    if (!sport || !gameId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ data: s.data?.gameId === gameId ? s.data : null, loading: true, error: null }));
    const load = async () => {
      try {
        const res = await fetch(`/api/game-research?sport=${encodeURIComponent(sport)}&gameId=${encodeURIComponent(gameId)}`, { signal: controller.signal });
        if (res.status === 404) setState({ data: null, loading: false, error: 'This game was not found.' });
        else if (!res.ok) setState((s) => ({ data: s.data, loading: false, error: s.data ? null : "Couldn't load this game." }));
        else setState({ data: (await res.json()) as P, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState((s) => ({ data: s.data, loading: false, error: s.data ? null : "Couldn't load this game." }));
      }
    };
    void load();
    const timer = setInterval(() => {
      if (liveRef.current && document.visibilityState === 'visible') void load();
    }, LIVE_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [sport, gameId, attempt]);

  return { ...state, reload };
}
