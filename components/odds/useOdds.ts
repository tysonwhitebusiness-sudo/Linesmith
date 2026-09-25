'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameOddsPayload, MarketEdge, PlayerOddsPayload } from '@/lib/odds/section/types';
import type { SlateOddsPayload } from '@/lib/odds/section/slate';
import type { ScanExtras } from '@/lib/odds/section/scanCells';
import { REFRESH_MS } from '@/lib/odds/section/cadence';
import { keysOf } from '@/lib/odds/section/liveDiff';
import { mergeLiveGame } from '@/lib/odds/section/liveMerge';
import { useLiveTracker, type LiveTracker } from './live';

/**
 * The odds section's fetch hooks (odds build P8; live in P9). They live in
 * components, never in adapters (CLAUDE.md rule 3). The player, game and
 * Slate hooks POLL — 45 s, 45 s and 60 s (the Slate route's TTL; `REFRESH_MS`) — while the
 * tab is visible, pause while it is hidden and refetch at once on return;
 * one request in flight per hook, each with its own AbortController. Each
 * response is diffed against the last (`lib/odds/section/liveDiff.ts`) and
 * the tracker they return drives every animation. A failed refresh keeps the
 * last good payload on screen (the LiveDot's age then says it is held back).
 * The routes do not change: pattern-2 reads and the Slate's 60 s cachedRoute.
 */
export interface OddsState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface LiveOddsState<T> extends OddsState<T> {
  live: LiveTracker;
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

/**
 * A light refresh (P9 §4): after the first full read, poll `url + light.suffix`
 * and `light.merge` it onto the last full payload; every `light.fullEvery`
 * polls, read in full again so anything the merge approximates is resynced.
 */
interface Light<T> { suffix: string; merge: (full: T, light: T) => T; fullEvery: number }

/** Poll `url` every `everyMs` while visible (null = fetch once, e.g. a finished game). */
function useLiveJson<T extends PlayerOddsPayload | GameOddsPayload | SlateOddsPayload>(
  url: string | null, everyMs: number | null, game: boolean, refreshKey: unknown, light?: Light<T>,
): LiveOddsState<T> {
  const [state, setState] = useState<OddsState<T>>({ data: null, loading: !!url, error: null });
  const { tracker, push, reset } = useLiveTracker(game);
  const pushRef = useRef(push);
  pushRef.current = push;
  const lastUrl = useRef<string | null>(null);
  useEffect(() => {
    // A new subject starts a new memory; a refreshKey bump on the same URL keeps it.
    if (lastUrl.current !== url) { lastUrl.current = url; reset(); }
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let stopped = false, busy = false, polls = 0;
    let full: T | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!stopped && everyMs && visible()) timer = setTimeout(run, everyMs);
    };
    const run = async () => {
      if (busy || stopped) return;
      busy = true;
      ctrl = new AbortController();
      try {
        const lightNow = !!(light && full && polls % light.fullEvery !== 0);
        polls++;
        const r = await fetch(lightNow ? url + light!.suffix : url, { signal: ctrl.signal, cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const got = (await r.json()) as T;
        if (stopped) return;
        const data = lightNow ? light!.merge(full!, got) : got;
        full = data;
        pushRef.current(keysOf(data));
        setState({ data, loading: false, error: null });
      } catch (e) {
        if (stopped || (e as Error)?.name === 'AbortError') return;
        setState(s => ({ data: s.data, loading: false, error: String((e as Error)?.message ?? e) }));
      } finally {
        busy = false;
        schedule();
      }
    };
    const onVisibility = () => {
      if (!everyMs) return;
      if (visible()) { if (timer) clearTimeout(timer); timer = null; void run(); }
      else if (timer) { clearTimeout(timer); timer = null; }
    };
    setState(s => ({ ...s, loading: true, error: null }));
    void run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // `light` is a constant per hook (its merge is a module function), so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, everyMs, refreshKey, reset]);
  return { ...state, live: tracker };
}

export function usePlayerOdds(sport: string | null, gameId: string | null, subjectId: string | null, refreshKey?: unknown) {
  const url = sport && gameId && subjectId
    ? `/api/odds/player?sport=${encodeURIComponent(sport)}&gameId=${encodeURIComponent(gameId)}&subjectId=${encodeURIComponent(subjectId)}`
    : null;
  return useLiveJson<PlayerOddsPayload>(url, REFRESH_MS.player, false, refreshKey);
}

/** The game page polls light (no history) and resyncs in full every 8th poll (6 min). */
const GAME_LIGHT: Light<GameOddsPayload> = { suffix: '&live=1', merge: mergeLiveGame, fullEvery: 8 };

/** `live: false` for a finished game: its prices are closed, so it fetches once. */
export function useGameOdds(sport: string | null, gameId: string | null, opts?: { live?: boolean; refreshKey?: unknown }) {
  const url = sport && gameId ? `/api/odds/game?sport=${encodeURIComponent(sport)}&gameId=${encodeURIComponent(gameId)}` : null;
  return useLiveJson<GameOddsPayload>(url, opts?.live === false ? null : REFRESH_MS.game, true, opts?.refreshKey, GAME_LIGHT);
}

export function useGameCloses(sport: string | null, games: { gameId: string; start: string }[], refreshKey?: unknown) {
  const q = games.map(g => `${g.gameId}@${g.start}`).join(',');
  const url = sport && q ? `/api/odds/closes?sport=${encodeURIComponent(sport)}&games=${encodeURIComponent(q)}` : null;
  return useJson<{ closes: Record<string, { spread: number | null; total: number | null; books: number }> }>(url, refreshKey);
}

export function useSlateOdds(sport: string | null, date: string | null, gameIds: string[], refreshKey?: unknown) {
  const ids = [...new Set(gameIds)].sort().slice(0, 60).join(',');
  const url = sport && date && ids ? `/api/odds/slate?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(date)}&ids=${encodeURIComponent(ids)}` : null;
  return useLiveJson<SlateOddsPayload>(url, REFRESH_MS.slate, true, refreshKey);
}

/**
 * P11: the market edges for the Slate's games (the game cards' dot, the Market
 * hub's Edges tab). Polled with the Slate, visible tab only; `edges` absent
 * while the kill switch or the self-check hides them.
 */
export function useEdges(gameIds: string[], refreshKey?: unknown): { edges?: MarketEdge[] } | null {
  const ids = [...new Set(gameIds)].sort().slice(0, 80).join(',');
  const [data, setData] = useState<{ edges?: MarketEdge[] } | null>(null);
  useEffect(() => {
    if (!ids) { setData(null); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const r = await fetch(`/api/odds/edges?ids=${encodeURIComponent(ids)}`);
          if (r.ok && !stopped) setData(await r.json());
        } catch { /* the next poll retries */ }
      }
      if (!stopped) timer = setTimeout(run, REFRESH_MS.slate);
    };
    void run();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [ids, refreshKey]);
  return data;
}

export function useScanExtras(gameIds: string[], refreshKey?: unknown) {
  const ids = [...new Set(gameIds)].sort().slice(0, 80).join(',');
  return useJson<ScanExtras>(ids ? `/api/odds/scan?ids=${encodeURIComponent(ids)}` : null, refreshKey);
}
