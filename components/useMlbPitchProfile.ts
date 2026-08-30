'use client';

import { useEffect, useState } from 'react';
import type { PitchProfile } from '@/lib/sports/mlb/pitchProfileShapes';

export interface MlbPitchProfileState {
  profile: PitchProfile | null;
  loading: boolean;
}

/**
 * One subject's pitch-level Statcast profile — the client half of Phase 6.6.
 *
 * Feeds MLB's `usageMix` (pitch mix) and `spatialGrid` (strike zone) roles,
 * the two the adapter had to leave `null` until `mlb_pitch_events` existed.
 *
 * Same shape as `useTeamStatcast` deliberately: an `AbortController`, an
 * `enabled` gate expressed as an undefined argument rather than a branch on the
 * hook call itself (rules of hooks — `PlayerDetail.tsx` calls this on every
 * render for every sport, and it simply does not fetch for the seven that have
 * no pitches).
 *
 * WHY THIS IS ITS OWN FETCH AND NOT PART OF THE SNAPSHOT: the slate snapshot is
 * built for Scan, which never shows a pitch mix. Putting a per-subject
 * pitch-level rollup in it would make every scan refresh pay for a number only
 * one page renders — the identical reasoning behind `useTeamStatcast` and
 * `useBullpen`.
 */
export function useMlbPitchProfile(
  role: 'pitcher' | 'batter',
  subjectId?: number,
  season?: number,
): MlbPitchProfileState {
  const [profile, setProfile] = useState<PitchProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (subjectId == null || season == null) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    // Cleared on every key change, not just on success: leaving the previous
    // subject's mix on screen while the next one loads is how a page ends up
    // showing one player's numbers under another player's name.
    setProfile(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/mlb/pitch-profile?role=${role}&subjectId=${subjectId}&season=${season}`,
          { signal: controller.signal },
        );
        if (res.ok) setProfile((await res.json()) as PitchProfile);
      } catch {
        // AbortError on unmount or subject change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [role, subjectId, season]);

  return { profile, loading };
}
