'use client';

import { useEffect, useState } from 'react';
import type { TeamHistory } from '@/lib/history/teamHistoryShapes';

export interface TeamHistoryState {
  data: TeamHistory | null;
  loading: boolean;
  /** Human text. */
  error: string | null;
}

/**
 * A franchise's record season by season (R12b) — `/api/history/results?view=history`,
 * a day-cached summary of every season `game_result` holds. An undefined sport
 * or team idles the hook, so the page calls it unconditionally (rules of hooks)
 * without a request for a sport that has no history.
 */
export function useTeamHistory(sport?: string, teamId?: number | string): TeamHistoryState {
  const [state, setState] = useState<TeamHistoryState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!sport || teamId == null || teamId === '' || teamId === 0 || teamId === '0') {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/history/results?sport=${encodeURIComponent(sport)}&teamId=${encodeURIComponent(String(teamId))}&view=history`, { signal: controller.signal });
        if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this team's history." });
        else setState({ data: (await res.json()) as TeamHistory, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this team's history." });
      }
    })();
    return () => controller.abort();
  }, [sport, teamId]);

  return state;
}
