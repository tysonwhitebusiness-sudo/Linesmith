/**
 * A team's key players, ranked by production score per game, with each one's
 * share of the team's production.
 *
 * GET /api/key-players?sport=nfl&season=2025&teamId=6
 *
 * Feeds R7's "Roster production" and the key-players rows on team-vs-team
 * compare. Ranked by what players produce, never by games played, which put
 * punters at the top. `minGames` (default 3, G2's floor) keeps a one-game
 * fill-in off the list. Shape: `lib/sports/shared/teamProductionShapes.ts`.
 *
 * PATTERN 2 — a direct read of `player_season_production`, rewritten daily by
 * `teamProductionJob` (CLAUDE.md). Names and headshots are not here: the page
 * already has the roster.
 */

import { NextResponse } from 'next/server';
import { readKeyPlayers } from '@/lib/sports/shared/teamProduction';
import { TEAM_PRODUCTION_SPORTS, isTeamProductionSport } from '@/lib/sports/shared/teamProductionShapes';

export const dynamic = 'force-dynamic';

function boundedInt(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  if (!isTeamProductionSport(sport)) {
    return NextResponse.json({ error: `sport must be one of: ${TEAM_PRODUCTION_SPORTS.join(', ')}` }, { status: 400 });
  }
  const season = boundedInt(url.searchParams.get('season'), NaN, 2000, 2100);
  const teamId = url.searchParams.get('teamId') ?? '';
  const limit = boundedInt(url.searchParams.get('limit'), 10, 1, 60);
  const minGames = boundedInt(url.searchParams.get('minGames'), 3, 1, 200);
  if (season == null || Number.isNaN(season)) return NextResponse.json({ error: 'season is required' }, { status: 400 });
  if (!/^\d{1,10}$/.test(teamId)) return NextResponse.json({ error: 'teamId must be a numeric team id' }, { status: 400 });
  if (limit == null || minGames == null) return NextResponse.json({ error: 'limit is 1-60 and minGames 1-200' }, { status: 400 });

  try {
    const players = await readKeyPlayers(sport, season, teamId, limit, minGames);
    if (!players.length) {
      return NextResponse.json({ error: `No production for ${sport} team ${teamId} in ${season}` }, { status: 404 });
    }
    return NextResponse.json({ sport, season, teamId, players });
  } catch {
    return NextResponse.json({ error: 'Key players lookup failed' }, { status: 500 });
  }
}
