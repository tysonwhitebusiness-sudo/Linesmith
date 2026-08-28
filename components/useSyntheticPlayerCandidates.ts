'use client';

import { useEffect, useState } from 'react';
import type { PickCandidate, Sport } from '@/lib/core/types';

export interface SyntheticCandidatesParams {
  sport: Sport;
  subjectId: string | null;
  team?: string;
  position?: string;
  name?: string;
  headshotUrl?: string;
  teamLogoUrl?: string;
  /** Tennis only — its routes nest under /api/tennis/[tour]/..., unlike every other sport. */
  tour?: string;
  /** Soccer only — its routes nest under /api/soccer/[league]/..., same reason as tennis's `tour`. */
  league?: string;
  enabled: boolean;
}

/**
 * On-demand real per-market candidates for a player with no active real
 * `prop_odds` row — GET /api/{sport}/player/{id}/candidates. Only sports
 * with that route wired (NHL first; see lib/sports/nhl/adapter.ts's
 * `buildSyntheticPlayerCandidates`) should ever set `enabled: true`.
 */
export function useSyntheticPlayerCandidates(p: SyntheticCandidatesParams): { candidates: PickCandidate[]; loading: boolean } {
  const [candidates, setCandidates] = useState<PickCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!p.enabled || !p.subjectId) {
      setCandidates([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const qs = new URLSearchParams();
    if (p.team) qs.set('team', p.team);
    if (p.position) qs.set('pos', p.position);
    if (p.name) qs.set('name', p.name);
    if (p.headshotUrl) qs.set('headshot', p.headshotUrl);
    if (p.teamLogoUrl) qs.set('teamLogo', p.teamLogoUrl);

    const path =
      p.sport === 'tennis' && p.tour
        ? `/api/tennis/${p.tour}/player/${encodeURIComponent(p.subjectId!)}/candidates`
        : p.sport === 'soccer' && p.league
          ? `/api/soccer/${p.league}/player/${encodeURIComponent(p.subjectId!)}/candidates`
          : `/api/${p.sport}/player/${encodeURIComponent(p.subjectId!)}/candidates`;

    void (async () => {
      try {
        const res = await fetch(`${path}?${qs.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Player candidates request failed (${res.status})`);
        setCandidates((json.candidates ?? []) as PickCandidate[]);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setCandidates([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.enabled, p.subjectId, p.team, p.position, p.name, p.headshotUrl, p.teamLogoUrl, p.sport, p.tour, p.league]);

  return { candidates, loading };
}

export default useSyntheticPlayerCandidates;
