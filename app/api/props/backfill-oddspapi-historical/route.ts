/**
 * POST /api/props/backfill-oddspapi-historical?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Bulk-fills historical_odds for a date range from OddsPapi's historical
 * endpoint — see lib/sports/mlb/oddsPapiHistoricalIngest.ts for the full
 * design. Budget-aware and idempotent, so calling this again after hitting
 * the monthly cap (or after any partial failure) just resumes.
 */

import { NextResponse } from 'next/server';
import { backfillFromOddsPapi } from '@/lib/sports/mlb/oddsPapiHistoricalIngest';
import { logSystemEvent } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  if (!start || !end) {
    return NextResponse.json({ error: 'Both ?start= and ?end= (YYYY-MM-DD) are required.' }, { status: 400 });
  }

  try {
    const summary = await backfillFromOddsPapi(start, end);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[api/props/backfill-oddspapi-historical]', error);
    logSystemEvent({ level: 'error', source: 'api/props/backfill-oddspapi-historical', message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Backfill failed', detail: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
