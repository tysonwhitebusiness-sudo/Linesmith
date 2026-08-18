'use client';

import { useEffect, useState } from 'react';
import type { ScheduleEvent } from '@/lib/sports/golf/schedule';

export interface GolfScheduleState {
  events: ScheduleEvent[];
  loading: boolean;
  error: string | null;
  warnings: string[];
}

export function useGolfSchedule(year?: number): GolfScheduleState {
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
        const res = await fetch(`/api/golf/schedule${qs}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Golf schedule request failed (${res.status})`);
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
  }, [year]);

  return { events, loading, error, warnings };
}

export default useGolfSchedule;
