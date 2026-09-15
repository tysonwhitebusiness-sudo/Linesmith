/**
 * The MLB starters card, as of the day before the game — both probable
 * starters' season line, last starts and pitch mix, and each opposing hitter
 * against that starter's hand and against the starter himself.
 *
 * GET /api/mlb/game/824711/pregame-statcast
 *
 * Feeds R8's "Starters" section (before start, and kept on the final page).
 * Hitters are the opposing ACTIVE ROSTER, not a lineup: the lineup is not known
 * when the row is written, so the card orders them by the posted lineup.
 * Shape: `lib/sports/mlb/statcastRollupShapes.ts`.
 *
 * PATTERN 2 — a direct read of `mlb_statcast_game_pregame`, written for today's
 * and tomorrow's games after every corpus refresh by `build_statcast_rollups.py`
 * and left alone once the game starts (CLAUDE.md). One row; nothing to cache.
 */

import { NextResponse } from 'next/server';
import { readGamePregameStatcast } from '@/lib/sports/mlb/statcastRollups';
import { parseMlbId } from '@/lib/sports/mlb/statcastParams';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId: raw } = await params;
  const gamePk = parseMlbId(raw);
  if (gamePk == null) return NextResponse.json({ error: 'gameId must be a positive integer' }, { status: 400 });

  try {
    const row = await readGamePregameStatcast(gamePk);
    if (!row) {
      return NextResponse.json(
        { error: `No pregame Statcast for game ${gamePk}. It is written for today's and tomorrow's games.` },
        { status: 404 },
      );
    }
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: 'Pregame Statcast lookup failed' }, { status: 500 });
  }
}
