import { NextResponse } from 'next/server';
import { getSeasonSchedule } from '@/lib/sports/tennis/schedule';
import { cachedRoute } from '@/lib/cachedRoute';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

// getSeasonSchedule already has its own 24h cache (schedule.ts) — this outer
// layer just adds stale-while-revalidate on top, same reasoning golf's own
// schedule route gives for its identical TTL.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  const url = new URL(request.url);
  const yearParam = url.searchParams.get('year');
  const yearInput = yearParam ? Number(yearParam) : new Date().getFullYear();
  const year = Number.isFinite(yearInput) ? yearInput : new Date().getFullYear();

  // Namespaced distinctly from getSeasonSchedule's own internal cache key
  // (`tennis:schedule:${tour}:${year}`) — same collision golf's own schedule
  // route already hit once and documents avoiding.
  return cachedRoute({
    cacheKey: `tennis:schedule:route:${tour}:${year}`,
    ttlMs: CACHE_TTL_MS,
    build: () => getSeasonSchedule(tour, year),
    errorMessage: 'Tennis schedule lookup failed.',
    request,
  });
}
