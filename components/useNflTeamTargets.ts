'use client';

import { useEffect, useState } from 'react';
import type { NflTeamTargets } from '@/lib/sports/nfl/teamTargetShapes';

/**
 * One NFL team's target maps for the compare control — R10.4. The route
 * (`/api/nfl/team-targets`) already names this caller in its own header.
 * Idle without a team or a season.
 */
export function useNflTeamTargets(season: number | null, teamId: string | null) {
  const [data, setData] = useState<NflTeamTargets | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!season || !teamId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/nfl/team-targets?season=${season}&teamId=${encodeURIComponent(teamId)}`)
      .then(async (res) => (res.ok ? ((await res.json()) as NflTeamTargets) : null))
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, teamId]);

  return { data, loading };
}
