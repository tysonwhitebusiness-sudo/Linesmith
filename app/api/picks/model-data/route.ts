/**
 * GET /api/picks/model-data?sport=nfl — every real, ungraded pick_history
 * row for a sport, unfiltered by dimension (unlike app/api/picks/props,
 * which is curated to a top-10 subset). This is what Scan's dense table
 * merges into each PickCandidate's subjectMeta so its Score column has
 * something real to show.
 *
 * Real gap this closes: NFL/CFB/NBA/NHL/Soccer's own adapter.ts files
 * never populate subjectMeta.modelProb the way MLB's/Golf's do (there was
 * no real model for these sports until predict/generic_prop_production.py
 * — see docs/daily-picks-full-model-build-2026-08-27.md). The model now
 * exists and writes to pick_history; this route is the read side that
 * lets the OLDER Scan-table page consume it too, not just the newer
 * Today's Picks modal.
 */

import { NextResponse } from 'next/server';
import { readTodaysPropCandidates } from '@/lib/db/client';
import { RARE_MARKET_DIMENSIONS } from '@/lib/picks/rareMarketDimensions';
import type { Sport } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sport = (new URL(request.url).searchParams.get('sport') ?? '') as Sport;
  if (!sport || !(sport in RARE_MARKET_DIMENSIONS)) {
    return NextResponse.json({ error: 'sport query param required' }, { status: 400 });
  }
  // No dimension exclusion — the Scan table's dense view spans every real
  // dimension a sport has, not just the curated top-10/top-5 picks. 2000
  // is a generous ceiling for one real sport's one-day slate (MLB's own
  // real daily volume, the largest of any in-scope sport, stays well
  // under it).
  const rows = await readTodaysPropCandidates(sport, {}, 2000);
  return NextResponse.json({ rows });
}
