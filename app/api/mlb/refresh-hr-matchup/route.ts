/**
 * POST /api/mlb/refresh-hr-matchup — (re)computes and persists this season's
 * team HR-rate-allowed cache (homeRunLiveMatchup.ts), closing the live gap
 * where adapter.ts's pitcherMatchupSignal feature fed a hardcoded neutral 0
 * instead of the real opponent signal the active model was actually fit on.
 *
 * Expensive (pulls every qualified batter's current-season game log) —
 * meant to be run periodically (e.g. once a day), not on every page load.
 * Accepts ?season=2026 to override; defaults to the current Eastern-date season.
 */

import { NextResponse } from 'next/server';
import { refreshTeamHrRateAllowed } from '@/lib/sports/mlb/homeRunLiveMatchup';
import { currentSeason } from '@/lib/sports/mlb/homeRunModelFit';
import { logSystemEvent } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? Number(seasonParam) : currentSeason();
    await refreshTeamHrRateAllowed(season);
    return NextResponse.json({ season, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[api/mlb/refresh-hr-matchup]', error);
    logSystemEvent({ level: 'error', source: 'api/mlb/refresh-hr-matchup', message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Refresh failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
