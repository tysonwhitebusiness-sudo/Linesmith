'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TeamStandingRow, AllTeamsState } from './useAllTeams';

export function useAllNhlTeams(): AllTeamsState {
  const [teams, setTeams] = useState<TeamStandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch('/api/nhl/teams', { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setTeams(json.teams ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Fetch failed');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    load();
    return () => inFlight.current?.abort();
  }, [load]);

  return { teams, loading, error, refresh: load };
}
