import { NextResponse } from 'next/server';
import { getMlbGameLines } from '@/lib/odds/oddsApi';

export const dynamic = 'force-dynamic';

/**
 * Read-only since Phase 1.6 (standing decision Q9). `ODDS_API_KEY` was missing
 * from the Render worker, so `mlbGameLinesJob` logged
 * "ODDS_API_KEY is not set — game lines are turned off" on every tick while
 * this route quietly held the only working copy of the key. The key is now set
 * on the worker, which makes Python the owner of that job.
 *
 * Two owners of one paid job is the problem this closes: `?force` bypasses the
 * TTL in `getMlbGameLines` and spends a real request against a monthly budget
 * the worker is also drawing on, from an endpoint with no frontend consumer at
 * all (grepped: nothing in app/, components/ or lib/ fetches it). Serving
 * whatever the shared `odds_cache` holds costs nothing and still answers the
 * question this route exists to answer.
 *
 * The route itself is a deletion candidate — that belongs to task 2.6, which
 * owns dead-code removal, not here.
 */
export async function GET() {
  try {
    const result = await getMlbGameLines(false);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[api/odds/game-lines]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Odds lookup failed.' },
      { status: 502 },
    );
  }
}
