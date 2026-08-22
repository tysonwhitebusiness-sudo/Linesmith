'use client';

import { useEffect, useState } from 'react';
import type { CfbGameSummary } from '@/lib/sports/cfb/espn';
import type { CfbTeamDetailApiResponse } from '@/lib/sports/cfb/adapters/teamDetailAdapter';

/** CFB's game-detail fetch — same role useSoccerGameDetail/useNflGameDetail play: one bespoke /api/cfb/game/[gameId] call to resolve the game's real two teams, then the existing /api/cfb/team/[teamId] route twice for each side's roster/record/recent-results. */
export interface CfbGameDetailState {
  meta: CfbGameSummary | null;
  home: CfbTeamDetailApiResponse | null;
  away: CfbTeamDetailApiResponse | null;
  error: string | null;
}

export function useCfbGameDetail(gameId: string | undefined): CfbGameDetailState {
  const [meta, setMeta] = useState<CfbGameSummary | null>(null);
  const [home, setHome] = useState<CfbTeamDetailApiResponse | null>(null);
  const [away, setAway] = useState<CfbTeamDetailApiResponse | null>(null);
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
    fetch(`/api/cfb/game/${gameId}`)
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
          fetch(`/api/cfb/team/${json.game.homeTeamId}`).then((r) => r.json()),
          fetch(`/api/cfb/team/${json.game.awayTeamId}`).then((r) => r.json()),
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
