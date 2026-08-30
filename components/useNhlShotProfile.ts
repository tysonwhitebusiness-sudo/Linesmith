'use client';

import { useEffect, useState } from 'react';
import type { NhlShotProfile } from '@/lib/sports/nhl/shotProfileShapes';

export interface NhlShotProfileState {
  profile: NhlShotProfile | null;
  loading: boolean;
}

/**
 * One NHL shooter's shot map — the client half of Phase 6.7.
 *
 * Same shape as `useMlbPitchProfile`: an `AbortController`, and an `enabled`
 * gate expressed as an undefined argument rather than a branch on the hook call
 * itself, since the rules of hooks mean this runs for every sport and simply
 * does not fetch for the seven that have no shots.
 */
export function useNhlShotProfile(shooterId?: number, season?: string): NhlShotProfileState {
  const [profile, setProfile] = useState<NhlShotProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (shooterId == null || !season) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    // Cleared on key change: leaving the previous player's map on screen under
    // the next player's name is how a page shows one skater's shots as another's.
    setProfile(null);

    void (async () => {
      try {
        const res = await fetch(`/api/nhl/shot-profile?shooterId=${shooterId}&season=${season}`, {
          signal: controller.signal,
        });
        if (res.ok) setProfile((await res.json()) as NhlShotProfile);
      } catch {
        // AbortError on unmount or subject change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [shooterId, season]);

  return { profile, loading };
}
