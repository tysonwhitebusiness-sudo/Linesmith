'use client';

import { useEffect, useState } from 'react';
import type { NhlTeamDetailApiResponse } from '@/lib/sports/nhl/adapters/teamDetailAdapter';

export interface NhlGameMeta {
  game: {
    gameId: string;
    date: string;
    homeTeamId: string;
    homeAbbr: string;
    homeScore: number | null;
    awayTeamId: string;
    awayAbbr: string;
    awayScore: number | null;
    status: { completed: boolean; state: 'pre' | 'in' | 'post'; shortDetail: string };
  } | null;
  pregameLine: null;
}

export interface NhlGameDetailState {
  meta: NhlGameMeta | null;
  home: NhlTeamDetailApiResponse | null;
  away: NhlTeamDetailApiResponse | null;
  error: string | null;
}

export function useNhlGameDetail(gameId: string | undefined): NhlGameDetailState {
  const [meta, setMeta] = useState<NhlGameMeta | null>(null);
  const [home, setHome] = useState<NhlTeamDetailApiResponse | null>(null);
  const [away, setAway] = useState<NhlTeamDetailApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) {
      setMeta(null);
      setHome(null);
      setAway(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setMeta(null);
    setHome(null);
    setAway(null);
    setError(null);
    fetch(`/api/nhl/game/${gameId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.detail ?? json.error);
          return;
        }
        setMeta(json);
        if (!json.game) return;
        return Promise.all([
          fetch(`/api/nhl/team/${json.game.homeTeamId}`).then((r) => r.json()),
          fetch(`/api/nhl/team/${json.game.awayTeamId}`).then((r) => r.json()),
        ]).then(([h, a]) => {
          if (cancelled) return;
          if (!h.error) setHome(h);
          if (!a.error) setAway(a);
        });
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  return { meta, home, away, error };
}
