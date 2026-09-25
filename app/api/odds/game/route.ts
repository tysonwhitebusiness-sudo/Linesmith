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
import { pgPoolStats } from '@/lib/db/pgClient';
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
    // P9 §4: the page polls this every 30 s. Server-Timing carries the read's time and
    // the pool's queue when it started (the load budget reads it; the payload is unchanged).
    const t0 = Date.now();
    const q0 = pgPoolStats();
    // `live=1`: the page's 30 s refresh — prices, pulls and splits, no history (P9 §4, liveMerge.ts).
    const body = await readGameOdds(sport, gameId, { live: url.searchParams.get('live') === '1' });
    return NextResponse.json(body, { headers: { 'Server-Timing': `read;dur=${Date.now() - t0}, pool;desc="waiting=${q0?.waiting ?? 0} total=${q0?.total ?? 0}"` } });
  } catch (e) {
    console.error('[odds/game]', e);
    return NextResponse.json({ error: 'Odds read failed' }, { status: 500 });
  }
}
