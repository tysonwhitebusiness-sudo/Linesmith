'use client';

import { useEffect, useState } from 'react';
import type { NbaGameSummary } from '@/lib/sports/nba/espn';
import type { NbaTeamDetailApiResponse } from '@/lib/sports/nba/adapters/teamDetailAdapter';

export interface NbaGameDetailState {
  meta: NbaGameSummary | null;
  home: NbaTeamDetailApiResponse | null;
  away: NbaTeamDetailApiResponse | null;
  error: string | null;
}

export function useNbaGameDetail(gameId: string | undefined): NbaGameDetailState {
  const [meta, setMeta] = useState<NbaGameSummary | null>(null);
  const [home, setHome] = useState<NbaTeamDetailApiResponse | null>(null);
  const [away, setAway] = useState<NbaTeamDetailApiResponse | null>(null);
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
    fetch(`/api/nba/game/${gameId}`)
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
          fetch(`/api/nba/team/${json.game.homeTeamId}`).then((r) => r.json()),
          fetch(`/api/nba/team/${json.game.awayTeamId}`).then((r) => r.json()),
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
