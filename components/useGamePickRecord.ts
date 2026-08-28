'use client';

import { useEffect, useState } from 'react';
import type { StakeSuggestion } from '@/lib/core/kelly';
import type { Sport } from '@/lib/core/types';

export interface ConfidenceGrade {
  letter: string;
  pct: number;
}

export interface MoneylinePickView {
  pickSide: 'home' | 'away' | null;
  pickTeamName: string | null;
  price: number | null;
  confidence: ConfidenceGrade | null;
  probLower: number | null;
  probUpper: number | null;
  stake: StakeSuggestion | null;
  locked: boolean;
  late: boolean;
  changed: boolean;
  initialTeamName: string | null;
  outcome: 'win' | 'loss' | null;
  simulatedProfit: number | null;
}

export interface TotalPickView {
  pickSide: 'over' | 'under' | null;
  line: number | null;
  price: number | null;
  confidence: ConfidenceGrade | null;
  probLower: number | null;
  probUpper: number | null;
  stake: StakeSuggestion | null;
  locked: boolean;
  late: boolean;
  changed: boolean;
  initialSide: 'over' | 'under' | null;
  initialLine: number | null;
  outcome: 'win' | 'loss' | null;
  simulatedProfit: number | null;
}

export interface GamePickView {
  gameId: string;
  matchup: string | null;
  awayTeamId: number | null;
  homeTeamId: number | null;
  awayTeamName: string | null;
  homeTeamName: string | null;
  commenceTime: string | null;
  finalScore: { home: number; away: number } | null;
  moneyline: MoneylinePickView;
  total: TotalPickView;
}

export interface GamePickRecordTotals {
  wins: number;
  losses: number;
}

export interface GamePickHistoryState {
  record: { moneyline: GamePickRecordTotals; total: GamePickRecordTotals } | null;
  rows: GamePickView[];
  loading: boolean;
  error: string | null;
}

/**
 * The Linesmith Pick lock system's record + per-game history — fresh since
 * the lock system launched (the table has no earlier rows by construction),
 * distinct from the older Good Bets record (lib/db/client.ts's
 * `goodBetsRecord`), which retroactively grades any surfaced candidate that
 * would have cleared the edge bar. This is the actual pick this app made and
 * locked in advance, win or lose.
 */
export function useGamePickHistory(sport: Sport, refreshMs = 5 * 60 * 1000, date?: string): GamePickHistoryState {
  const [record, setRecord] = useState<GamePickHistoryState['record']>(null);
  const [rows, setRows] = useState<GamePickView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const qs = new URLSearchParams({ sport });
        if (date) qs.set('date', date);
        const res = await fetch(`/api/picks/game-history?${qs.toString()}`, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setRecord(json.record ?? null);
        setRows(json.rows ?? []);
        setError(null);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!cancelled) setError(err instanceof Error ? err.message : 'Fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const interval = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [sport, refreshMs, date]);

  return { record, rows, loading, error };
}
