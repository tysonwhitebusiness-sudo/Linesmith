'use client';

import { useEffect, useState } from 'react';
import type { TeamStatcastSeason } from '@/lib/sports/mlb/statcastRollupShapes';

export interface MlbTeamStatcastSeasonPayload {
  teamId: string;
  season: number;
  bat: TeamStatcastSeason | null;
  pit: TeamStatcastSeason | null;
  asOf: string | null;
}

/**
 * One MLB team's stored Statcast rollup, both sides — the compare control's
 * hand splits (R10.4). Idle without a team or season, so it can sit beside the
 * player page's other hooks and cost nothing on every other sport.
 */
export function useMlbTeamStatcastSeason(teamId: string | null, season: number | null) {
  const [data, setData] = useState<MlbTeamStatcastSeasonPayload | null>(null);

  useEffect(() => {
    if (!teamId || !season) {
      setData(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/mlb/team-statcast-season?teamId=${encodeURIComponent(teamId)}&season=${season}`)
      .then(async (res) => (res.ok ? ((await res.json()) as MlbTeamStatcastSeasonPayload) : null))
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        // A missing rollup costs this one card, not the compare.
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, season]);

  return data;
}
