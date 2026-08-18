'use client';

import { useEffect, useState } from 'react';
import type { RecentGameResult } from '@/lib/sports/mlb/statsapi';

export interface TeamFormState {
  results: RecentGameResult[];
  loading: boolean;
  error: string | null;
}

/** A team's season-to-date results, fetched on demand as the active team changes (see /api/mlb/team-form). */
export function useTeamForm(teamId: number | undefined): TeamFormState {
  const [results, setResults] = useState<RecentGameResult[]>([]);
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
        const res = await fetch(`/api/mlb/team-form?teamId=${teamId}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setResults(json.results ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Fetch failed');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [teamId]);

  return { results, loading, error };
}
