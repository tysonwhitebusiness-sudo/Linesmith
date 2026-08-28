'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  rowsFor,
  bestPrice,
  userBookPrice,
  resolveCandidateEdge,
  type PropOddsRow,
  type CandidateEdgeInfo,
} from '@/lib/odds/props/liveEdge';

/**
 * Prop Score v1 — the pure price/edge helpers used to live here, but they're
 * needed server-side too (locking a score into `pick_history` at surface
 * time), so the implementation moved to `lib/odds/props/liveEdge.ts` and
 * this file just re-exports for every existing client caller.
 */
export { rowsFor, bestPrice, userBookPrice, resolveCandidateEdge, type PropOddsRow, type CandidateEdgeInfo };

export interface Tier2ActionState {
  loading: boolean;
  error: string | null;
  budgetRemaining: number | null;
}

/**
 * Tier 1 prop odds for one game, read from the cache-backed
 * `/api/props/lines` route — never fetches on its own schedule, just once on
 * mount/game-change plus whenever the caller's own refresh cycle ticks
 * (`refreshKey`), matching `useGameLines`'s existing pattern.
 *
 * `enabled` (default `true`) — same idiom as `useSlatePropOdds`'s own
 * `enabled` param: set `false` when a parent component has already fetched
 * this exact game's prop odds and is passing the result down instead (see
 * `GameDetail`'s nested `PlayerDetail`, which shares its own `usePropOdds`
 * call rather than each having its own independent copy of the same fetch).
 * The `runMoreBooks`/`runSharpPrice`/`runScan` actions stay available
 * either way — they're user-triggered, not part of the passive fetch this
 * flag gates.
 */
export function usePropOdds(gameId: string | undefined, refreshKey?: string | null, enabled = true) {
  const [rows, setRows] = useState<PropOddsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userSportsbook, setUserSportsbook] = useState<string>('fanatics');

  const reload = useCallback(async () => {
    if (!gameId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/props/lines?gameId=${gameId}`, { cache: 'no-store' });
      if (res.ok) setRows((await res.json()).rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void reload();
  }, [reload, refreshKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      const res = await fetch('/api/props/diagnostics', { cache: 'no-store' });
      if (res.ok) setUserSportsbook((await res.json()).userSportsbook ?? 'fanatics');
    })();
  }, [enabled]);

  const [moreBooks, setMoreBooks] = useState<Tier2ActionState>({ loading: false, error: null, budgetRemaining: null });
  const [sharpPrice, setSharpPrice] = useState<Tier2ActionState>({ loading: false, error: null, budgetRemaining: null });

  const runMoreBooks = useCallback(async () => {
    if (!gameId) return;
    setMoreBooks({ loading: true, error: null, budgetRemaining: null });
    try {
      const res = await fetch('/api/props/more-books', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMoreBooks({ loading: false, error: json.error ?? 'Request failed.', budgetRemaining: json.budget?.remaining ?? null });
        return;
      }
      setRows(json.rows ?? []);
      setMoreBooks({ loading: false, error: null, budgetRemaining: json.budget?.remaining ?? null });
    } catch {
      setMoreBooks({ loading: false, error: 'More Books request failed.', budgetRemaining: null });
    }
  }, [gameId]);

  const runSharpPrice = useCallback(async (): Promise<any> => {
    if (!gameId) return null;
    setSharpPrice({ loading: true, error: null, budgetRemaining: null });
    try {
      const res = await fetch('/api/props/sharp-price', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSharpPrice({ loading: false, error: json.error ?? 'Request failed.', budgetRemaining: json.budget?.remaining ?? null });
        return null;
      }
      setSharpPrice({ loading: false, error: null, budgetRemaining: json.monthlyRemaining ?? null });
      return json;
    } catch {
      setSharpPrice({ loading: false, error: 'Check Sharp Price request failed.', budgetRemaining: null });
      return null;
    }
  }, [gameId]);

  const [scan, setScan] = useState<{ loading: boolean; error: string | null; lastScannedAt: string | null }>({
    loading: false,
    error: null,
    lastScannedAt: null,
  });

  /**
   * The player-page "Scan" action — Tier 1 only (free), scoped to this
   * player's game. No per-player fetch exists on any of the four real
   * providers (all return the whole game's board), so this refreshes the
   * game and relies on the same subject-scoped filtering the rest of this
   * hook already does to show just this player's slice.
   */
  const runScan = useCallback(async () => {
    if (!gameId) return;
    setScan({ loading: true, error: null, lastScannedAt: null });
    try {
      const res = await fetch('/api/props/scan-player', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScan({ loading: false, error: json.error ?? 'Scan failed.', lastScannedAt: null });
        return;
      }
      setRows(json.rows ?? []);
      setScan({ loading: false, error: null, lastScannedAt: new Date().toISOString() });
    } catch {
      setScan({ loading: false, error: 'Scan failed.', lastScannedAt: null });
    }
  }, [gameId]);

  return { rows, loading, userSportsbook, moreBooks, sharpPrice, scan, runMoreBooks, runSharpPrice, runScan, reload };
}

/**
 * Every resolved Tier 1 price across the whole slate, not one game — what
 * Scan needs to show real odds on a dense table of candidates spanning every
 * game of the day, versus `usePropOdds`'s single-game scope for Game Detail
 * and Player Detail. Same cache-backed route with `gameId` omitted, which
 * `/api/props/lines` already supports.
 *
 * `sport` (default 'mlb') is real, not cosmetic — a genuine bug fixed
 * 2026-08-27: without it, /api/props/lines' whole-slate branch always
 * resolved MLB's own games regardless of which sport's Scan page was
 * asking, so every NFL candidate silently lost its price-gate match and
 * the whole "All" list emptied out right after loading finished.
 */
export function useSlatePropOdds(refreshKey?: string | null, enabled = true, sport: string = 'mlb') {
  const [rows, setRows] = useState<PropOddsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userSportsbook, setUserSportsbook] = useState<string>('fanatics');

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/props/lines?sport=${sport}`, { cache: 'no-store' });
        if (!cancelled && res.ok) setRows((await res.json()).rows ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, enabled, sport]);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      const res = await fetch('/api/props/diagnostics', { cache: 'no-store' });
      if (res.ok) setUserSportsbook((await res.json()).userSportsbook ?? 'fanatics');
    })();
  }, [enabled]);

  return { rows, loading, userSportsbook };
}
