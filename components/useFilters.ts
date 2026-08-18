'use client';

import { useCallback, useState } from 'react';
import type { PickCandidate } from '@/lib/core/types';

export interface FilterState {
  /** Game PKs to include (empty = all). */
  gamePks: Set<number>;
  /** Dimension keys to include (empty = all). */
  dimensions: Set<string>;
  /** Rolling window size for hit-rate calcs (0 = no window filter). */
  window: number;
  /** Team abbreviations to include (empty = all). */
  teams: Set<string>;
  /** Minimum / maximum American odds (null = no bound). Applied post-candidate, since price is resolved per-row, not stored on the candidate. */
  oddsMin: number | null;
  oddsMax: number | null;
  /** Whether candidates with no resolvable price at all still show up (true = show them, the default — see AppShell's Good Bets comment on why a missing price isn't treated as a bad one). Off hides them, same as if they'd failed an odds range check. */
  showNoOdds: boolean;
  /** Minimum hit-rate percentage (null = no threshold). */
  hitRateMin: number | null;
  /** Player name search (empty = all). */
  playerSearch: string;
  /** Sportsbook/app to price against (null = best available). Applied post-candidate, same reason as odds. */
  sportsbook: string | null;
  /** Only candidates on a hot streak (scanMovers). Applied post-candidate — computed relative to the whole pool. */
  hotStreak: boolean;
  /** Only candidates on a cold streak. Shown together with hotStreak when both are on, rather than intersected to nothing. */
  coldStreak: boolean;
  /** Only candidates flagged consistent (candidate.consistent). */
  consistentOnly: boolean;
  /** Only candidates that clear the Good Bets bar (lib/odds/goodBets.ts). Applied post-candidate — needs live price + calibration trust. */
  goodBetOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  gamePks: new Set(),
  dimensions: new Set(),
  window: 0,
  teams: new Set(),
  oddsMin: null,
  oddsMax: null,
  showNoOdds: true,
  hitRateMin: null,
  playerSearch: '',
  sportsbook: null,
  hotStreak: false,
  coldStreak: false,
  consistentOnly: false,
  goodBetOnly: false,
};

/** True when any filter is non-default. */
export function filtersActive(f: FilterState): boolean {
  return (
    f.gamePks.size > 0 ||
    f.dimensions.size > 0 ||
    f.window > 0 ||
    f.teams.size > 0 ||
    f.oddsMin !== null ||
    f.oddsMax !== null ||
    !f.showNoOdds ||
    f.hitRateMin !== null ||
    f.playerSearch.trim() !== '' ||
    f.sportsbook !== null ||
    f.hotStreak ||
    f.coldStreak ||
    f.consistentOnly ||
    f.goodBetOnly
  );
}

/** Count of active filter dimensions (for badge display). */
export function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.gamePks.size > 0) n += 1;
  if (f.dimensions.size > 0) n += 1;
  if (f.window > 0) n += 1;
  if (f.teams.size > 0) n += 1;
  if (f.oddsMin !== null || f.oddsMax !== null || !f.showNoOdds) n += 1;
  if (f.hitRateMin !== null) n += 1;
  if (f.playerSearch.trim() !== '') n += 1;
  if (f.sportsbook !== null) n += 1;
  if (f.hotStreak) n += 1;
  if (f.coldStreak) n += 1;
  if (f.consistentOnly) n += 1;
  if (f.goodBetOnly) n += 1;
  return n;
}

/**
 * Every setter is memoised.
 *
 * Not a micro-optimisation: these are legitimate `useEffect` dependencies (the
 * sport switch clears the game filter, for instance), and a setter rebuilt on
 * each render turns any such effect into an infinite update loop. Stable
 * identities make them safe to depend on.
 */
