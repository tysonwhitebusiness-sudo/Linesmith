import { NextResponse } from 'next/server';
import { fetchAllTeams } from '@/lib/sports/soccer/espn';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60_000;

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

/**
 * All clubs in the league, via ESPN's real teams endpoint (not the
 * scoreboard, which only lists whoever's playing in the current date
 * window). No standings source is wired yet (a real, open gap — see
 * docs/soccer-gameplan-2026-08-22.md §6c/§7.7) — wins/losses stay 0
 * honestly rather than fabricating a record.
 */
export async function GET(request: Request, { params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  if (!isSoccerLeague(league)) {
    return NextResponse.json({ error: `Unknown league "${league}"` }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `soccer:teams:route:${league}`,
    ttlMs: CACHE_TTL_MS,
    request,
    errorMessage: 'Soccer teams failed',
    build: async () => {
      const teams = await fetchAllTeams(league);
      const rows: TeamStandingRow[] = teams.map((t) => ({
        teamId: Number(t.teamId),
        name: t.name,
        abbreviation: t.abbreviation,
        logoUrl: t.logoUrl ?? '',
        leagueName: league === 'epl' ? 'Premier League' : 'MLS',
        divisionName: '',
        divisionShortName: '',
        wins: 0,
        losses: 0,
        divisionRank: '',
        gamesBack: '',
        lastTen: null,
      }));
      return { teams: rows };
    },
  });
}
