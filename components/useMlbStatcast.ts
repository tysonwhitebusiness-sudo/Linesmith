'use client';

import { useEffect, useState } from 'react';
import type { PlayerStatcastRow } from '@/lib/sports/mlb/statcastRollupShapes';

export interface MlbStatcastPlayer {
  season: number;
  playerId: number;
  batting: PlayerStatcastRow | null;
  pitching: PlayerStatcastRow | null;
}

export interface MlbStatcastState {
  data: MlbStatcastPlayer | null;
  loading: boolean;
  /** Human text. A 404 (no pitches on record) is not an error: `data` stays null. */
  error: string | null;
  /** True once a response came back for this player and season, found or not. */
  settled: boolean;
}

/**
 * One MLB player's Statcast season, both roles (R6.1b) — the R5a rollup through
 * `/api/mlb/statcast/player/[playerId]`.
 *
 * Replaces `useMlbPitchProfile`: the rollup row carries the old pitch-profile
 * block (`payload.profile`) beside everything the contact and arsenal sections
 * need, so one fetch serves the player page's sections and its matchup roles.
 * An undefined id idles — the hook runs for every sport (rules of hooks).
 */
export function useMlbStatcast(playerId?: number, season?: number): MlbStatcastState {
  const [state, setState] = useState<MlbStatcastState>({ data: null, loading: false, error: null, settled: false });

  useEffect(() => {
    if (playerId == null || season == null) {
      setState({ data: null, loading: false, error: null, settled: false });
      return;
    }
    const controller = new AbortController();
    // Cleared on a key change, so one player's numbers never sit under another's name.
    setState({ data: null, loading: true, error: null, settled: false });
    void (async () => {
      try {
        const res = await fetch(`/api/mlb/statcast/player/${playerId}?season=${season}`, { signal: controller.signal });
        if (res.status === 404) setState({ data: null, loading: false, error: null, settled: true });
        else if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this player's Statcast season.", settled: true });
        else setState({ data: (await res.json()) as MlbStatcastPlayer, loading: false, error: null, settled: true });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this player's Statcast season.", settled: true });
      }
    })();
    return () => controller.abort();
  }, [playerId, season]);

  return state;
}
