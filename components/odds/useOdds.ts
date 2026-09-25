'use client';

import { useEffect, useState } from 'react';
import type { GameOddsPayload, PlayerOddsPayload } from '@/lib/odds/section/types';
import type { SlateOddsPayload } from '@/lib/odds/section/slate';
import type { ScanExtras } from '@/lib/odds/section/scanCells';

/**
 * The odds section's fetch hooks (odds build P8). They live in components,
 * never in adapters (CLAUDE.md rule 3). Each fetches once on mount and again
 * whenever `refreshKey` changes; P9 adds the 30–60 s refresh.
 */
export interface OddsState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useJson<T>(url: string | null, refreshKey: unknown): OddsState<T> {
  const [state, setState] = useState<OddsState<T>>({ data: null, loading: !!url, error: null });
  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as T;
      })
      .then(data => { if (live) setState({ data, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e?.message ?? e) }); });
    return () => { live = false; };
  }, [url, refreshKey]);
  return state;
}

export function usePlayerOdds(sport: string | null, gameId: string | null, subjectId: string | null, refreshKey?: unknown) {
  const url = sport && gameId && subjectId
    ? `/api/odds/player?sport=${encodeURIComponent(sport)}&gameId=${encodeURIComponent(gameId)}&subjectId=${encodeURIComponent(subjectId)}`
    : null;
  return useJson<PlayerOddsPayload>(url, refreshKey);
}

export function useGameOdds(sport: string | null, gameId: string | null, refreshKey?: unknown) {
  const url = sport && gameId ? `/api/odds/game?sport=${encodeURIComponent(sport)}&gameId=${encodeURIComponent(gameId)}` : null;
  return useJson<GameOddsPayload>(url, refreshKey);
}

export function useGameCloses(sport: string | null, games: { gameId: string; start: string }[], refreshKey?: unknown) {
  const q = games.map(g => `${g.gameId}@${g.start}`).join(',');
  const url = sport && q ? `/api/odds/closes?sport=${encodeURIComponent(sport)}&games=${encodeURIComponent(q)}` : null;
  return useJson<{ closes: Record<string, { spread: number | null; total: number | null; books: number }> }>(url, refreshKey);
}

export function useSlateOdds(sport: string | null, date: string | null, gameIds: string[], refreshKey?: unknown) {
  const ids = [...new Set(gameIds)].sort().slice(0, 60).join(',');
  const url = sport && date && ids ? `/api/odds/slate?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(date)}&ids=${encodeURIComponent(ids)}` : null;
  return useJson<SlateOddsPayload>(url, refreshKey);
}

export function useScanExtras(gameIds: string[], refreshKey?: unknown) {
  const ids = [...new Set(gameIds)].sort().slice(0, 80).join(',');
  return useJson<ScanExtras>(ids ? `/api/odds/scan?ids=${encodeURIComponent(ids)}` : null, refreshKey);
}
