/**
 * GET /api/player-history?sport=<history sport>&athleteId=<bare id>
 *
 * Every game `player_game_history` holds for one player, with results and
 * opponents joined (`playerHistoryServer.ts`). Feeds the player page's Seasons,
 * Trends, Splits and Game log sections for every sport (R6.1a).
 *
 * CLAUDE.md pattern 2: a direct read of a table the Python history jobs keep
 * fresh out of band. No snapshot blob, deliberately — one row per viewed player
 * in `snapshot_cache` is the growth Phase 5 is already watching, and the read
 * is two indexed queries (`idx_player_game_history_lookup` on sport, athlete).
 * The only external calls are the team directories, which are cached upstream
 * and memoised in-process.
 */

import { NextResponse } from 'next/server';
import { readPlayerHistory } from '@/lib/sports/shared/playerHistoryServer';
import { isHistorySport } from '@/lib/sports/shared/playerResearchShapes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const athleteId = url.searchParams.get('athleteId') ?? '';
  if (!isHistorySport(sport)) return NextResponse.json({ error: 'Unknown sport' }, { status: 400 });
  if (!/^\d{1,12}$/.test(athleteId)) return NextResponse.json({ error: 'athleteId must be a numeric id' }, { status: 400 });
  try {
    const history = await readPlayerHistory(sport, athleteId);
    // Browsers may reuse it briefly; the table changes once or twice a day.
    return NextResponse.json(history, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch {
    return NextResponse.json({ error: 'Player history unavailable' }, { status: 502 });
  }
}
