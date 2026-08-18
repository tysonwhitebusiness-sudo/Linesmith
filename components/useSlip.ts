'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PickCandidate, Sport } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';

export interface PickRow {
  id: number;
  sport: string;
  subjectId: string;
  subjectName: string;
  dimension: string;
  dimensionLabel: string;
  category: string;
  categoryLabel: string;
  line: number | null;
  gameId: string | null;
  teamId: number | null;
  team: string | null;
  opponentId: number | null;
  opponent: string | null;
  americanOdds: string | null;
  oddsSource: string | null;
  oddsCapturedAt: string | null;
  bookmaker: string | null;
  eventContext: string | null;
  sampleSize: number | null;
  createdAt: string;
}

export interface WatchRow {
  id: number;
  sport: string;
  subjectId: string;
  subjectName: string;
}

/** Slip and watchlist state, both persisted server-side in SQLite. */
export function useSlip(sport: Sport) {
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchRow[]>([]);
  const [busy, setBusy] = useState(false);

  const loadPicks = useCallback(async () => {
    const res = await fetch(`/api/picks?sport=${sport}`, { cache: 'no-store' });
    if (res.ok) setPicks((await res.json()).picks ?? []);
  }, [sport]);

  const loadWatchlist = useCallback(async () => {
    const res = await fetch(`/api/watchlist?sport=${sport}`, { cache: 'no-store' });
    if (res.ok) setWatchlist((await res.json()).watchlist ?? []);
  }, [sport]);

  useEffect(() => {
    void loadPicks();
    void loadWatchlist();
  }, [loadPicks, loadWatchlist]);

  const addPick = useCallback(
    async (
      candidate: PickCandidate,
      eventContext: string | null,
      // Game-level markets (moneyline/spread/total) are added with the price
      // already showing in the picks panel, since the source odds are known
      // at add time — unlike a prop, there's no line stepper to invalidate it.
      // Player props pass this too now, whenever a live price is resolvable
      // at add time (see resolveCandidateEdge call sites) — omitted only
      // when genuinely no price exists yet, which the slip shows as needing
      // manual entry.
      odds?: { americanOdds: string; source: string; bookmaker?: string },
    ) => {
      setBusy(true);
      try {
        const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
        const gamePk = meta.gamePk;
        const teamId = meta.teamId ?? meta.homeTeamId; // homeTeamId covers gameMarketCandidate, which has no single "own team"
        await fetch('/api/picks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sport: candidate.sport,
            subjectId: candidate.subjectId,
            subjectName: candidate.subjectName,
            dimension: candidate.dimension,
            dimensionLabel: candidate.dimensionLabel,
            category: candidate.category,
            categoryLabel: candidate.categoryLabel,
            line: candidate.line ?? null,
            gameId: typeof gamePk === 'number' ? String(gamePk) : null,
            teamId: typeof teamId === 'number' ? teamId : null,
            team: typeof meta.team === 'string' ? meta.team : null,
            opponentId: typeof meta.opponentId === 'number' ? meta.opponentId : null,
            opponent: typeof meta.opponent === 'string' ? meta.opponent : null,
            sampleSize: candidate.sampleSize,
            eventContext,
            americanOdds: odds?.americanOdds ?? null,
            oddsSource: odds?.source ?? null,
            bookmaker: odds?.bookmaker ?? null,
          }),
        });
        await loadPicks();
      } finally {
        setBusy(false);
      }
    },
    [loadPicks],
  );

  const removePick = useCallback(
    async (id: number) => {
      await fetch(`/api/picks?id=${id}`, { method: 'DELETE' });
      await loadPicks();
    },
    [loadPicks],
  );

  const clearSlip = useCallback(async () => {
    await fetch(`/api/picks?all=1&sport=${sport}`, { method: 'DELETE' });
    await loadPicks();
  }, [loadPicks, sport]);

  /** Move slip legs to Live Bets. Submitted legs disappear from the slip immediately. */
  const submitPicks = useCallback(
    async (ids: number[]) => {
      setBusy(true);
      try {
        const res = await fetch('/api/bets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        await loadPicks();
        return res.ok ? ((await res.json()).bets ?? []) : [];
      } finally {
        setBusy(false);
      }
    },
    [loadPicks],
  );

  const setOdds = useCallback(
    async (id: number, americanOdds: string, source = 'manual') => {
      await fetch('/api/picks', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, americanOdds, source }),
      });
      await loadPicks();
    },
    [loadPicks],
  );

  const toggleWatch = useCallback(
    async (subjectId: string, subjectName: string) => {
      const watched = watchlist.some((w) => w.subjectId === subjectId);
      if (watched) {
        await fetch(`/api/watchlist?sport=${sport}&subjectId=${encodeURIComponent(subjectId)}`, { method: 'DELETE' });
      } else {
        await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sport, subjectId, subjectName }),
        });
      }
      await loadWatchlist();
    },
    [loadWatchlist, sport, watchlist],
  );

  /** Keys already on the slip, so cards can show an added state. */
  const pickedKeys = new Set(
    picks.map((p) =>
      candidateKey({ sport: p.sport as Sport, subjectId: p.subjectId, dimension: p.dimension, category: p.category }),
    ),
  );

  const watchedIds = new Set(watchlist.map((w) => w.subjectId));

  return {
    picks,
    watchlist,
    watchedIds,
    pickedKeys,
    busy,
    addPick,
    removePick,
    clearSlip,
    submitPicks,
    setOdds,
    toggleWatch,
    reloadPicks: loadPicks,
  };
}
