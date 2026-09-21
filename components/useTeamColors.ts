'use client';

import { useEffect, useState } from 'react';
import type { TeamColorIndex } from '@/lib/sports/shared/teamColors';

/**
 * C0.2 — a league's team colours, for the hero bands and the Slate's stripes.
 * One request per sport, cached for seven days server-side and kept for the
 * page's life here. Null for sports with no teams (golf, tennis) and until it
 * loads, so every caller falls back to charcoal.
 */
const memo = new Map<string, Promise<TeamColorIndex | null>>();

export function useTeamColors(sport: string, league?: string | null): TeamColorIndex | null {
  const [index, setIndex] = useState<TeamColorIndex | null>(null);
  useEffect(() => {
    let cancelled = false;
    const key = `${sport}|${league ?? ''}`;
    if (!memo.has(key)) {
      const params = new URLSearchParams({ sport });
      if (league) params.set('league', league);
      memo.set(
        key,
        fetch(`/api/team-colors?${params}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (j?.index ?? null) as TeamColorIndex | null)
          .catch(() => null),
      );
    }
    void memo.get(key)!.then((i) => {
      if (!cancelled) setIndex(i);
    });
    return () => {
      cancelled = true;
    };
  }, [sport, league]);
  return index;
}
