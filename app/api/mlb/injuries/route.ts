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
import { BadRequest, entityIdList, knownId } from '@/lib/apiValidation';
import { MLB_TEAM_IDS } from '@/lib/sports/mlb/teamAliases';
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
  // Task 3.5, finding P4 H3. This previously accepted any list of any length
  // of any positive number, and built a cache key from it — so the key space
  // was every SUBSET of every integer, and `?teamIds=888801,888802` minted a
  // permanent row and fired real MLB API calls, unauthenticated.
  //
  // Capped at 2: this route exists to show both teams in one matchup, which is
  // its only caller's actual need. entityIdList also dedupes and sorts, which
  // the hand-rolled sort below used to do for the cache key alone.
  let sortedIds: number[];
  try {
    sortedIds = entityIdList(url.searchParams.get('teamIds'), 2, 'teamIds').map((id) => knownId(id, MLB_TEAM_IDS, 'teamId'));
  } catch (error) {
    if (error instanceof BadRequest) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const teamIds = sortedIds;

  const season = Number(easternDate().slice(0, 4));

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
