'use client';

/**
 * Phase 2 — the validated prop model, delivered to Scan.
 *
 * Scan's rows come from the sport adapter's slate (odds, hit rates, streaks,
 * matchup). The MODEL comes from here: `/api/{sport}/projections`, a direct read
 * of `prop_model_cache` written by the Python serving jobs. Two sources, joined
 * per row, because they answer different questions — the adapter knows who is
 * playing and what the book is charging, the model knows what we project.
 *
 * WHY A SECOND FETCH RATHER THAN FOLDING IT INTO THE SNAPSHOT. The snapshot is
 * rebuilt from live schedule and stat feeds; the projection cache is rewritten
 * on its own hourly job. Joining them server-side would tie the board's model
 * numbers to the snapshot's rebuild cadence and give one more reason for a
 * snapshot to be slow. Keeping them separate also makes the failure modes
 * separate: the model going missing leaves Scan a working board without a
 * ranking, rather than an error page.
 *
 * ONLY MLB AND NHL HAVE A MODEL. Every other sport gets `null` and Scan renders
 * exactly as it did before — no rank column, no projection. That is the plan's
 * rule showing through the types: nothing unvalidated gets a number next to
 * something validated, and the other seven sports have not been fitted yet.
 */
import { useEffect, useState } from 'react';
import type { Sport } from '@/lib/core/types';
import type { StatsBoardData } from '@/lib/sports/nhl/adapters/statsBoardAdapter';
import { rankAcrossMarkets, type RankedRow } from '@/lib/sports/propRanking';

/** Sports with a fitted, gated prop model. Everything else has no projection pipe at all. */
const MODELLED: ReadonlySet<string> = new Set(['mlb', 'nhl']);

/**
 * Scan's dimension vocabulary against the model's.
 *
 * These are the same markets under two names, and the mismatch is a fossil: the
 * adapter's `hit-in-game` was named by the deleted edge pipeline for "does he
 * get a hit", while the fit names markets after the stat column they settle on
 * and prices the same proposition as `hits` at a 0.5 line. P(hits > 0.5) and
 * P(at least one hit) are the same event, so the join is real rather than
 * approximate.
 *
 * Every other shared market already agrees on its slug, which is why this map
 * has one entry rather than twenty. Kept as a map anyway: the next sport to be
 * fitted will almost certainly bring one of these, and a map with one entry is
 * a smaller thing to find than a special case buried in the join.
 */
const MODEL_DIMENSION_BY_SCAN_DIMENSION: Record<string, string> = {
  'hit-in-game': 'hits',
};

/** The model's key for a Scan candidate's dimension. */
export function modelDimensionFor(scanDimension: string): string {
  return MODEL_DIMENSION_BY_SCAN_DIMENSION[scanDimension] ?? scanDimension;
}

export function projectionKey(subjectId: string, scanDimension: string): string {
  return `${subjectId}|${modelDimensionFor(scanDimension)}`;
}

export interface ProjectionsState {
  /** Every ranked row, keyed by `${subjectId}|${modelDimension}`. Empty until loaded. */
  byKey: Map<string, RankedRow>;
  /** The board as served, for the market metadata and the empty-state reason. */
  data: StatsBoardData | null;
  /** When the serving job produced this slate. Null when nothing is served. */
  asOf: string | null;
  loading: boolean;
  /** Non-null when the fetch failed. Scan still renders; it just has no model column. */
  error: string | null;
  /** False for the seven sports with no fitted model, so callers can tell "none exists" from "failed to load". */
  supported: boolean;
}

const EMPTY: ProjectionsState = {
  byKey: new Map(),
  data: null,
  asOf: null,
  loading: false,
  error: null,
  supported: false,
};

export function useProjections(sport: Sport): ProjectionsState {
  const [state, setState] = useState<ProjectionsState>(EMPTY);

  useEffect(() => {
    if (!MODELLED.has(sport)) {
      setState(EMPTY);
      return;
    }
    let live = true;
    setState({ ...EMPTY, supported: true, loading: true });

    fetch(`/api/${sport}/projections`)
      .then((r) => {
        if (!r.ok) throw new Error(`projections unavailable (${r.status})`);
        return r.json() as Promise<StatsBoardData>;
      })
      .then((data) => {
        if (!live) return;
        const byKey = new Map<string, RankedRow>();
        // Ranked once here, over the whole served board, so every consumer sees
        // the same global position. Filtering re-ranks via `rankWithin`; it does
        // not re-derive the metric.
        for (const row of rankAcrossMarkets(data)) {
          byKey.set(`${row.subjectId}|${row.marketKey}`, row);
        }
        setState({
          byKey,
          data,
          asOf: data.asOf,
          loading: false,
          error: null,
          supported: true,
        });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setState({
          ...EMPTY,
          supported: true,
          error: e instanceof Error ? e.message : 'projections unavailable',
        });
      });

    return () => {
      live = false;
    };
  }, [sport]);

  return state;
}
