'use client';

import { useEffect, useMemo, useState } from 'react';
import { isMarketAllowedForGoodBets } from '@/lib/odds/goodBets';
import type { MarketTrust } from '@/lib/odds/props/marketTrust';

interface MarketCalibration {
  dimension: string;
  n: number;
  wins: number;
  brierScore: number | null;
}

interface GoodBetsRecord {
  wins: number;
  losses: number;
  total: number;
  winRate: number | null;
}

export interface ScoreTierRecord {
  grade: string;
  n: number;
  wins: number;
  winRate: number | null;
}

export interface MarketCalibrationState {
  byMarket: MarketCalibration[];
  /**
   * Dimension keys currently allowed to power live Good Bets — clears
   * `isMarketAllowedForGoodBets`'s bar (enough graded history, not on the
   * excluded-for-being-actively-bad list), which is looser than full
   * `isMarketTrusted` status. The retroactive win/loss record still holds
   * markets to the stricter `isMarketTrusted` line server-side.
   */
  trustedMarkets: Set<string>;
  /** The Good Bets engine's real, retroactive track record — see lib/db/client.ts's goodBetsRecord. */
  goodBetsRecord: GoodBetsRecord | null;
  /** Prop Score v1's Market Trust badge per dimension — separate concept from `trustedMarkets` above (live Brier Skill Score vs. raw Brier), see lib/odds/props/marketTrust.ts. */
  trustTiers: Map<string, MarketTrust>;
  /** Prop Score v1's own graded track record, by letter grade — see lib/db/client.ts's scoreRecord. */
  scoreRecord: ScoreTierRecord[];
  loading: boolean;
  error: string | null;
}

/**
 * Per-market calibration, fetched once per session — real calibration moves
 * slowly (it's an aggregate over every graded pick this app has ever seen),
 * so there's no value in re-polling it on Scan's 3-minute refresh cycle the
 * way live odds are. Feeds the Good Bets engine everywhere it's used: which
 * markets are currently trustworthy enough for an edge computed against them
 * to mean anything.
 *
 * `enabled` (default `true`) — set `false` when a parent has already fetched
 * this and is passing its result down instead (see `GameDetail`'s nested
 * `PlayerDetail`), same idiom as `usePropOdds`'s own `enabled` param.
 */
export function useMarketCalibration(enabled = true): MarketCalibrationState {
  const [byMarket, setByMarket] = useState<MarketCalibration[]>([]);
  const [record, setRecord] = useState<GoodBetsRecord | null>(null);
  const [trustTiersRaw, setTrustTiersRaw] = useState<Record<string, MarketTrust>>({});
  const [scoreRecordState, setScoreRecordState] = useState<ScoreTierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/props/calibration', { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setByMarket(json.byMarket ?? []);
        setRecord(json.goodBets ?? null);
        setTrustTiersRaw(json.trustTiers ?? {});
        setScoreRecordState(json.scoreRecord ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Fetch failed');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  const trustedMarkets = useMemo(() => {
    const set = new Set<string>();
    for (const m of byMarket) {
      if (isMarketAllowedForGoodBets(m.dimension, m.n)) set.add(m.dimension);
    }
    return set;
  }, [byMarket]);

  const trustTiers = useMemo(() => new Map(Object.entries(trustTiersRaw)), [trustTiersRaw]);

  return { byMarket, trustedMarkets, goodBetsRecord: record, trustTiers, scoreRecord: scoreRecordState, loading, error };
}
