'use client';

import { useEffect, useState } from 'react';
import type { GameSituationStrip } from '@/lib/sports/nfl/liveGameState';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { NflTeamDetailApiResponse, NflTeamStatLine } from './useNflTeamDetail';

/**
 * NFL's game-detail fetch — extracted out of the old `NflGameDetail.tsx` so
 * the shared `GameDetail.tsx` (and its `lib/sports/nfl/adapters/gameDetailAdapter.ts`)
 * can consume the same `/api/nfl/game/[gameId]` + two `/api/nfl/team/[teamId]`
 * responses without owning the fetch/loading/error plumbing themselves.
 * MLB's game page instead composes several existing hooks
 * (`useGameContext`/`useBullpen`) over an already-resolved `game` object —
 * NFL's real data model is three bespoke endpoint calls instead, so this
 * hook is the NFL-side equivalent, not a forced match to MLB's shape.
 */

export interface NflGameMetaResponse {
  game: {
    gameId: string;
    date: string;
    homeTeamId: string;
    homeTeamName: string;
    homeAbbr: string;
    awayTeamId: string;
    awayTeamName: string;
    awayAbbr: string;
    /**
     * The stadium. The route has always returned this (ESPN reports it on
     * every event) and the type simply never declared it, so nothing could
     * read it -- Phase 6.15's venue strip is the first caller.
     *
     * `indoor === undefined` means UNKNOWN, not open air. See
     * `teamSportEspn.ts`'s `EspnVenue`.
     */
    venue?: { fullName?: string; city?: string; state?: string; country?: string; indoor?: boolean };
  };
  homeInjuries: Array<{ playerName: string; teamName: string; status: string }>;
  awayInjuries: Array<{ playerName: string; teamName: string; status: string }>;
  liveState: GameSituationStrip | null;
  sportsGameOddsLine: UnifiedGameLine | null;
  warnings: string[];
  /** Real, opponent-conditional defense-allowed stats for *this* game's actual two teams — not each team's own next-game opponent (a real nflverse/ESPN schedule mismatch), see app/api/nfl/game/[gameId]/route.ts. */
  homeDefenseAllowed: NflTeamStatLine[];
  awayDefenseAllowed: NflTeamStatLine[];
}

export interface NflGameDetailState {
  meta: NflGameMetaResponse | null;
  home: NflTeamDetailApiResponse | null;
  away: NflTeamDetailApiResponse | null;
  error: string | null;
}

export function useNflGameDetail(gameId: string | undefined): NflGameDetailState {
  const [meta, setMeta] = useState<NflGameMetaResponse | null>(null);
  const [home, setHome] = useState<NflTeamDetailApiResponse | null>(null);
  const [away, setAway] = useState<NflTeamDetailApiResponse | null>(null);
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
    fetch(`/api/nfl/game/${gameId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.detail ?? json.error);
          return;
        }
        setMeta(json);
        return Promise.all([
          fetch(`/api/nfl/team/${json.game.homeTeamId}`).then((r) => r.json()),
          fetch(`/api/nfl/team/${json.game.awayTeamId}`).then((r) => r.json()),
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
