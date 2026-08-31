/**
 * GET /api/venue-factor?sport=nhl&teamId=12&statKey=goals
 *
 * The home/road scoring factor for one team — Phase 6.10's read path.
 *
 * CACHING — pattern 2 (direct Postgres read, refreshed out-of-band), per
 * `CLAUDE.md`: the data lives in its own real table (`venue_factors`), the
 * Python worker's daily `venueFactorsJob` is its sole writer, and this route
 * triggers nothing and writes nothing. The read is a primary-key lookup
 * returning one row, so `cachedRoute`'s machinery would cost more than the
 * query it wrapped.
 *
 * Every parameter is bounded before it reaches SQL — including `statKey`,
 * which is an allowlist rather than a pattern because the set of stats the job
 * computes is fixed and small.
 */

import { NextResponse } from 'next/server';
import { readVenueFactor } from '@/lib/sports/shared/venueFactor';

export const dynamic = 'force-dynamic';

/** `player_game_history`'s own vocabulary — soccer_epl, not soccer. */
const SPORTS = new Set(['nba', 'nhl', 'nfl', 'cfb', 'soccer_epl', 'soccer_mls']);
/** Exactly the keys `SPORT_STATS` in `venue_factors.py` computes. */
const STAT_KEYS = new Set(['points', 'goals', 'totalGoals', 'passing.passingYards']);
const TEAM_ID = /^[A-Za-z0-9:_.\-]{1,32}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const teamId = url.searchParams.get('teamId') ?? '';
  const statKey = url.searchParams.get('statKey') ?? '';

  if (!SPORTS.has(sport)) {
    return NextResponse.json({ error: `sport must be one of: ${[...SPORTS].join(', ')}` }, { status: 400 });
  }
  if (!TEAM_ID.test(teamId)) {
    return NextResponse.json({ error: `teamId is required and must match ${TEAM_ID}` }, { status: 400 });
  }
  if (!STAT_KEYS.has(statKey)) {
    return NextResponse.json({ error: `statKey must be one of: ${[...STAT_KEYS].join(', ')}` }, { status: 400 });
  }

  // A team with no factor is a normal answer, not an error: the job writes a
  // row only once a team clears its sport's game floor on both sides.
  return NextResponse.json({ factor: await readVenueFactor(sport, teamId, statKey) });
}
