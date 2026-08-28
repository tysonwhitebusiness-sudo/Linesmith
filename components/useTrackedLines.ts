'use client';

import { useCallback, useEffect, useState } from 'react';

export interface TrackedLine {
  id: number;
  sport: string;
  subjectId: string;
  subjectName: string;
  statKey: string;
  statLabel: string;
  side: 'over' | 'under';
  line: number;
  source: 'manual' | 'prop_odds';
  createdAt: string;
}

export interface UseTrackedLinesResult {
  lines: TrackedLine[];
  loading: boolean;
  error: string | null;
  add: (input: { statKey: string; statLabel: string; side: 'over' | 'under'; line: number; source?: 'manual' | 'prop_odds' }) => Promise<void>;
  remove: (statKey: string) => Promise<void>;
}

/**
 * CRUD against `/api/tracked-lines`, scoped to one subject — mirrors
 * `app/api/watchlist/route.ts`'s auth/shape pattern exactly (see
 * `app/api/tracked-lines/route.ts`). User-owned mutable state, so this
 * stays a separate client fetch rather than living inside the cached,
 * server-computed `PlayerDetailData` payload — same reasoning watchlist
 * itself already follows.
 */
export function useTrackedLines(sport: string, subjectId: string | null, subjectName: string | undefined): UseTrackedLinesResult {
  const [all, setAll] = useState<TrackedLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracked-lines?sport=${encodeURIComponent(sport)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { trackedLines: TrackedLine[] };
      setAll(json.trackedLines ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracked lines');
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add: UseTrackedLinesResult['add'] = useCallback(
    async ({ statKey, statLabel, side, line, source }) => {
      if (!subjectId || !subjectName) return;
      const res = await fetch('/api/tracked-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sport, subjectId, subjectName, statKey, statLabel, side, line, source: source ?? 'manual' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { trackedLines: TrackedLine[] };
      setAll(json.trackedLines ?? []);
    },
    [sport, subjectId, subjectName],
  );

  const remove: UseTrackedLinesResult['remove'] = useCallback(
    async (statKey) => {
      if (!subjectId) return;
      const res = await fetch(`/api/tracked-lines?sport=${encodeURIComponent(sport)}&subjectId=${encodeURIComponent(subjectId)}&statKey=${encodeURIComponent(statKey)}`, {
        method: 'DELETE',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { trackedLines: TrackedLine[] };
      setAll(json.trackedLines ?? []);
    },
    [sport, subjectId],
  );

  const lines = subjectId ? all.filter((l) => l.subjectId === subjectId) : [];
  return { lines, loading, error, add, remove };
}
