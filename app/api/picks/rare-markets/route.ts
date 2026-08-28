/**
 * GET /api/picks/rare-markets?sport=nfl — today's top 5 rare-market picks
 * for one sport (Phase 6 of docs/daily-picks-full-model-build-2026-08-27.
 * md). Same pure `pick_history` read as app/api/picks/props/route.ts, just
 * scoped to ONLY the sport's rare-market dimension(s) (lib/picks/
 * rareMarketDimensions.ts) instead of excluding them.
 *
 * MLB keeps its own separate app/api/mlb/home-run-candidates/route.ts
 * (Phase 8 trims that one from Top 15 to Top 5 for consistency with this
 * route's own TOP_N — a deliberate, disclosed change, not merged into
 * this route since MLB's candidates come from a snapshot cache, not
 * pick_history directly).
 */

import { NextResponse } from 'next/server';
import { readTodaysPropCandidates } from '@/lib/db/client';
import { RARE_MARKET_DIMENSIONS } from '@/lib/picks/rareMarketDimensions';
import type { Sport } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

const TOP_N = 5;

export async function GET(request: Request) {
  const sport = (new URL(request.url).searchParams.get('sport') ?? '') as Sport;
  if (!sport || !(sport in RARE_MARKET_DIMENSIONS)) {
    return NextResponse.json({ error: 'sport query param required' }, { status: 400 });
  }
  const rareDimensions = RARE_MARKET_DIMENSIONS[sport];
  if (rareDimensions.length === 0) {
    return NextResponse.json({ candidates: [] });
  }
  const rows = await readTodaysPropCandidates(sport, { only: rareDimensions }, TOP_N);
  return NextResponse.json({ candidates: rows });
}
