'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TeamResearchPayload } from '@/lib/sports/shared/teamResearchShapes';

export interface TeamResearchState<P extends TeamResearchPayload = TeamResearchPayload> {
  data: P | null;
  loading: boolean;
  /** Human text. */
  error: string | null;
  reload: () => void;
}

/**
 * A team page's research payload (R7) — `/api/team-research`. An undefined
 * sport or team idles the hook, so a host can call it unconditionally (rules of
 * hooks) without firing a request for a sport that has no reader (R2-F7 was
 * exactly that: MLB team requests from every other sport's page).
 */
export function useTeamResearch<P extends TeamResearchPayload = TeamResearchPayload>(sport?: string, teamId?: number | string): TeamResearchState<P> {
  const [state, setState] = useState<Omit<TeamResearchState<P>, 'reload'>>({ data: null, loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!sport || teamId == null || teamId === '') {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Cleared on a change of team, so one team's numbers never sit under another's name.
    setState({ data: null, loading: true, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/team-research?sport=${encodeURIComponent(sport)}&teamId=${encodeURIComponent(String(teamId))}`, { signal: controller.signal });
        if (res.status === 404) setState({ data: null, loading: false, error: 'This team was not found.' });
        else if (!res.ok) setState({ data: null, loading: false, error: "Couldn't load this team's page." });
        else setState({ data: (await res.json()) as P, loading: false, error: null });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: "Couldn't load this team's page." });
      }
    })();
    return () => controller.abort();
  }, [sport, teamId, attempt]);

  return { ...state, reload };
}
