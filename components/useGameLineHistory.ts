'use client';

import { useEffect, useState } from 'react';
import type { GameLineHistoryResult } from '@/lib/odds/gameLineHistory';

export interface GameLineHistoryState {
  data: GameLineHistoryResult | null;
  loading: boolean;
}

/**
 * Price movement for one game market — the client half of Phase 6.22.
 *
 * Same shape as `useLineHistory`: an `AbortController`, and an `enabled` gate
 * expressed as an undefined argument rather than a branch on the call, since
 * the rules of hooks mean this runs on every render for every sport and simply
 * does not fetch when it has nothing to ask for.
 *
 * `loading` IS SEEDED FROM THE ARGUMENTS, not `false`. A hook that reports
 * "not loading, no data" on the render before its own effect runs hands its
 * caller the exact pair that means "there is genuinely nothing here" — which
 * is how the Players tab spent every fetch telling readers a player had no
 * tracked props while it was in the middle of loading them. Fixed there on
 * 2026-08-31; not repeated here.
 */
export function useGameLineHistory(
  eventId: string | undefined,
  market: 'moneyline' | 'total' | 'spread' | undefined,
  side: string | undefined,
  hours = 48,
): GameLineHistoryState {
  const [data, setData] = useState<GameLineHistoryResult | null>(null);
  const [loading, setLoading] = useState(Boolean(eventId && market));

  useEffect(() => {
    if (!eventId || !market) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    // Cleared on every key change: leaving the previous market's movement on
    // screen under the next market's heading is how a page shows one bet's
    // numbers labelled as another's.
    setData(null);

    const qs = new URLSearchParams({ eventId, market, hours: String(hours) });
    if (side) qs.set('side', side);

    void (async () => {
      try {
        const res = await fetch(`/api/odds/game-line-history?${qs.toString()}`, { signal: controller.signal });
        if (res.ok) setData((await res.json()) as GameLineHistoryResult);
      } catch {
        // AbortError on unmount or key change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [eventId, market, side, hours]);

  return { data, loading };
}
