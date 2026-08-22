/**
 * Soccer data beyond teamSportEspn.ts's schedule/roster (today's/upcoming
 * games only): the full league team list, needed for a real Teams page and
 * for real team-logo URLs — neither the schedule nor the game-context
 * roster carries every club in the league, only whoever's playing in the
 * current date window.
 */

import type { SoccerLeague } from '@/lib/core/types';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

const ESPN_LEAGUE_SLUG: Record<SoccerLeague, string> = { epl: 'eng.1', mls: 'usa.1' };

export interface SoccerTeam {
  teamId: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

interface RawTeamsResponse {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{
        team: {
          id: string;
          displayName: string;
          abbreviation: string;
          logos?: Array<{ href: string; rel: string[] }>;
        };
      }>;
    }>;
  }>;
}

export async function fetchAllTeams(league: SoccerLeague): Promise<SoccerTeam[]> {
  const cacheKey = `soccer:teams:${league}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return JSON.parse(cached.payload) as SoccerTeam[];
  }

  const slug = ESPN_LEAGUE_SLUG[league];
  let res: Response;
  try {
    res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams?limit=50`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return cached ? (JSON.parse(cached.payload) as SoccerTeam[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as SoccerTeam[]) : [];

  const json = (await res.json()) as RawTeamsResponse;
  const raw = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const teams: SoccerTeam[] = raw.map((t) => ({
    teamId: t.team.id,
    name: t.team.displayName,
    abbreviation: t.team.abbreviation,
    logoUrl: t.team.logos?.find((l) => l.rel.includes('default'))?.href ?? t.team.logos?.[0]?.href ?? null,
  }));

  await writeSnapshotCache(cacheKey, JSON.stringify(teams));
  return teams;
}

/** Cheap `abbr -> logoUrl` lookup for anywhere that only has a team abbreviation on hand (candidates, roster entries) — cached the same 24h as `fetchAllTeams` itself. */
export async function soccerTeamLogoByAbbr(league: SoccerLeague): Promise<Map<string, string>> {
  const teams = await fetchAllTeams(league);
  return new Map(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));
}
