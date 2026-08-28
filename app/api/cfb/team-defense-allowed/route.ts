/**
 * CFB's real team-defense-allowed leaderboard (every FBS team's real
 * passing/rushing/receiving yards allowed per game, ranked) — the data
 * source for the universal matchup card's position-group tabs, see
 * docs/matchup-card-rebuild-gameplan-2026-08-23.md §6/§8.
 *
 * `buildCfbTeamDefenseAllowedIndex()` already hand-rolls its own 24h
 * snapshot cache for the computed index (same precedent as `cfbd.ts`'s own
 * per-team fetch caching) — this route wraps it in `cachedRoute()` on top
 * (distinct cache key, no collision) so the *page-load* path never blocks
 * on a cold ~130-team rebuild the way a bare call would; that rebuild
 * happens once in the background and every request in between serves the
 * (possibly slightly stale) already-cached leaderboard instantly.
 */

import { cachedRoute } from '@/lib/cachedRoute';
import { buildCfbTeamDefenseAllowedIndex } from '@/lib/sports/cfb/teamDefenseAllowed';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'cfb:defenseAllowed:route',
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const index = await buildCfbTeamDefenseAllowedIndex();
      return { teams: [...index.values()], fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'CFB team defense-allowed lookup failed',
    request,
  });
}
