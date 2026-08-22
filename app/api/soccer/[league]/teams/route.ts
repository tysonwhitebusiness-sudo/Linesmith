import { NextResponse } from 'next/server';
import { fetchAllTeams, fetchStandings } from '@/lib/sports/soccer/espn';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60_000; // matches fetchStandings's own 30min TTL — no point serving staler than the source

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

/**
 * All clubs in the league (ESPN's real teams endpoint, not the scoreboard,
 * which only lists whoever's playing in the current date window) joined
 * with real standings (docs/soccer-gameplan-2026-08-22.md §11 — the gap
 * that used to leave every team showing "Record unavailable" is closed).
 * A team ESPN's standings hasn't ranked yet (rare, e.g. brand new to the
 * league) still gets a real row with 0s rather than being dropped.
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
      const [teams, standings] = await Promise.all([fetchAllTeams(league), fetchStandings(league)]);
      const standingsByTeamId = new Map(standings.map((s) => [s.teamId, s]));
      const leagueName = league === 'epl' ? 'Premier League' : 'MLS';
      const rows: TeamStandingRow[] = teams.map((t) => {
        const s = standingsByTeamId.get(t.teamId);
        return {
          teamId: Number(t.teamId),
          name: t.name,
          abbreviation: t.abbreviation,
          logoUrl: t.logoUrl ?? '',
          leagueName,
          divisionName: s?.groupName ?? leagueName,
          divisionShortName: s?.groupName ?? leagueName,
          wins: s?.wins ?? 0,
          losses: s?.losses ?? 0,
          divisionRank: s ? String(s.rank) : '',
          gamesBack: '',
          lastTen: null,
          draws: s?.draws ?? 0,
          points: s?.points ?? 0,
          goalDifferential: s?.goalDifferential ?? 0,
        };
      });
      return { teams: rows };
    },
  });
}
