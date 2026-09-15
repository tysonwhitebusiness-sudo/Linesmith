/**
 * One NBA or NHL team's shot view: its own shots, its opponents' (NBA also by
 * the shooter's position), and the league's teams for distributions.
 *
 * GET /api/team-shot-profile?sport=nba&season=2025&teamId=13
 * GET /api/team-shot-profile?sport=nhl&season=2024&teamId=10
 *
 * Feeds R7's team shot cards and R9's "player's zones vs zones allowed to the
 * position". Regular season only; league views use teams with 40+ games.
 * `season` is `player_game_history`'s label (NBA end year, NHL start year);
 * NHL team ids are the NHL API's. Shape: `lib/sports/shared/teamProductionShapes.ts`.
 *
 * PATTERN 2 — a direct read of `team_shot_profile`, rewritten daily by
 * `teamProductionJob` from the shot tables (CLAUDE.md).
 */

import { NextResponse } from 'next/server';
import { readTeamShotProfile } from '@/lib/sports/shared/teamProduction';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport');
  if (sport !== 'nba' && sport !== 'nhl') {
    return NextResponse.json({ error: "sport must be 'nba' or 'nhl'" }, { status: 400 });
  }
  const season = Number(url.searchParams.get('season'));
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: 'season is required' }, { status: 400 });
  }
  const teamId = url.searchParams.get('teamId') ?? '';
  if (!/^\d{1,10}$/.test(teamId)) return NextResponse.json({ error: 'teamId must be a numeric team id' }, { status: 400 });

  try {
    const body = await readTeamShotProfile(sport, season, teamId);
    if (!body) return NextResponse.json({ error: `No shots rolled up for ${sport} team ${teamId} in ${season}` }, { status: 404 });
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: 'Team shot profile lookup failed' }, { status: 500 });
  }
}
