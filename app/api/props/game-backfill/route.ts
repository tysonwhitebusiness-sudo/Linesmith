/**
 * POST /api/props/game-backfill
 *
 * G5 — runs the historical game-model (moneyline) calibration backfill
 * against the current season. User-triggered, not automatic — walks the
 * whole season's schedule in one shot.
 */

import { NextResponse } from 'next/server';
import { backfillGameModel } from '@/lib/sports/mlb/gameModelBackfill';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { logSystemEvent } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const season = Number(easternDate().slice(0, 4));
    const summary = await backfillGameModel(season);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[api/props/game-backfill]', error);
    logSystemEvent({ level: 'error', source: 'api/props/game-backfill', message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Game backfill failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
