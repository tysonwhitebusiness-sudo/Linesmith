'use client';

import { useEffect, useState } from 'react';
import type { NflTargetMap } from '@/lib/sports/nfl/targetMapShapes';

export interface NflTargetMapState {
  map: NflTargetMap | null;
  loading: boolean;
}

/**
 * One NFL receiver's target map — the client half of Phase 6.8.
 *
 * Same shape as `useMlbPitchProfile` and the two shot-profile hooks: an
 * `AbortController`, and an `enabled` gate expressed as an undefined argument
 * rather than a branch on the hook call itself.
 */
export function useNflTargetMap(receiverId?: string, season?: number): NflTargetMapState {
  const [map, setMap] = useState<NflTargetMap | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!receiverId || season == null) {
      setMap(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setMap(null);

    void (async () => {
      try {
        const res = await fetch(`/api/nfl/target-map?receiverId=${receiverId}&season=${season}`, {
          signal: controller.signal,
        });
        if (res.ok) setMap((await res.json()) as NflTargetMap);
      } catch {
        // AbortError on unmount or subject change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [receiverId, season]);

  return { map, loading };
}
