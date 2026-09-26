import { NextResponse } from 'next/server';
import { readEdgeRanking, readEdges } from '@/lib/db/oddsRead';

export const dynamic = 'force-dynamic';

/**
 * GET /api/odds/edges?ids=<gameId,...>[&kind=prop|game] — the market edges
 * passing every gate for a set of games (odds build P11): the Slate's edge
 * dots, the Market hub's Edges tab and Scan's edge column.
 *
 * Pattern 2 (CLAUDE.md "API route caching"): a direct read of `market_edges`,
 * a real table Python's marketEdgeJob refreshes out-of-band every 2 minutes.
 * It is NOT a cachedRoute on purpose: the operator's kill switch
 * (`app_flags.edge_display`) must hide every edge within 30 s, and a 60 s
 * snapshot would hold one past it. `edges` is absent while edges are hidden.
 *
 * `&rank=N` (slate-polish D) returns the Slate's Edge / EV ranking instead:
 * the top N market lines of these games by EV against the sharp fair price,
 * from `market_edge_candidates`, with each one's status — the same table,
 * refreshed by the same job, so the same pattern.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').filter(Boolean))];
  const kind = url.searchParams.get('kind');
  if (!ids.length || ids.length > 80 || ids.some(id => !/^[A-Za-z0-9_.:-]{1,64}$/.test(id))
      || (kind != null && kind !== 'prop' && kind !== 'game')) {
    return NextResponse.json({ error: 'ids (at most 80) are required; kind is prop or game' }, { status: 400 });
  }
  const rank = url.searchParams.get('rank');
  if (rank != null) {
    const n = Number(rank);
    if (!Number.isInteger(n) || n < 1 || n > 25) return NextResponse.json({ error: 'rank is 1-25' }, { status: 400 });
    try {
      return NextResponse.json(await readEdgeRanking({ gameIds: ids, limit: n }));
    } catch (e) {
      console.error('[odds/edges rank]', e);
      return NextResponse.json({ error: 'Edge ranking read failed' }, { status: 500 });
    }
  }
  try {
    const edges = await readEdges({ gameIds: ids, kind: (kind ?? undefined) as 'prop' | 'game' | undefined });
    return NextResponse.json({ asOf: new Date().toISOString(), ...(edges ? { edges } : {}) });
  } catch (e) {
    console.error('[odds/edges]', e);
    return NextResponse.json({ error: 'Edge read failed' }, { status: 500 });
  }
}
