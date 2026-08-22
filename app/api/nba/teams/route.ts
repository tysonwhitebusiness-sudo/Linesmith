import { fetchAllTeams, fetchStandings } from '@/lib/sports/nba/espn';
import type { TeamStandingRow } from '@/components/useAllTeams';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000;

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'nba:teams:route',
    ttlMs: CACHE_TTL_MS,
    request,
    errorMessage: 'NBA teams failed',
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
          leagueName: 'NBA',
          divisionName: s?.groupName ?? 'NBA',
          divisionShortName: s?.groupName ?? 'NBA',
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
