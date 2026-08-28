'use client';

import { useEffect, useState } from 'react';

/**
 * Generic fetcher for the three new league-wide "team defense allowed"
 * leaderboards (CFB/NBA/NHL — `/api/{sport}/team-defense-allowed`), the
 * data source for the universal matchup card's position-group tabs and
 * custom-opponent picker (docs/matchup-card-rebuild-gameplan-2026-08-23.md
 * §6/§8). One shared hook instead of three near-identical copies, since all
 * three routes return the same `{ teams: T[] }` shape and differ only in
 * `T`'s own fields — same principle as `teamSportEspn.ts` for its own
 * cross-sport fetchers.
 *
 * `enabled: false` skips the fetch entirely (still runs the hook itself,
 * rules of hooks) — same gating idiom `useTeamStatcast`'s `teamId?`
 * parameter already uses, generalized to an explicit flag since this hook
 * has no natural "undefined" sentinel of its own.
 */
export function useTeamDefenseAllowed<T>(url: string, enabled: boolean): { teams: T[]; loading: boolean } {
  const [teams, setTeams] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) {
          const json = (await res.json()) as { teams?: T[] };
          setTeams(json.teams ?? []);
        }
      } catch {
        // AbortError on unmount, or a real fetch failure — either way, no data to show.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled]);

  return { teams, loading };
}
