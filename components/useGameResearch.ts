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
 * Dev-only replay of a finished MLB game (`?replay=20260926_002926&speed=10`):
 * the clock starts at `from` and runs at `speed` times real time, so each poll
 * asks for the feed a little further on. Polls every 5 s while it runs faster
 * than real time.
 */
export interface GameReplay {
  from: string;
  speed: number;
}

const timecode = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
const timecodeMs = (t: string) => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(9, 11), +t.slice(11, 13), +t.slice(13, 15));

/**
 * A game page's payload (R8) — `/api/game-research`. An undefined sport or game
 * idles the hook. While the game is live it refetches every 15 seconds, keeping
 * the last payload on screen between fetches, so a final game never shows a
 * live loading state (F-B10) and a live one never blanks.
 */
export function useGameResearch<P extends GameResearchPayload = GameResearchPayload>(sport?: string, gameId?: string, replay?: GameReplay | null): GameResearchState<P> {
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
    const startedAt = Date.now();
    const replayAt = () => (replay ? `&replay=${timecode(new Date(timecodeMs(replay.from) + (Date.now() - startedAt) * replay.speed))}` : '');
    const load = async () => {
      try {
        const res = await fetch(`/api/game-research?sport=${encodeURIComponent(sport)}&gameId=${encodeURIComponent(gameId)}${replayAt()}`, { signal: controller.signal });
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
    }, replay && replay.speed > 1 ? 5_000 : LIVE_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [sport, gameId, attempt, replay?.from, replay?.speed]);

  return { ...state, reload };
}
