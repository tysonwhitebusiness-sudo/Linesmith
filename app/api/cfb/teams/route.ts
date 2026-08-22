import { fetchAllTeams, fetchStandings } from '@/lib/sports/cfb/espn';
import type { TeamStandingRow } from '@/components/useAllTeams';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000; // matches fetchStandings's own 30min TTL

/**
 * Every real FBS team (espn.ts's FBS-filtered list) joined with real
 * conference standings — a team ESPN's standings hasn't ranked yet still
 * gets a real row with 0s rather than being dropped, same as soccer's
 * teams route.
 */
export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'cfb:teams:route',
    ttlMs: CACHE_TTL_MS,
    request,
    errorMessage: 'CFB teams failed',
    build: async () => {
      const [teams, standings] = await Promise.all([fetchAllTeams(), fetchStandings()]);
      const standingsByTeamId = new Map(standings.map((s) => [s.teamId, s]));
      const rows: TeamStandingRow[] = teams.map((t) => {
        const s = standingsByTeamId.get(t.teamId);
        return {
          teamId: Number(t.teamId),
          name: t.name,
          abbreviation: t.abbreviation,
          logoUrl: t.logoUrl ?? '',
          leagueName: 'College Football',
          divisionName: s?.groupName ?? 'FBS',
          divisionShortName: s?.groupName ?? 'FBS',
          wins: s?.wins ?? 0,
          losses: s?.losses ?? 0,
          divisionRank: s ? String(s.rank) : '',
          gamesBack: '',
          lastTen: null,
        };
      });
      return { teams: rows };
    },
  });
}
