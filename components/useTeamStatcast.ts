'use client';

import { useEffect, useState } from 'react';

/** Same tile shape `OpposingStarterStat` (PlayerDetail.tsx) already renders — value + rank/poolSize. */
export interface TeamStatcastTile {
  key: string;
  label: string;
  value: number;
  decimals: number;
  rank: number;
  poolSize: number;
}

export interface TeamStatcastState {
  hitting: TeamStatcastTile[];
  pitching: TeamStatcastTile[];
  loading: boolean;
}

/**
 * Team-level Statcast rollup for one Team Detail page — split out of the
 * slate snapshot for the same reason `useBullpen`'s call is: Scan never
 * shows this, so it has no business costing every scan refresh.
 */
export function useTeamStatcast(teamId?: number): TeamStatcastState {
  const [hitting, setHitting] = useState<TeamStatcastTile[]>([]);
  const [pitching, setPitching] = useState<TeamStatcastTile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/mlb/team-statcast?teamId=${teamId}`, { signal: controller.signal });
        if (res.ok) {
          const json = await res.json();
          setHitting(json.hitting ?? []);
          setPitching(json.pitching ?? []);
        }
      } catch {
        // AbortError on unmount/team change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [teamId]);

  return { hitting, pitching, loading };
}
