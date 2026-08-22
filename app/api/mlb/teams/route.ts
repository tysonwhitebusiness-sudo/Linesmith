/**
 * All 30 teams, grouped by league/division, with current standings.
 *
 * GET /api/mlb/teams
 *
 * The destination for the Teams top-nav tab and its index page. Split out
 * from the slate snapshot the same way injuries/recent/team are: Scan never
 * needs all 30 teams' identities, only the day's games.
 */

import { easternDate, getAllTeams, getStandings } from '@/lib/sports/mlb/statsapi';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

function mlbTeamLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

// getAllTeams/getStandings already carry their own in-process TTL caches
// (12h / 30min, statsapi.ts), but that's a plain in-memory Map reset on every
// server restart — the first request after each restart still pays the full
// external-call cost (measured 8.8s cold vs 284ms warm-in-process). This
// DB-persisted layer survives restarts, same as the per-team route fix.
// TTL matches the fastest-changing constituent (standings, 30min) so this
// layer never serves data staler than what the underlying source promises.
const CACHE_TTL_MS = 30 * 60 * 1000;

async function buildTeamsPayload() {
  const season = Number(easternDate().slice(0, 4));
  const [teams, standings] = await Promise.all([getAllTeams(), getStandings(season)]);

  const rows = teams.map((t) => {
    const record = standings.get(t.id);
    return {
      teamId: t.id,
      name: t.name,
      abbreviation: t.abbreviation,
      logoUrl: mlbTeamLogoUrl(t.id),
      leagueName: record?.leagueName || t.leagueName,
      divisionName: record?.divisionName || t.divisionName,
      divisionShortName: record?.divisionShortName || t.divisionShortName,
      wins: record?.wins ?? 0,
      losses: record?.losses ?? 0,
      divisionRank: record?.divisionRank ?? '',
      gamesBack: record?.gamesBack ?? '-',
      lastTen: record?.lastTen ?? null,
    };
  });

  return { teams: rows, fetchedAt: new Date().toISOString() };
}

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'mlb:teams',
    ttlMs: CACHE_TTL_MS,
    build: buildTeamsPayload,
    errorMessage: 'Teams lookup failed',
    request,
  });
}
