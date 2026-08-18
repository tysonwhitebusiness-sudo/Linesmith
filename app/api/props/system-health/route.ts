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
  golfCalibrationSummary,
} from '@/lib/db/client';
import { recentFetchErrors } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    tables: dbTableRowCounts(),
    dataAccumulation: dataAccumulationSnapshot(),
    elo: eloCoverage(),
    parkFactors: parkFactorCoverage(),
    historicalOdds: historicalOddsCoverage(),
    statsApiErrors: recentFetchErrors(),
    recentEvents: listRecentSystemEvents(50),
    // Golf Phase A models' "how is it performing" check — see project
    // memory's golf model gameplan. Every field stays null until at least
    // one logged prediction has actually been graded against a real result.
    golfCalibration: golfCalibrationSummary(),
  });
}
