/**
 * GET /api/picks/props?sport=nfl — today's top 10 player-prop picks for
 * one sport, generalizing app/api/mlb/home-run-candidates/route.ts's real
 * filter+sort+slice pattern (Phase 6 of docs/daily-picks-full-model-
 * build-2026-08-27.md). Pure read from `pick_history` — the Python
 * worker's generic_prop_production.py job is the sole writer (see
 * CLAUDE.md's caching section: admin/scheduled-job-owned tables are read
 * directly, no cachedRoute()/triggerFreshen() needed here, same
 * precedent as app/api/props/lines/route.ts).
 *
 * Excludes whatever dimension(s) this sport's rare-market tab already
 * claims (lib/picks/rareMarketDimensions.ts) so the same real bet never
 * surfaces in both tabs.
 */

import { NextResponse } from 'next/server';
import { readTodaysPropCandidates } from '@/lib/db/client';
import { RARE_MARKET_DIMENSIONS } from '@/lib/picks/rareMarketDimensions';
import type { Sport } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

const TOP_N = 10;

export async function GET(request: Request) {
  const sport = (new URL(request.url).searchParams.get('sport') ?? '') as Sport;
  if (!sport || !(sport in RARE_MARKET_DIMENSIONS)) {
    return NextResponse.json({ error: 'sport query param required' }, { status: 400 });
  }
  const rows = await readTodaysPropCandidates(sport, { exclude: RARE_MARKET_DIMENSIONS[sport] }, TOP_N);
  return NextResponse.json({ candidates: rows });
}
