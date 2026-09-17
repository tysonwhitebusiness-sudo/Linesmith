'use client';

import { useEffect, useState } from 'react';
import type { PlayerComparePayload } from '@/lib/sports/shared/compareShapes';
import { isTeamProductionSport } from '@/lib/sports/shared/teamProductionShapes';

/**
 * The compare control's fetch — R10. Idle for a sport with no team rollups
 * (tennis, golf), so the hook can still be called unconditionally beside the
 * page's others (CLAUDE.md §3: hooks stay in the component).
 */
export function usePlayerCompare(sport: string | null, athleteId: string | null, teamId: string | null) {
  const [data, setData] = useState<PlayerComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const active = !!sport && isTeamProductionSport(sport) && !!athleteId;

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ sport: String(sport), athleteId: String(athleteId) });
    if (teamId) params.set('teamId', teamId);
    setLoading(true);
    setError(null);
    fetch(`/api/player-compare?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Compare unavailable (${res.status})`);
        return (await res.json()) as PlayerComparePayload;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Compare unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, sport, athleteId, teamId, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
