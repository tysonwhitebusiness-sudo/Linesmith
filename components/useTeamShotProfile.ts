'use client';

import { useEffect, useState } from 'react';
import type { TeamShotProfile } from '@/lib/sports/shared/teamProductionShapes';

/**
 * One team's shot view for the compare control — R10.4. The route
 * (`/api/team-shot-profile`) was written for R7's team cards and says in its own
 * header that it also feeds "the player's zones vs zones allowed to the
 * position"; this is that caller.
 *
 * Idle without a team, so it can be called unconditionally beside the player
 * page's other hooks.
 */
export function useTeamShotProfile(sport: 'nba' | 'nhl' | null, season: number | null, teamId: string | null) {
  const [data, setData] = useState<TeamShotProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sport || !season || !teamId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/team-shot-profile?sport=${sport}&season=${season}&teamId=${encodeURIComponent(teamId)}`)
      .then(async (res) => (res.ok ? ((await res.json()) as TeamShotProfile) : null))
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        // A missing profile costs the zone card, not the compare.
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sport, season, teamId]);

  return { data, loading };
}
