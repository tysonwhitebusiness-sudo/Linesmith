/**
 * GET /api/player-compare?sport=nba&athleteId=4278073&teamId=13
 *
 * The compare control's server data — R10. Two things only: the league's teams
 * for the picker, and what one team gives up to this player's kind. The
 * player's own games against that team are computed by the page from the
 * history it already holds, so they are not fetched here (R10 Step 0).
 *
 * `teamId` is optional: without it the route answers with the picker's teams
 * and the player's group, which is what the page needs before a team is chosen.
 *
 * CACHING — pattern 1 (`cachedRoute`). The build is one directory call (itself
 * memoised for six hours) plus a league-wide rollup read per season tried. TTL
 * 30 minutes, matching `/api/team-research`: the rollups are rewritten once a
 * day by `teamProductionJob`, so this is never staler than its source.
 *
 * CACHE KEY — `player-compare:route:v1:{sport}:{athleteId}:{teamId}`, grepped
 * before it was chosen: nothing in `lib/`, `app/` or `components/` used a
 * `player-compare` prefix.
 */

import { NextResponse } from 'next/server';
import { BadRequest, entityId } from '@/lib/apiValidation';
import { cachedRoute } from '@/lib/cachedRoute';
import { playerGroup, readAllowCard, readCompareTeams } from '@/lib/sports/shared/compareServer';
import type { PlayerComparePayload } from '@/lib/sports/shared/compareShapes';
import { isTeamProductionSport } from '@/lib/sports/shared/teamProductionShapes';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') ?? '';
  const athleteId = url.searchParams.get('athleteId') ?? '';
  const teamParam = url.searchParams.get('teamId');

  try {
    if (!isTeamProductionSport(sport)) {
      // Tennis and golf have no team rollups at all; compare for them is R10.2's
      // player-against-player, not this route.
      throw new BadRequest(`sport must be one of the rollup sports, not ${JSON.stringify(sport)}`);
    }
    // The team page asks for the picker's teams alone (R10.3), so the athlete is
    // optional: without one there is no group and no allowed card to build.
    const athlete = athleteId ? entityId(athleteId) : null;
    const teamId = teamParam ? entityId(teamParam) : null;

    return await cachedRoute<PlayerComparePayload>({
      cacheKey: `player-compare:route:v1:${sport}:${athlete ?? 'teams'}:${teamId ?? 'none'}`,
      ttlMs: CACHE_TTL_MS,
      build: async () => {
        const [teams, group] = await Promise.all([readCompareTeams(sport), athlete ? playerGroup(sport, athlete) : null]);
        const allow = teamId && athlete ? await readAllowCard(sport, group, teamId) : null;
        return {
          sport,
          athleteId: athlete ?? '',
          teams,
          // The page knows the next opponent from its own slate; the server
          // offers the last team played, which needs no schedule.
          defaultTeamId: null,
          teamId,
          group,
          allow,
          fetchedAt: new Date().toISOString(),
        };
      },
    });
  } catch (e) {
    if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
