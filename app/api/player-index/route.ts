/**
 * GET /api/player-index?sport=nfl&league=
 *
 * Every player a sport holds, for the Players tab's own list — R10.5. Slate
 * independent by construction: it reads what has been played, not what is on
 * today. See `playerIndexServer.ts` for why the list and the names come from
 * where they do.
 *
 * CACHING — pattern 1 (`cachedRoute`). TTL 6 hours: the list changes when a
 * season's rollup is rewritten (daily) or a roster does.
 *
 * CACHE KEY — `player-index:route:v2:{sport}`, grepped before it was chosen.
 */

import { NextResponse } from 'next/server';
import { BadRequest } from '@/lib/apiValidation';
import { cachedRoute } from '@/lib/cachedRoute';
import { readPlayerIndex, type PlayerIndexPayload } from '@/lib/sports/shared/playerIndexServer';
import { historySportFor } from '@/lib/sports/shared/playerResearchShapes';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') ?? '';
  const league = url.searchParams.get('league');

  try {
    const historySport = historySportFor(sport, league);
    if (!historySport) {
      // Golf has no per-game history table, so it has no index to serve; its
      // field is the tournament's, which the snapshot already carries.
      throw new BadRequest(`no player index for ${JSON.stringify(sport)}`);
    }
    return await cachedRoute<PlayerIndexPayload>({
      cacheKey: `player-index:route:v2:${historySport}`,
      ttlMs: CACHE_TTL_MS,
      build: () => readPlayerIndex(historySport),
    });
  } catch (e) {
    if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
