'use client';

import { useEffect, useState } from 'react';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregateShapes';

export interface SeasonRanksState {
  data: SeasonAggregateResult | null;
  loading: boolean;
}

/**
 * League-wide season aggregates and ranks for one sport — Phase 6.1b/6.2b.
 *
 * Feeds three blocks that were blank on NBA, NHL and tennis for want of ranks:
 * the game page's stat comparison, and the team page's stat groups and unit
 * grades. See `lib/sports/shared/seasonAggregates.ts` for why one rollup
 * serves all three.
 *
 * CALLED UNCONDITIONALLY, per the sport-adapter convention's rules-of-hooks
 * rule (`CLAUDE.md` §3) — pass `undefined` for a sport that has no spec and it
 * idles without fetching, the same way `useNflGameDetail` idles on an MLB
 * page. The `sport` argument is `player_game_history`'s own vocabulary
 * (`tennis_atp`, not `tennis`), which is what the route validates against.
 *
 * `side: 'allowed'` ASKS THE SAME QUESTION FROM THE OTHER END -- what this
 * team gave up, from the same rows grouped by `opponent_id`. It is a second
 * call to the same route with its own cache entry, which is why a page that
 * wants both (a produced-vs-allowed matchup card) calls this hook twice rather
 * than making one endpoint return two payloads most callers would not read.
 *
 * ONE FETCH PER SPORT, NOT PER ENTITY. The response is the whole league keyed
 * by entity id, so both sides of a game read from a single request — and the
 * route behind it is heavily cached, because the underlying rollup is a real
 * scan (measured 11.7s NHL, 3.0s NBA, 37s tennis on a cold cache).
 */
export function useSeasonRanks(sport?: string, side: 'for' | 'allowed' = 'for'): SeasonRanksState {
  const [data, setData] = useState<SeasonAggregateResult | null>(null);
  const [loading, setLoading] = useState(Boolean(sport));

  useEffect(() => {
    if (!sport) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/season-ranks?sport=${encodeURIComponent(sport)}&side=${side}`, { signal: controller.signal });
        if (res.ok) setData((await res.json()) as SeasonAggregateResult);
      } catch {
        // AbortError on unmount/sport change — nothing to report.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [sport, side]);

  return { data, loading };
}

/**
 * The `player_game_history` sport value a page's `sport`/`league` maps to, or
 * `undefined` where no spec exists.
 *
 * Exists because the page's vocabulary and the table's are genuinely different
 * — `tennis` + tour vs `tennis_atp`/`tennis_wta` — the same mismatch
 * `CURRENT.md` §4 flags as having already cost a wrong assertion once.
 */
export function seasonRankSport(sport: string, league?: string): string | undefined {
  if (sport === 'nba' || sport === 'nhl' || sport === 'cfb') return sport;
  if (sport === 'tennis') return league === 'wta' ? 'tennis_wta' : league === 'atp' ? 'tennis_atp' : undefined;
  // Soccer splits by league for the reason tennis splits by tour: a mid-table
  // MLS side is not 14th in the Premier League, and `player_game_history`
  // already stores the two apart.
  if (sport === 'soccer') return league === 'mls' ? 'soccer_mls' : league === 'epl' ? 'soccer_epl' : undefined;
  return undefined;
}
