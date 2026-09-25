/**
 * GET /api/odds/player?sport=nfl&gameId=401…&subjectId=4426502
 *
 * The player page's "Odds & prices" section (odds build P8, O2): every
 * provider's current prices for the player, ten days of history, openers,
 * pulls, checked times and measured source latency (`lib/db/oddsRead.ts`).
 *
 * CACHING — pattern 2 (CLAUDE.md): direct reads of `prop_odds`,
 * `prop_price_history`, `prop_odds_pulls`, `market_openers`, `scraper_checks`
 * and `source_latency`, which the P6 scraper bridge and the worker keep fresh
 * out of band. Nothing here triggers a refresh. IT READS; IT NEVER WRITES.
 */
import { NextResponse } from 'next/server';
import { readPlayerOdds } from '@/lib/db/oddsRead';

export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  const gameId = url.searchParams.get('gameId') ?? '';
  const subjectId = url.searchParams.get('subjectId') ?? '';
  if (!/^[a-z_]{2,16}$/.test(sport) || !ID.test(gameId) || !ID.test(subjectId)) {
    return NextResponse.json({ error: 'sport, gameId and subjectId are required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await readPlayerOdds(sport, gameId, subjectId));
  } catch (e) {
    console.error('[odds/player]', e);
    return NextResponse.json({ error: 'Odds read failed' }, { status: 500 });
  }
}
