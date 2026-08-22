'use client';

import { useEffect, useState } from 'react';
import type { SoccerLeague } from '@/lib/core/types';
import type { SoccerGameSummary } from '@/lib/sports/soccer/espn';
import type { SoccerTeamDetailApiResponse } from '@/lib/sports/soccer/adapters/teamDetailAdapter';

/**
 * Soccer's game-detail fetch — same role `useNflGameDetail` plays for NFL:
 * one bespoke `/api/soccer/[league]/game/[gameId]` call to resolve the
 * game's real two teams + pregame line + live state, then the existing
 * `/api/soccer/[league]/team/[teamId]` route (already built) twice for
 * each side's roster/record/recent-results, rather than duplicating that
 * route's logic here.
 */
export interface SoccerGameDetailState {
  meta: SoccerGameSummary | null;
  home: SoccerTeamDetailApiResponse | null;
  away: SoccerTeamDetailApiResponse | null;
  error: string | null;
}

export function useSoccerGameDetail(league: SoccerLeague | undefined, gameId: string | undefined): SoccerGameDetailState {
  const [meta, setMeta] = useState<SoccerGameSummary | null>(null);
  const [home, setHome] = useState<SoccerTeamDetailApiResponse | null>(null);
  const [away, setAway] = useState<SoccerTeamDetailApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!league || !gameId) {
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
    fetch(`/api/soccer/${league}/game/${gameId}`)
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
          fetch(`/api/soccer/${league}/team/${json.game.homeTeamId}`).then((r) => r.json()),
          fetch(`/api/soccer/${league}/team/${json.game.awayTeamId}`).then((r) => r.json()),
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
  }, [league, gameId]);

  return { meta, home, away, error };
}
