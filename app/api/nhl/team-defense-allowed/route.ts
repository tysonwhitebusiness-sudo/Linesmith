/**
 * NHL's real team-defense-allowed leaderboard (points allowed to Forwards/
 * Defensemen, last 15 real games per team, ranked) — see
 * docs/matchup-card-rebuild-gameplan-2026-08-23.md §6/§8. Built entirely
 * from `nhle.ts`'s already-proven-live `fetchBoxscore`/schedule fetchers,
 * unlike NBA's equivalent.
 */

import { cachedRoute } from '@/lib/cachedRoute';
import { buildNhlTeamDefenseAllowedIndex } from '@/lib/sports/nhl/teamDefenseAllowed';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'nhl:defenseAllowed:route',
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const index = await buildNhlTeamDefenseAllowedIndex();
      return { teams: [...index.values()], fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'NHL team defense-allowed lookup failed',
    request,
  });
}
