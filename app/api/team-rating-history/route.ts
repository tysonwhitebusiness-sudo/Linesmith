/**
 * GET /api/team-rating-history?sport=mlb&teamId=147
 *
 * One team's Elo trajectory — the read path for Phase 6.14's rating block.
 *
 * SPORT-AGNOSTIC BY CONSTRUCTION. Unlike `/api/nfl/target-map` or
 * `/api/nba/shot-profile`, there is nothing per-sport in this query beyond the
 * key itself: `team_elo_history` is one table holding all seven sport keys, so
 * one route serves all six team sports rather than six near-identical files.
 * `sport` here is the TABLE's vocabulary (`soccer_epl`, not `soccer`) — see
 * `teamRatingShapes.ts`, and the standing warning that different tables spell
 * the same sport differently.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. TTL is 6 HOURS, grounded
 * in the writer: `maintainMlbEloJob` appends a row when a game FINISHES, so
 * within a day the answer changes at most a handful of times and never
 * mid-request. A short TTL would recompute an identical series all afternoon.
 *
 * CACHE KEY: `team:rating-history:{sportKey}:{teamId}` — grepped before
 * choosing. Nothing else uses a `team:rating-history:` prefix, and both
 * components are bounded below before they reach it (task 3.5: an unbounded id
 * mints a permanent `snapshot_cache` row per value).
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getTeamRatingHistory } from '@/lib/sports/shared/teamRatingHistory';
import { ELO_SPORT_KEYS } from '@/lib/sports/shared/teamRatingShapes';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);

  const sport = url.searchParams.get('sport') ?? '';
  if (!(ELO_SPORT_KEYS as readonly string[]).includes(sport)) {
    return NextResponse.json({ error: `sport must be one of ${ELO_SPORT_KEYS.join(', ')}` }, { status: 400 });
  }

  const teamId = Number(url.searchParams.get('teamId'));
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return NextResponse.json({ error: 'teamId must be a positive integer' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `team:rating-history:${sport}:${teamId}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'team-rating-history',
    build: () => getTeamRatingHistory(sport, teamId),
    // A team with fewer than two rated games is a legitimate "not found", not a
    // failure: it is the ordinary state of every team in a sport that has not
    // started its season, and of every team in week one. Without this,
    // `cachedRoute` throws on the null and the page logs an error for the most
    // common case in the calendar.
    //
    // NOT CACHED, deliberately — that is what `notFoundMessage` does, and here
    // it is the right behaviour rather than a cost. A team crossing its second
    // game would otherwise stay blockless for the full six-hour TTL.
    notFoundMessage: 'No rated games for this team yet',
    errorMessage: 'Rating history lookup failed',
    request,
  });
}
