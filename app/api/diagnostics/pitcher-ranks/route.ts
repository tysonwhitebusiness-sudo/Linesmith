/**
 * GET /api/diagnostics/pitcher-ranks           — cached role-ranked pitcher pools (starters/closers/relievers)
 * GET /api/diagnostics/pitcher-ranks?refresh=1  — bypass the 24h cache and recompute now
 */

import { NextResponse } from 'next/server';
import { getPitcherRoleRankings } from '@/lib/sports/mlb/pitcherRankings';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { logSystemEvent } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? Number(seasonParam) : Number(easternDate().slice(0, 4));
    const forceRefresh = searchParams.get('refresh') === '1';

    const rankings = await getPitcherRoleRankings(season, forceRefresh);
    return NextResponse.json(rankings);
  } catch (error) {
    console.error('[api/diagnostics/pitcher-ranks]', error);
    await logSystemEvent({
      level: 'error',
      source: 'api/diagnostics/pitcher-ranks',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Pitcher ranking fetch failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
