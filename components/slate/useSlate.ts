'use client';

import { useEffect, useState } from 'react';
import type { SlateData } from '@/lib/sports/shared/slateShapes';

/**
 * The Slate's own fetch (S1).
 *
 * Deliberately separate from `useSnapshot`: the Games section needs about ten
 * kilobytes and the props board needs twenty-three megabytes, and tying them
 * together is why Scan's body takes 60-90 seconds to settle on a cold load
 * (SL-11). The top of the page draws as soon as this lands; the table fills in
 * underneath when its own payload arrives.
 *
 * `refreshKey` is the caller's — pass the snapshot's `fetchedAt` and the Slate
 * refreshes when the page does, without polling on a second schedule.
 */
export function useSlate(sport: string, league: string | null, date: string | null, refreshKey?: string | null) {
  const [data, setData] = useState<SlateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ sport });
        if (sport === 'soccer' && league) params.set('league', league);
        if (sport === 'tennis' && league) params.set('tour', league);
        if (date) params.set('date', date);
        const res = await fetch(`/api/slate?${params}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          // The Slate is one section of a page, not the page: a failed read
          // hides the section and says why, and the props board below is
          // untouched.
          setError('Could not load the games for this date.');
          setData(null);
          return;
        }
        setData((await res.json()) as SlateData);
        setError(null);
      } catch {
        if (!cancelled) {
          setError('Could not load the games for this date.');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, league, date, refreshKey]);

  return { data, loading, error };
}
