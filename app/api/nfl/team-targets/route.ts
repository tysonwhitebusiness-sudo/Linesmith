/**
 * One NFL team's target maps: where its offense throws, where its defense is
 * thrown at (also by receiver position), and the league baseline.
 *
 * GET /api/nfl/team-targets?season=2025&teamId=6
 *
 * Feeds R7's team passing cards, R8's "Passing matchup" and compare's
 * "defense thrown-at map vs the player's targets". Team ids are ESPN's.
 * Shape: `lib/sports/nfl/teamTargetShapes.ts`.
 *
 * PATTERN 2 — a direct read of `team_target_profile`, rewritten daily by
 * `teamProductionJob` from `nfl_target_events` (CLAUDE.md).
 */

import { NextResponse } from 'next/server';
import { readNflTeamTargets } from '@/lib/sports/nfl/teamTargets';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const season = Number(url.searchParams.get('season'));
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: 'season is required' }, { status: 400 });
  }
  const teamId = url.searchParams.get('teamId') ?? '';
  if (!/^\d{1,4}$/.test(teamId)) return NextResponse.json({ error: 'teamId must be an ESPN team id' }, { status: 400 });

  try {
    const body = await readNflTeamTargets(season, teamId);
    if (!body) return NextResponse.json({ error: `No targets rolled up for team ${teamId} in ${season}` }, { status: 404 });
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: 'Team targets lookup failed' }, { status: 500 });
  }
}
