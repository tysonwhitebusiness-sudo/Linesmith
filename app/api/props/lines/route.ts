/**
 * GET /api/props/lines[?gameId=X]
 *
 * Tier 1's automatic refresh, tied to the same ~3-minute cadence as the MLB
 * snapshot itself. Serves from the SQLite cache by default (update-09 § 7 —
 * "never trigger a network fetch implicitly from a render"); refreshing here
 * still isn't render-triggered in the client sense, it's the same
 * cache-or-rebuild pattern `/api/mlb` already uses, just for prop odds.
 *
 * The "cache" here is the `prop_odds` tables themselves — already fast, pure
 * SQLite reads — so unlike `/api/mlb` there's no separate blob to serve
 * stale. The only thing that used to block a request was `refreshTier1()`
 * itself; `triggerFreshen` (tier1RefreshScheduler.ts) now fires that in the
 * background instead of this route awaiting it, so a request only ever
 * waits on it once — the very first call this process makes, before any
 * tables exist.
 */

import { NextResponse } from 'next/server';
import { readPropOddsForGame, readPropOddsForSubject } from '@/lib/db/client';
import { loadAllGameContexts } from '@/lib/odds/props/gameContext';
import { triggerFreshen } from '@/lib/odds/props/tier1RefreshScheduler';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const gameId = url.searchParams.get('gameId');
  const subjectId = url.searchParams.get('subjectId');

  // Never awaited past the first-ever call (see `triggerFreshen`) — a stale
  // refresh runs in the background while this request reads whatever's
  // already in SQLite below.
  void triggerFreshen();

  if (subjectId && gameId) {
    return NextResponse.json({ rows: await readPropOddsForSubject(gameId, subjectId) });
  }
  if (gameId) {
    return NextResponse.json({ rows: await readPropOddsForGame(gameId) });
  }

  const games = await loadAllGameContexts();
  const rows = (await Promise.all(games.map((g) => readPropOddsForGame(g.gameId)))).flat();
  return NextResponse.json({ rows });
}
