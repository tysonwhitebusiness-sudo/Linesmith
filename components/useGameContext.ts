'use client';

import { useEffect, useState } from 'react';
import type { InjuryEntry, RecentGameResult } from '@/lib/sports/mlb/statsapi';

export interface TeamRecentContext {
  recent: RecentGameResult[];
  h2h: RecentGameResult[];
}

export interface GameContextState {
  injuries: Record<number, InjuryEntry[]>;
  recent: Record<number, TeamRecentContext>;
  loading: boolean;
}

/**
 * The two roster/schedule calls Game Detail needs that the slate snapshot
 * deliberately excludes (injuries, recent results) — costed at roughly 25s
 * added latency across a whole slate, but cheap for the two teams one game
 * page actually shows. Fetched together since both key off the same pair of
 * team ids.
 */
export function useGameContext(awayTeamId?: number, homeTeamId?: number): GameContextState {
  const [injuries, setInjuries] = useState<Record<number, InjuryEntry[]>>({});
  const [recent, setRecent] = useState<Record<number, TeamRecentContext>>({});
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
        const [injuriesRes, recentRes] = await Promise.all([
          fetch(`/api/mlb/injuries?teamIds=${awayTeamId},${homeTeamId}`, { signal: controller.signal }),
          // 45 days rather than the route's default 25: head-to-head reads off
          // this same window, and two teams often don't meet again inside 25
          // days. Still short of a full season (~130+ days) — the Records
          // panel's H2H tab discloses the window rather than implying it's
          // exhaustive.
          fetch(`/api/mlb/recent?teamA=${awayTeamId}&teamB=${homeTeamId}&days=45`, { signal: controller.signal }),
        ]);
        if (injuriesRes.ok) {
          const json = await injuriesRes.json();
          setInjuries(json.byTeam ?? {});
        }
        if (recentRes.ok) {
          const json = await recentRes.json();
          setRecent({ [awayTeamId]: json[awayTeamId], [homeTeamId]: json[homeTeamId] });
        }
      } catch {
        // AbortError on unmount/team change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [awayTeamId, homeTeamId]);

  return { injuries, recent, loading };
}
