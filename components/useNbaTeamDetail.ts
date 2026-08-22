'use client';

import { useEffect, useState } from 'react';
import type { NbaTeamDetailApiResponse } from '@/lib/sports/nba/adapters/teamDetailAdapter';

export interface NbaTeamDetailState {
  data: NbaTeamDetailApiResponse | null;
  loading: boolean;
  error: string | null;
}

export function useNbaTeamDetail(teamId: number | undefined): NbaTeamDetailState {
  const [data, setData] = useState<NbaTeamDetailApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (teamId == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/nba/team/${teamId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.detail ?? json.error);
        else setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  return { data, loading, error };
}
