/**
 * POST /api/props/multi-sport-refresh { sport: "nfl" | "cfb" | "soccer_epl" }
 *
 * Manual trigger for the non-MLB sports' proactive refresh (multiSportRefresh.ts)
 * — same role as /api/props/lines' triggerFreshen for MLB, exposed as its own
 * route so each new sport can be refreshed/tested independently before full
 * scheduler cadences are wired in lib/scheduler.ts.
 */

import { NextResponse } from 'next/server';
import { refreshNfl, refreshCfb, refreshSoccerEpl, type MultiSportRefreshSummary } from '@/lib/odds/props/multiSportRefresh';

// Trims `unresolved` to a sample for the HTTP response — full lists during
// testing can run into the thousands and aren't useful past a representative
// slice.
function trim(summary: MultiSportRefreshSummary) {
  return { ...summary, unresolved: summary.unresolved.slice(0, 15), unresolvedTotal: summary.unresolved.length };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { sport?: string };

  switch (body.sport) {
    case 'nfl':
      return NextResponse.json({ sport: 'nfl', results: (await refreshNfl()).map(trim) });
    case 'cfb':
      return NextResponse.json({ sport: 'cfb', results: (await refreshCfb()).map(trim) });
    case 'soccer_epl':
      return NextResponse.json({ sport: 'soccer_epl', results: (await refreshSoccerEpl()).map(trim) });
    default:
      return NextResponse.json({ error: 'sport must be one of nfl, cfb, soccer_epl' }, { status: 400 });
  }
}
