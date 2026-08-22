'use client';

import { useEffect, useState } from 'react';
import type { CfbTeamDetailApiResponse } from '@/lib/sports/cfb/adapters/teamDetailAdapter';

/** CFB's team-detail fetch — same role useSoccerTeamDetail/useNflTeamDetail play, one bespoke /api/cfb/team/[teamId] endpoint. */
export interface CfbTeamDetailState {
  data: CfbTeamDetailApiResponse | null;
  loading: boolean;
  error: string | null;
}

export function useCfbTeamDetail(teamId: number | undefined): CfbTeamDetailState {
  const [data, setData] = useState<CfbTeamDetailApiResponse | null>(null);
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
    fetch(`/api/cfb/team/${teamId}`)
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
