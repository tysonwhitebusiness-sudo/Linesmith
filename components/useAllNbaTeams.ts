'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TeamStandingRow, AllTeamsState } from './useAllTeams';

/**
 * NBA's version of useAllTeams — same TeamStandingRow shape, /api/nba/teams
 * instead. `enabled` (default true, matches every existing caller's
 * behavior) lets a shared multi-sport component like `GameDetail.tsx` call
 * this unconditionally (rules of hooks) while only actually fetching when
 * NBA is the active sport — same "always called, mostly idle" convention
 * every other per-sport hook on that page already follows.
 */
export function useAllNbaTeams(enabled = true): AllTeamsState {
  const [teams, setTeams] = useState<TeamStandingRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!enabled) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch('/api/nba/teams', { signal: controller.signal });
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
  }, [enabled]);

  useEffect(() => {
    load();
    return () => inFlight.current?.abort();
  }, [load]);

  return { teams, loading, error, refresh: load };
}
