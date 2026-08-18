'use client';

import { useEffect, useState } from 'react';

export interface TeamBatterRank {
  personId: number;
  overallRank: number | null;
  poolSize: number;
  position: string;
  positionRank: number | null;
  positionPoolSize: number;
  composite: number | null;
}

export interface TeamBatterRanksState {
  byPersonId: Map<number, TeamBatterRank>;
  loading: boolean;
}

/**
 * Whole-roster batter Statcast ranks for one Team Detail page — every
 * qualified batter on the team, not just today's lineup (see the API
 * route's own comment). Split out for the same reason `useTeamStatcast`'s
 * call is: Scan never shows this, so it has no business costing every scan
 * refresh.
 */
export function useTeamBatterRanks(teamId?: number): TeamBatterRanksState {
  const [byPersonId, setByPersonId] = useState<Map<number, TeamBatterRank>>(new Map());
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
        const res = await fetch(`/api/mlb/team-batter-ranks?teamId=${teamId}`, { signal: controller.signal });
        if (res.ok) {
          const json = await res.json();
          const batters = (json.batters ?? []) as TeamBatterRank[];
          setByPersonId(new Map(batters.map((b) => [b.personId, b])));
        }
      } catch {
        // AbortError on unmount/team change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [teamId]);

  return { byPersonId, loading };
}
