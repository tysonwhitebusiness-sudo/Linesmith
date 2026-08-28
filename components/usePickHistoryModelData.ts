'use client';

import { useEffect, useState } from 'react';
import type { PickCandidate } from '@/lib/core/types';

/**
 * Real, ungraded pick_history rows for one sport — the read side of
 * predict/generic_prop_production.py's model output (docs/daily-picks-
 * full-model-build-2026-08-27.md), used to backfill NFL/CFB/NBA/NHL/
 * Soccer's PickCandidate.subjectMeta.modelProb the way MLB's/Golf's own
 * adapter.ts files already do at snapshot-build time. See
 * app/api/picks/model-data/route.ts's own docstring for the real gap
 * this closes: those five sports' adapters never populated modelProb at
 * all (there was no real model to populate it FROM until this session),
 * so Scan's dense-table Score column has always been empty for them.
 */
export interface PickHistoryModelRow {
  subjectId: string;
  subjectName: string;
  dimension: string;
  category: string;
  marketKey: string | null;
  line: number | null;
  gameId: string | null;
  sampleSize: number | null;
  modelProb: number | null;
  marketProb: number | null;
  edge: number | null;
  priceSource: string | null;
  bookmaker: string | null;
  propScore: number | null;
  scoreGrade: string | null;
  trustTier: string | null;
  price: number | null;
}

export interface PickHistoryModelDataState {
  /** Keyed `${subjectId}:${dimension}:${gameId}` — the same natural key pick_history's own UNIQUE constraint uses (sport is implicit, this map is already scoped to one sport). */
  rowsByKey: Map<string, PickHistoryModelRow>;
  loading: boolean;
}

export function modelDataKey(subjectId: string, dimension: string, gameId: string | number | null | undefined): string {
  return `${subjectId}:${dimension}:${gameId ?? ''}`;
}

/**
 * `enabled` should be false for sports that already have a real model
 * wired into their own adapter.ts (mlb, golf) — merging pick_history data
 * on top there would be redundant, not just unnecessary, since those
 * sports' subjectMeta.modelProb already reflects their own real,
 * independently-fitted model, not the generic Beta-Binomial one this
 * table holds for the other five sports.
 */
export function usePickHistoryModelData(sport: string, refreshKey: string | null | undefined, enabled: boolean): PickHistoryModelDataState {
  const [state, setState] = useState<PickHistoryModelDataState>({ rowsByKey: new Map(), loading: true });

  useEffect(() => {
    if (!enabled) {
      setState({ rowsByKey: new Map(), loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void (async () => {
      try {
        const res = await fetch(`/api/picks/model-data?sport=${sport}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState({ rowsByKey: new Map(), loading: false });
          return;
        }
        const data: { rows: PickHistoryModelRow[] } = await res.json();
        const map = new Map<string, PickHistoryModelRow>();
        for (const row of data.rows ?? []) {
          map.set(modelDataKey(row.subjectId, row.dimension, row.gameId), row);
        }
        setState({ rowsByKey: map, loading: false });
      } catch {
        if (!cancelled) setState({ rowsByKey: new Map(), loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, refreshKey, enabled]);

  return state;
}

/**
 * Phase 1 of docs/scan-playerdetail-parity-gameplan-2026-08-27.md — the
 * five sports whose own adapter.ts never populates a real model, sharing
 * one real list rather than a `sport === 'nfl' || ...` copy at every call
 * site (Scan's AppShell.tsx, and one page.tsx per sport for PlayerDetail).
 */
export function needsModelDataMerge(sport: string): boolean {
  return sport === 'nfl' || sport === 'cfb' || sport === 'nba' || sport === 'nhl' || sport === 'soccer';
}

/**
 * Merges pick_history's real model_prob/sample_size/edge/market_prob/
 * price into each candidate's subjectMeta, matched by the same real
 * (subjectId, dimension, gamePk) key pick_history's own UNIQUE constraint
 * uses. Deliberately reads pick_history (the new, unified pipeline)
 * rather than extending the old MLB-shaped hasPropsPipeline/live-fetch
 * path to more sports — lib/odds/props/liveEdge.ts's resolveCandidateEdge
 * picks up subjectMeta.pickHistoryEdge automatically when present, and
 * lib/odds/props/propScore.ts's computePropScore already reads
 * subjectMeta.modelProb the same way MLB's/Golf's own adapters feed it.
 * A candidate with no matching row (game not yet reached by the
 * production job, or no real data yet) is returned unchanged — no
 * fabricated number, same "absent, not fabricated" rule this whole build
 * follows. The single real implementation both AppShell.tsx (Scan) and
 * every per-sport PlayerDetail page route call, so they can never drift
 * out of sync with each other.
 */
export function mergeModelData(candidates: PickCandidate[], rowsByKey: Map<string, PickHistoryModelRow>): PickCandidate[] {
  if (rowsByKey.size === 0) return candidates;
  return candidates.map((c) => {
    const gamePk = (c.subjectMeta as Record<string, unknown> | undefined)?.gamePk;
    const row = rowsByKey.get(modelDataKey(c.subjectId, c.dimension, gamePk as string | number | undefined));
    if (!row) return c;
    const hasEdgeData = row.price != null || row.marketProb != null || row.edge != null;
    return {
      ...c,
      subjectMeta: {
        ...(c.subjectMeta ?? {}),
        ...(row.modelProb != null ? { modelProb: row.modelProb, modelSampleSize: row.sampleSize ?? undefined } : {}),
        ...(hasEdgeData
          ? {
              pickHistoryEdge: {
                price: row.price,
                priceSource: row.priceSource ?? undefined,
                bookmaker: row.bookmaker ?? undefined,
                edge: row.edge,
                marketProb: row.marketProb,
              },
            }
          : {}),
      },
    };
  });
}
