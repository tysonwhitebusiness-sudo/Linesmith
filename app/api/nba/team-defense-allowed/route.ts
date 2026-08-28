/**
 * NBA's real team-defense-allowed leaderboard (points allowed to Guards/
 * Forwards/Centers, last 15 real games per team, ranked) — see
 * docs/matchup-card-rebuild-gameplan-2026-08-23.md §6/§8.
 *
 * Same `cachedRoute()`-over-a-self-caching-index shape as CFB's route —
 * see that route's comment for why the double layer isn't redundant.
 *
 * Verified live 2026-08-27 (Phase D of docs/x-signal-remaining-sports-
 * gameplan-2026-08-27.md) — real, sane 30-team data confirmed before any
 * X-signal wiring was built on top of it. See boxscore.ts's header for
 * detail.
 */

import { cachedRoute } from '@/lib/cachedRoute';
import { buildNbaTeamDefenseAllowedIndex } from '@/lib/sports/nba/teamDefenseAllowed';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'nba:defenseAllowed:route',
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const index = await buildNbaTeamDefenseAllowedIndex();
      return { teams: [...index.values()], fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'NBA team defense-allowed lookup failed',
    request,
  });
}
