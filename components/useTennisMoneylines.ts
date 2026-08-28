'use client';

import { useEffect, useState } from 'react';
import type { TennisTour } from '@/lib/core/types';
import type { TennisMoneyline } from '@/lib/odds/tennisLines';

export interface TennisMoneylinesState {
  lines: TennisMoneyline[];
  loading: boolean;
  error: string | null;
}

export function useTennisMoneylines(tour: TennisTour, event: { id: string; startDate: string; endDate: string } | null): TennisMoneylinesState {
  const [lines, setLines] = useState<TennisMoneyline[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!event) {
      setLines([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const qs = new URLSearchParams({ eventId: event.id, start: event.startDate, end: event.endDate });
        const res = await fetch(`/api/tennis/${tour}/moneylines?${qs}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Tennis moneylines request failed (${res.status})`);
        setLines(json.lines ?? []);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [tour, event?.id, event?.startDate, event?.endDate]);

  return { lines, loading, error };
}

export default useTennisMoneylines;
