/**
 * GET /api/props/system-health — the "Data Sources & System" section's
 * single fetch: DB row counts per table (instant "did ingestion silently
 * stop" check), pipeline freshness for the three season-scoped data sources
 * that have no other health surface (Elo backfill, park factors, historical
 * odds), MLB Stats API health (recentFetchErrors already existed, just
 * never had a UI home), and the persisted error log.
 */

import { NextResponse } from 'next/server';
import {
  dbTableRowCounts,
  dataAccumulationSnapshot,
  eloCoverage,
  parkFactorCoverage,
  historicalOddsCoverage,
  listRecentSystemEvents,
} from '@/lib/db/client';
import { recentFetchErrors } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [tables, dataAccumulation, elo, parkFactors, historicalOdds, recentEvents] = await Promise.all([
    dbTableRowCounts(),
    dataAccumulationSnapshot(),
    eloCoverage(),
    parkFactorCoverage(),
    historicalOddsCoverage(),
    listRecentSystemEvents(50),
  ]);
  return NextResponse.json({
    tables,
    dataAccumulation,
    elo,
    parkFactors,
    historicalOdds,
    statsApiErrors: recentFetchErrors(),
    recentEvents,
  });
}
