/**
 * GET /api/player-pool?sport=nfl&athleteId=4430807
 *
 * C2.1 — the season pool a player-page hero tile is ranked in: every player
 * in this one's position group, with his season totals, for the rollup's two
 * newest seasons. The page ranks its own tiles from it (`playerPool.ts`), so
 * a rank is always the same math as the number beside it.
 *
 * CACHING — pattern 1 (`cachedRoute`). TTL 6 hours: the rollup is rewritten
 * once a day, the same reasoning as `/api/player-peers`.
 *
 * CACHE KEY — `player-pool:route:v1:{sport}:{group}`. Keyed on the GROUP, not
 * the player: every running back shares one pool.
 */

import { NextResponse } from 'next/server';
import { BadRequest, entityId } from '@/lib/apiValidation';
import { cachedRoute } from '@/lib/cachedRoute';
import { playerGroup } from '@/lib/sports/shared/compareServer';
import type { PlayerPool } from '@/lib/sports/shared/playerPool';
import { readPlayerPool } from '@/lib/sports/shared/playerPoolServer';
import { isTeamProductionSport } from '@/lib/sports/shared/teamProductionShapes';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') ?? '';
  const athleteId = url.searchParams.get('athleteId') ?? '';
  try {
    if (!isTeamProductionSport(sport)) throw new BadRequest(`sport must be a rollup sport, not ${JSON.stringify(sport)}`);
    const group = await playerGroup(sport, entityId(athleteId));
    if (!group) return NextResponse.json({ pool: null });
    return await cachedRoute<{ pool: PlayerPool }>({
      cacheKey: `player-pool:route:v1:${sport}:${group}`,
      ttlMs: CACHE_TTL_MS,
      build: async () => ({ pool: await readPlayerPool(sport, group) }),
    });
  } catch (e) {
    if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
