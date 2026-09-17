/**
 * GET /api/player-peers?sport=nba&athleteId=4278073
 *
 * The compare control's peer list — R10.2. Players of the same kind as this
 * one, newest season, ordered by the R5b production score, named.
 *
 * WHY THE SERVER BUILDS IT. `player_game_history` holds no names, and the
 * crosswalk only covers MLB and the NHL (R10.2's note in `compareServer.ts`), so
 * the rest are named from each league's team rosters — one call per team, which
 * belongs nowhere near a browser.
 *
 * CACHING — pattern 1 (`cachedRoute`). TTL 6 hours: the list is a season's
 * producers ordered by a score the rollup rewrites once a day, and the names
 * behind it change when a roster does.
 *
 * CACHE KEY — `player-peers:route:v1:{sport}:{group}:{season}`. Keyed on the
 * GROUP, not the player: every guard in the league shares one list, so a page
 * for any of them warms it for the rest.
 */

import { NextResponse } from 'next/server';
import { BadRequest, entityId } from '@/lib/apiValidation';
import { cachedRoute } from '@/lib/cachedRoute';
import { pgAll } from '@/lib/db/pgClient';
import { playerGroup, readPeers } from '@/lib/sports/shared/compareServer';
import type { PlayerPeersPayload } from '@/lib/sports/shared/compareShapes';
import { isTeamProductionSport } from '@/lib/sports/shared/teamProductionShapes';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') ?? '';
  const athleteId = url.searchParams.get('athleteId') ?? '';

  try {
    if (!isTeamProductionSport(sport)) throw new BadRequest(`sport must be a rollup sport, not ${JSON.stringify(sport)}`);
    const athlete = entityId(athleteId);
    const group = await playerGroup(sport, athlete);
    const seasonRow = await pgAll<{ season: number }>(
      `SELECT max(season) AS season FROM player_season_production WHERE sport = ?`,
      [sport],
    );
    const season = seasonRow[0]?.season != null ? Number(seasonRow[0].season) : null;

    return await cachedRoute<PlayerPeersPayload>({
      cacheKey: `player-peers:route:v1:${sport}:${group ?? 'none'}:${season ?? 'none'}`,
      ttlMs: CACHE_TTL_MS,
      build: async () => ({
        sport,
        group,
        season,
        peers: season != null && group ? await readPeers(sport, group, season) : [],
        fetchedAt: new Date().toISOString(),
      }),
    });
  } catch (e) {
    if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