export function useFilters() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const toggleGame = useCallback((gamePk: number) => {
    setFilters((prev) => {
      const next = new Set(prev.gamePks);
      if (next.has(gamePk)) next.delete(gamePk);
      else next.add(gamePk);
      return { ...prev, gamePks: next };
    });
  }, []);

  const setGamePks = useCallback((gamePks: Set<number>) => {
    setFilters((prev) => ({ ...prev, gamePks }));
  }, []);

  const toggleDimension = useCallback((dimension: string) => {
    setFilters((prev) => {
      const next = new Set(prev.dimensions);
      if (next.has(dimension)) next.delete(dimension);
      else next.add(dimension);
      return { ...prev, dimensions: next };
    });
  }, []);

  const toggleTeam = useCallback((team: string) => {
    setFilters((prev) => {
      const next = new Set(prev.teams);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return { ...prev, teams: next };
    });
  }, []);

  const setWindow = useCallback((window: number) => {
    setFilters((prev) => ({ ...prev, window }));
  }, []);

  const setOddsRange = useCallback((min: number | null, max: number | null) => {
    setFilters((prev) => ({ ...prev, oddsMin: min, oddsMax: max }));
  }, []);

  const toggleShowNoOdds = useCallback(() => {
    setFilters((prev) => ({ ...prev, showNoOdds: !prev.showNoOdds }));
  }, []);

  const setHitRateMin = useCallback((hitRateMin: number | null) => {
    setFilters((prev) => ({ ...prev, hitRateMin }));
  }, []);

  const setPlayerSearch = useCallback((playerSearch: string) => {
    setFilters((prev) => ({ ...prev, playerSearch }));
  }, []);

  const setSportsbook = useCallback((sportsbook: string | null) => {
    setFilters((prev) => ({ ...prev, sportsbook }));
  }, []);

  const toggleHotStreak = useCallback(() => {
    setFilters((prev) => ({ ...prev, hotStreak: !prev.hotStreak }));
  }, []);

  const toggleColdStreak = useCallback(() => {
    setFilters((prev) => ({ ...prev, coldStreak: !prev.coldStreak }));
  }, []);

  const toggleConsistentOnly = useCallback(() => {
    setFilters((prev) => ({ ...prev, consistentOnly: !prev.consistentOnly }));
  }, []);

  const toggleGoodBetOnly = useCallback(() => {
    setFilters((prev) => ({ ...prev, goodBetOnly: !prev.goodBetOnly }));
  }, []);

  const clearAll = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  return {
    filters,
    toggleGame,
    setGamePks,
    toggleDimension,
    toggleTeam,
    setWindow,
    setOddsRange,
    toggleShowNoOdds,
    setHitRateMin,
    setPlayerSearch,
    setSportsbook,
    toggleHotStreak,
    toggleColdStreak,
    toggleConsistentOnly,
    toggleGoodBetOnly,
    clearAll,
  };
}

/**
 * Apply all filters to a candidate list (AND logic).
 */
export function applyFilters(candidates: PickCandidate[], f: FilterState): PickCandidate[] {
  let result = candidates;

  // Game filter
  if (f.gamePks.size > 0) {
    result = result.filter((c) => {
      const meta = c.subjectMeta as Record<string, unknown> | undefined;
      return meta?.gamePk !== undefined && f.gamePks.has(Number(meta.gamePk));
    });
  }

  // Dimension filter
  if (f.dimensions.size > 0) {
    result = result.filter((c) => f.dimensions.has(c.dimension));
  }

  // Team filter
  if (f.teams.size > 0) {
    result = result.filter((c) => {
      const meta = c.subjectMeta as Record<string, unknown> | undefined;
      const team = typeof meta?.team === 'string' ? meta.team : undefined;
      return team ? f.teams.has(team) : false;
    });
  }

  // Window filter — only show candidates with at least N observed periods
  if (f.window > 0) {
    result = result.filter((c) => c.history.length >= f.window);
  }

  // Hit-rate threshold filter
  if (f.hitRateMin !== null) {
    result = result.filter((c) => {
      if (c.consistent && c.sampleSize >= 3) return true; // consistent always passes
      const hits = c.history.filter((h) => h.category === c.category).length;
      const rate = c.history.length > 0 ? hits / c.history.length : 0;
      return rate * 100 >= f.hitRateMin!;
    });
  }

  // Player name search
  if (f.playerSearch.trim() !== '') {
    const query = f.playerSearch.trim().toLowerCase();
    result = result.filter((c) => c.subjectName.toLowerCase().includes(query));
  }

  // Consistent-only
  if (f.consistentOnly) {
    result = result.filter((c) => c.consistent);
  }

  // Odds range, sportsbook, hot/cold streak, and Good-Bet-only are applied at
  // display level (AppShell's `filtered`/`views`) — each needs live price or
  // calibration data resolved per-row, or a comparison against the whole
  // candidate pool (hot/cold), neither of which this pure candidate-only
  // function has access to.

  return result;
}
