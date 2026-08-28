/**
 * GET /api/odds/game-line?sport=X&gameId=Y
 *
 * The real per-game bookmaker grid, for every sport — reads
 * game_odds_book_lines directly (readGameOddsBookLines, lib/db/client.ts),
 * the shared table OddsHarvester/the-odds-api/SportsGameOdds/SharpAPI/
 * Propline/ESPN all write into (odds-architecture rebuild Phases 1-6).
 *
 * No cachedRoute()/background-refresh trigger here, unlike most GET routes
 * in this codebase (see CLAUDE.md) — game_odds_book_lines is already a
 * real table, not a snapshot blob (CLAUDE.md's own pattern 2), and unlike
 * `/api/props/lines` there is no single per-request action this route
 * could trigger: the table is populated by several independent background
 * writers across two apps (Python's Scheduled Task / Render jobs, and
 * this app's own fire-and-forget ESPN write on each sport's game-detail
 * route), none of which are "the next request for this game." A direct,
 * uncached read is the correct shape here, not a missing optimization.
 */

import { NextResponse } from 'next/server';
import { readGameOddsBookLines } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport');
  const gameId = url.searchParams.get('gameId');

  if (!sport || !gameId) {
    return NextResponse.json({ error: 'sport and gameId are required' }, { status: 400 });
  }

  const line = await readGameOddsBookLines(sport, gameId);
  return NextResponse.json({ line });
}
