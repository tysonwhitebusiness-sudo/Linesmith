import { NextResponse } from 'next/server';
import { getTournamentDraw } from '@/lib/sports/tennis/schedule';
import { cachedRoute } from '@/lib/cachedRoute';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

// getTournamentDraw already picks its own TTL internally (7 days once the
// tournament is complete, 3 minutes while live — see schedule.ts) — this
// outer TTL only needs to be short enough that a live draw's route-level
// cache never outlives the inner one.
const CACHE_TTL_MS = 3 * 60 * 1000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!eventId || !start || !end) {
    return NextResponse.json({ error: 'eventId, start and end are required.' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `tennis:draw:route:${tour}:${eventId}`,
    ttlMs: CACHE_TTL_MS,
    build: () => getTournamentDraw(tour, eventId, start, end),
    errorMessage: 'Tennis draw lookup failed.',
    request,
  });
}
