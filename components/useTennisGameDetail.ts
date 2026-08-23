'use client';

import { useEffect, useState } from 'react';
import type { TennisTour } from '@/lib/core/types';
import type { EspnTennisMatchDetail } from '@/lib/sports/multiSport/espnTennis';

interface RecentResultRowWire {
  gameId: string;
  date: string;
  win: boolean;
  opponentAbbr: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
}

/**
 * Tennis's game-detail fetch — one bespoke `/api/tennis/[tour]/game/[gameId]`
 * call, same role `useSoccerGameDetail`/`useNhlGameDetail` play. Tennis has
 * no separate "team" route to compose with a second fetch (no team concept
 * — see `lib/sports/tennis/adapter.ts`'s header), so the one route already
 * returns both players' resolved records.
 */
export interface TennisGameDetailState {
  meta: EspnTennisMatchDetail | null;
  player1Recent: RecentResultRowWire[];
  player2Recent: RecentResultRowWire[];
  player1H2h: RecentResultRowWire[];
  player2H2h: RecentResultRowWire[];
  error: string | null;
}

const EMPTY: RecentResultRowWire[] = [];

export function useTennisGameDetail(tour: TennisTour | undefined, gameId: string | undefined): TennisGameDetailState {
  const [meta, setMeta] = useState<EspnTennisMatchDetail | null>(null);
  const [player1Recent, setPlayer1Recent] = useState<RecentResultRowWire[]>(EMPTY);
  const [player2Recent, setPlayer2Recent] = useState<RecentResultRowWire[]>(EMPTY);
  const [player1H2h, setPlayer1H2h] = useState<RecentResultRowWire[]>(EMPTY);
  const [player2H2h, setPlayer2H2h] = useState<RecentResultRowWire[]>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tour || !gameId) {
      setMeta(null);
      setPlayer1Recent(EMPTY);
      setPlayer2Recent(EMPTY);
      setPlayer1H2h(EMPTY);
      setPlayer2H2h(EMPTY);
      setError(null);
      return;
    }
    let cancelled = false;
    setMeta(null);
    setError(null);
    fetch(`/api/tennis/${tour}/game/${gameId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.detail ?? json.error);
          return;
        }
        setMeta(json.game ?? null);
        setPlayer1Recent(json.player1Recent ?? EMPTY);
        setPlayer2Recent(json.player2Recent ?? EMPTY);
        setPlayer1H2h(json.player1H2h ?? EMPTY);
        setPlayer2H2h(json.player2H2h ?? EMPTY);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tour, gameId]);

  return { meta, player1Recent, player2Recent, player1H2h, player2H2h, error };
}
