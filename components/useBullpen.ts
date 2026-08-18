'use client';

import { useEffect, useState } from 'react';

export interface RankedPitcherSummary {
  personId: number;
  fullName: string;
  composite: number | null;
  overallRank: number | null;
  poolSize: number;
  /** Per-stat value/rank, keyed by PitcherRankKey (era, whip, kbbPct, ...) — the API route already sends the full RankedPitcher object, this just types the fields the Pitching matchup card reads to build a reliever's own scouting line when it's clicked into the comparison. */
  values?: Record<string, number>;
  ranks?: Record<string, number>;
}

export interface TeamBullpen {
  closer: RankedPitcherSummary | null;
  setup: RankedPitcherSummary[];
}

export interface BullpenState {
  byTeam: Record<number, TeamBullpen>;
  loading: boolean;
}

/**
 * Bullpen strength for the two teams on a game's page — split out of the
 * slate snapshot for the same reason `useGameContext`'s calls are: Scan
 * never shows this, so it has no business costing every scan refresh.
 */
export function useBullpen(awayTeamId?: number, homeTeamId?: number): BullpenState {
  const [byTeam, setByTeam] = useState<Record<number, TeamBullpen>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!awayTeamId || !homeTeamId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/mlb/bullpen?teamA=${awayTeamId}&teamB=${homeTeamId}`, { signal: controller.signal });
        if (res.ok) {
          const json = await res.json();
          setByTeam({ [awayTeamId]: json[awayTeamId], [homeTeamId]: json[homeTeamId] });
        }
      } catch {
        // AbortError on unmount/game change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [awayTeamId, homeTeamId]);

  return { byTeam, loading };
}
