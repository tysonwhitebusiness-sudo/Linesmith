'use client';

import { useEffect, useState } from 'react';
import type { SoccerLeague } from '@/lib/core/types';
import type { SoccerTeamDetailApiResponse } from '@/lib/sports/soccer/adapters/teamDetailAdapter';

/** Soccer's team-detail fetch — same role `useNflTeamDetail` plays for NFL: one bespoke `/api/soccer/[league]/team/[teamId]` endpoint, no composed-hooks MLB shape. */
export interface SoccerTeamDetailState {
  data: SoccerTeamDetailApiResponse | null;
  loading: boolean;
  error: string | null;
}

export function useSoccerTeamDetail(teamId: number | undefined, league: SoccerLeague | undefined): SoccerTeamDetailState {
  const [data, setData] = useState<SoccerTeamDetailApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (teamId == null || league == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/soccer/${league}/team/${teamId}`)
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
  }, [teamId, league]);

  return { data, loading, error };
}
