/**
 * GET /api/props/drift-check?sport=mlb — the regression alarm the original
 * gameplan called for: does the rolling Brier from real, recently-graded
 * LIVE picks (excludes backfill entirely) still look like what the active
 * model's own holdout Brier promised, or has it quietly drifted worse since
 * the last fit (stale data source, market regime shift, a feature source
 * gone dark)?
 *
 * Built deliberately with low confidence tolerated — live sample sizes are
 * still small (dozens, not thousands), so MIN_SAMPLE gates the verdict
 * itself rather than the endpoint refusing to answer: below it, this reports
 * 'insufficient-sample' instead of a false alarm either direction.
 */

import { NextResponse } from 'next/server';
import { getActiveModelWeights, liveCalibrationBrier } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

const ROLLING_WINDOW = 100;
const MIN_SAMPLE = 20;
/** How much worse than the holdout expectation before this stops calling it "on track" — Brier is noisy at small N, so a small cushion avoids flagging normal variance as drift. */
const DRIFT_TOLERANCE = 0.02;

interface DriftResult {
  market: 'moneyline' | 'total';
  activeVersion: number | null;
  expectedBrier: number | null;
  liveBrier: number | null;
  liveGames: number;
  status: 'on-track' | 'underperforming' | 'insufficient-sample' | 'no-active-model';
}

async function checkMarket(sport: string, market: 'moneyline' | 'total'): Promise<DriftResult> {
  const active = await getActiveModelWeights(sport, market);
  if (!active) {
    return { market, activeVersion: null, expectedBrier: null, liveBrier: null, liveGames: 0, status: 'no-active-model' };
  }

  const { brier, games } = await liveCalibrationBrier(sport, market, ROLLING_WINDOW);

  if (games < MIN_SAMPLE || brier == null) {
    return { market, activeVersion: active.version, expectedBrier: active.holdoutBrier, liveBrier: brier, liveGames: games, status: 'insufficient-sample' };
  }

  const status = brier > active.holdoutBrier + DRIFT_TOLERANCE ? 'underperforming' : 'on-track';
  return { market, activeVersion: active.version, expectedBrier: active.holdoutBrier, liveBrier: brier, liveGames: games, status };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get('sport') ?? 'mlb';

  const [moneyline, total] = await Promise.all([checkMarket(sport, 'moneyline'), checkMarket(sport, 'total')]);
  return NextResponse.json({
    rollingWindow: ROLLING_WINDOW,
    minSample: MIN_SAMPLE,
    moneyline,
    total,
  });
}
