/**
 * Injury lists for specific teams.
 *
 * GET /api/mlb/injuries?teamIds=110,142
 *
 * Split out of the slate snapshot on purpose: this costs one roster request per
 * team, and folding a whole slate's worth into the snapshot put ~30 calls on
 * the critical path of Scan, which never shows injuries. Game Detail asks for
 * the two teams it is actually displaying.
 */

import { NextResponse } from 'next/server';
import { easternDate, getInjuries } from '@/lib/sports/mlb/statsapi';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// getInjuries shares statsapi.ts's roster cache (`roster:${teamId}:${season}`,
// 1h in-process TTL) — but that's a plain in-memory Map, reset on every
// server restart. Injury status genuinely doesn't change within minutes, so
// 30min here is well under the source's own 1h staleness tolerance while
// still surviving restarts, unlike the in-process layer alone.
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamIds = (url.searchParams.get('teamIds') ?? '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (teamIds.length === 0) {
    return NextResponse.json({ error: 'teamIds is required' }, { status: 400 });
  }

  const season = Number(easternDate().slice(0, 4));
  // Sorted so ?teamIds=110,142 and ?teamIds=142,110 share one cache row.
  const sortedIds = [...teamIds].sort((a, b) => a - b);

  return cachedRoute({
    cacheKey: `mlb:injuries:${season}:${sortedIds.join(',')}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const lists = await Promise.all(teamIds.map((id) => getInjuries(id, season)));
      return {
        byTeam: Object.fromEntries(teamIds.map((id, i) => [id, lists[i]])),
        // The league's roster reports that a player is unavailable and for how
        // long, but not what for. Stated here so the UI doesn't have to guess.
        injuryDetailAvailable: false,
        fetchedAt: new Date().toISOString(),
      };
    },
    errorMessage: 'Injury lookup failed',
    request,
  });
}
