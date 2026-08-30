'use client';

import { useEffect, useState } from 'react';
import type { GolfShotRow } from '@/lib/sports/golf/shotProfileShapes';

export interface GolfShotProfileState {
  shots: GolfShotRow[];
  loading: boolean;
}

/**
 * One golfer's shot-by-shot rows — the client half of Phase 6.13's golf roles.
 *
 * Same shape as `useNflTargetMap` and the shot-profile hooks: an
 * `AbortController`, and an `enabled` gate expressed as an undefined argument
 * rather than a branch on the hook call itself (rules of hooks).
 */
export function useGolfShotProfile(playerName?: string): GolfShotProfileState {
  const [shots, setShots] = useState<GolfShotRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!playerName) {
      setShots([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setShots([]);

    void (async () => {
      try {
        const res = await fetch(`/api/golf/shot-profile?name=${encodeURIComponent(playerName)}`, { signal: controller.signal });
        if (res.ok) {
          const body = (await res.json()) as { shots?: GolfShotRow[] };
          setShots(Array.isArray(body?.shots) ? body.shots : []);
        }
      } catch {
        // AbortError on unmount or subject change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [playerName]);

  return { shots, loading };
}
