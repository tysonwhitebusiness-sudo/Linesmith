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
 *
 * This hook used to also expose three user-triggered provider actions —
 * `runMoreBooks`, `runSharpPrice` and `runScan`. All three were deleted in
 * task 2.5 (standing decision Q12) along with the routes behind them; only
 * `runScan` ever had UI. Prop prices are now refreshed solely by the Python
 * worker's own schedule, so this hook is a pure read.
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
      // /api/props/user-sportsbook, not /api/props/diagnostics — the latter
      // also returns provider budget usage and the unresolved-coverage report,
      // and is admin-gated since Phase 1.5. This needs one string.
      const res = await fetch('/api/props/user-sportsbook', { cache: 'no-store' });
      if (res.ok) setUserSportsbook((await res.json()).userSportsbook ?? 'fanatics');
    })();
  }, [enabled]);

  return { rows, loading, userSportsbook, reload };
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
      // /api/props/user-sportsbook, not /api/props/diagnostics — the latter
      // also returns provider budget usage and the unresolved-coverage report,
      // and is admin-gated since Phase 1.5. This needs one string.
      const res = await fetch('/api/props/user-sportsbook', { cache: 'no-store' });
      if (res.ok) setUserSportsbook((await res.json()).userSportsbook ?? 'fanatics');
    })();
  }, [enabled]);

  return { rows, loading, userSportsbook };
}
