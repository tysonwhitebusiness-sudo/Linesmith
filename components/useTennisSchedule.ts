'use client';

import { useEffect, useState } from 'react';
import type { TennisTour } from '@/lib/core/types';
import type { ScheduleEvent } from '@/lib/sports/tennis/schedule';

export interface TennisScheduleState {
  events: ScheduleEvent[];
  loading: boolean;
  error: string | null;
  warnings: string[];
}

export function useTennisSchedule(tour: TennisTour, year?: number): TennisScheduleState {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const qs = year ? `?year=${year}` : '';
        const res = await fetch(`/api/tennis/${tour}/schedule${qs}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Tennis schedule request failed (${res.status})`);
        setEvents(json.events ?? []);
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
  }, [tour, year]);

  return { events, loading, error, warnings };
}

export default useTennisSchedule;
