'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface TeamStandingRow {
  teamId: number;
  name: string;
  abbreviation: string;
  logoUrl: string;
  leagueName: string;
  divisionName: string;
  divisionShortName: string;
  wins: number;
  losses: number;
  divisionRank: string;
  gamesBack: string;
  lastTen: { wins: number; losses: number } | null;
  /**
   * Soccer only — points-based tables need draws/points/goal differential,
   * a genuinely different shape from MLB/NFL's win-loss-pct convention
   * (docs/soccer-gameplan-2026-08-22.md §6c/§7.7: "real gap, not a
   * drop-in"). `undefined` for every other sport; `StandingsTables`
   * renders the Pts/GD columns only when a group's rows actually have them.
   */
  draws?: number;
  points?: number;
  goalDifferential?: number;
}

export interface AllTeamsState {
  teams: TeamStandingRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** All 30 teams with current standings — the Teams index page's data source (see /api/mlb/teams). */
export function useAllTeams(): AllTeamsState {
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
        const res = await fetch('/api/mlb/teams', { signal: controller.signal });
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
