'use client';

import { useEffect, useState } from 'react';
import type { PlayerIndexPayload } from '@/lib/sports/shared/playerIndexServer';

/**
 * The sport's own player list — R10.5. Independent of the day's slate, so the
 * Players tab has something to show and something to search on a day with no
 * games. Idle for golf, which has no per-game history table.
 */
export function usePlayerIndex(sport: string | null, league?: string | null) {
  const [data, setData] = useState<PlayerIndexPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sport || sport === 'golf') {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ sport });
    if (league) params.set('league', league);
    fetch(`/api/player-index?${params.toString()}`)
      .then(async (res) => (res.ok ? ((await res.json()) as PlayerIndexPayload) : null))
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        // The slate list is still there; this only adds to it.
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sport, league]);

  return { data, loading };
}
