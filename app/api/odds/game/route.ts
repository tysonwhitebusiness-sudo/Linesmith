/**
 * GET /api/odds/game?sport=nfl&gameId=401…
 *
 * The game page's "Lines" section and the player/team pages' game-line card
 * (odds build P8, O3): every period and market type per book from
 * `game_lines` (falling back to `game_odds_book_lines` for sources not yet on
 * it), ten days of history, openers (VSiN's with their sanity flags), pulls,
 * power ratings, checked times and source latency (`lib/db/oddsRead.ts`).
 *
 * CACHING — pattern 2 (CLAUDE.md): direct reads of tables the P6 bridge and
 * the worker keep fresh out of band. IT READS; IT NEVER WRITES.
 */
import { NextResponse } from 'next/server';
import { readGameOdds } from '@/lib/db/oddsRead';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const gameId = url.searchParams.get('gameId') ?? '';
  if (!/^[a-z_]{2,16}$/.test(sport) || !/^[A-Za-z0-9_.:-]{1,64}$/.test(gameId)) {
    return NextResponse.json({ error: 'sport and gameId are required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await readGameOdds(sport, gameId));
  } catch (e) {
    console.error('[odds/game]', e);
    return NextResponse.json({ error: 'Odds read failed' }, { status: 500 });
  }
}
