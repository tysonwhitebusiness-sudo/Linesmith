'use client';

import { useEffect, useState } from 'react';

export interface TeamRosterPlayer {
  id: number;
  fullName: string;
  position: string;
  headshotUrl: string;
  isPitcher: boolean;
  seasonLine: Record<string, number | undefined> | null;
}

export interface TeamRosterData {
  teamId: number;
  teamName: string;
  abbreviation: string;
  logoUrl: string;
  record: { wins: number; losses: number; divisionRank: string } | null;
  roster: TeamRosterPlayer[];
  fetchedAt: string;
}

export interface TeamRosterState {
  data: TeamRosterData | null;
  loading: boolean;
  error: string | null;
}

/** Team identity, record and active roster — independent of whether the team has a game today (see /api/mlb/team/[teamId]). */
export function useTeamRoster(teamId: number | undefined): TeamRosterState {
  const [data, setData] = useState<TeamRosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/mlb/team/${teamId}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData((await res.json()) as TeamRosterData);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Fetch failed');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [teamId]);

  return { data, loading, error };
}
