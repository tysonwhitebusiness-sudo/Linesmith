/**
 * GET /api/diagnostics/batter-ranks           — cached position-ranked batter pool (overall + per-position, composite)
 * GET /api/diagnostics/batter-ranks?refresh=1  — bypass the 24h cache and recompute now
 */

import { NextResponse } from 'next/server';
import { getBatterRankings } from '@/lib/sports/mlb/batterRankings';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { logSystemEvent } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? Number(seasonParam) : Number(easternDate().slice(0, 4));
    const forceRefresh = searchParams.get('refresh') === '1';

    const rankings = await getBatterRankings(season, forceRefresh);
    return NextResponse.json(rankings);
  } catch (error) {
    console.error('[api/diagnostics/batter-ranks]', error);
    await logSystemEvent({
      level: 'error',
      source: 'api/diagnostics/batter-ranks',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Batter ranking fetch failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
