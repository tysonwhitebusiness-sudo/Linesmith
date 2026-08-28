'use client';

import { useEffect, useState } from 'react';
import type { TennisTour } from '@/lib/core/types';
import type { TournamentDraw } from '@/lib/sports/tennis/schedule';

export interface TennisDrawState {
  draw: TournamentDraw | null;
  loading: boolean;
  error: string | null;
  warnings: string[];
}

/** `event` is null when nothing's selected yet — the hook just stays idle rather than firing a request with empty params. */
export function useTennisDraw(tour: TennisTour, event: { id: string; startDate: string; endDate: string } | null): TennisDrawState {
  const [draw, setDraw] = useState<TournamentDraw | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!event) {
      setDraw(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const qs = new URLSearchParams({ eventId: event.id, start: event.startDate, end: event.endDate });
        const res = await fetch(`/api/tennis/${tour}/draw?${qs}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Tennis draw request failed (${res.status})`);
        setDraw(json.draw ?? null);
        setWarnings(json.warnings ?? []);
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

  return { draw, loading, error, warnings };
}

export default useTennisDraw;
