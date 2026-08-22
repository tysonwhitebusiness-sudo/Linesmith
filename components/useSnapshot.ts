'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sport, SoccerLeague, SportSnapshot, PickCandidate } from '@/lib/core/types';

/**
 * Reverses the wire-side dedup from lib/sports/mlb/historyTrim.ts: the
 * server sends each MLB candidate's history as bare {period, result,
 * category} plus one shared per-player gamelog (periodLabel + raw, keyed by
 * period), instead of repeating periodLabel/raw on every one of a player's
 * ~15-20 dimension candidates. This merges them back into the same
 * self-contained shape every component already expects — run once, here,
 * so nothing downstream (ScanCard, ScanTable, PlayerDetail, ...) had to
 * change. A no-op for golf, or for any MLB response from before this
 * existed (no `playerGamelogs` present).
 */
function hydrateMlbSnapshot(snapshot: SportSnapshot): SportSnapshot {
  if (snapshot.sport !== 'mlb') return snapshot;
  const playerGamelogs = snapshot.context?.other?.playerGamelogs as
    | Record<string, Record<number, { periodLabel?: string; raw: unknown }>>
    | undefined;
  if (!playerGamelogs) return snapshot;

  const candidates: PickCandidate[] = snapshot.candidates.map((c) => {
    const shared = playerGamelogs[c.subjectId];
    if (!shared) return c;
    return {
      ...c,
      history: c.history.map((entry) => {
        const s = shared[entry.period];
        return s ? { ...entry, periodLabel: s.periodLabel, raw: s.raw } : entry;
      }),
    };
  });

  return { ...snapshot, candidates };
}

/** Live data goes stale fast; re-poll while the app is in the foreground. */
const REFRESH_MS = 3 * 60 * 1000;
/** If we were backgrounded longer than this, refetch immediately on return. */
const STALE_ON_FOCUS_MS = 90 * 1000;

export interface SnapshotState {
  snapshot: SportSnapshot | null;
  loading: boolean;
  error: string | null;
  lastFetched: Date | null;
  refresh: () => void;
}

/**
 * Fetch a sport snapshot and keep it fresh.
 *
 * Stale-while-revalidate: keeps showing the last snapshot while a new one
 * loads. Only shows a loading skeleton when there is genuinely no data yet.
 *
 * `date` (P4, MLB only) — an ISO date to preview a future slate instead of
 * today's. Omit for today. Switching dates clears the old snapshot the same
 * way switching sports does, since the games underneath are a different set
 * entirely.
 *
 * `league` (soccer only) — which competition, since `/api/soccer/[league]`
 * is league-scoped (soccer is the first sport with more than one). Switching
 * leagues clears the old snapshot the same way switching sports does.
 */
export function useSnapshot(sport: Sport, date?: string, league?: SoccerLeague): SnapshotState {
  const [snapshot, setSnapshot] = useState<SportSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const hiddenSince = useRef<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const sportRef = useRef(sport);
  const dateRef = useRef(date);
  const leagueRef = useRef(league);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    // Only show loading skeleton on first load — refreshes keep current data visible.
    if (!hasData.current) setLoading(true);
    try {
      const url = sport === 'soccer' ? `/api/soccer/${league}` : date ? `/api/${sport}?date=${date}` : `/api/${sport}`;
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `Request failed (${res.status})`);
      setSnapshot(hydrateMlbSnapshot(json as SportSnapshot));
      setError(null);
      setLastFetched(new Date());
      hasData.current = true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [sport, date, league]);

  useEffect(() => {
    // When switching sports, the previewed date, or the soccer league, keep
    // the old snapshot until the new one arrives instead of blanking the UI,
    // but only if none actually changed — otherwise the games underneath are
    // a completely different set and stale data would be misleading.
    if (sportRef.current !== sport || dateRef.current !== date || leagueRef.current !== league) {
      sportRef.current = sport;
      dateRef.current = date;
      leagueRef.current = league;
      setSnapshot(null);
      hasData.current = false;
    }
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [load, sport, date, league]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince.current = Date.now();
        return;
      }
      const away = hiddenSince.current ? Date.now() - hiddenSince.current : 0;
      hiddenSince.current = null;
      if (away > STALE_ON_FOCUS_MS) void load();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [load]);

  return { snapshot, loading, error, lastFetched, refresh: load };
}
