/**
 * POST /api/props/backfill
 *
 * Phase C.0.4 — runs the historical model-calibration backfill against the
 * current season. User-triggered (not on any automatic cycle): it walks
 * every known subject's full season gamelog, so it's a heavier one-off job,
 * not something to run on every snapshot refresh.
 */

import { NextResponse } from 'next/server';
import { backfillModelCalibration } from '@/lib/odds/props/modelBackfill';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const season = Number(easternDate().slice(0, 4));
    const summary = await backfillModelCalibration(season);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[api/props/backfill]', error);
    return NextResponse.json(
      { error: 'Backfill failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
