import { NextResponse } from 'next/server';
import { getTennisRankings } from '@/lib/sports/tennis/rankings';
import { cachedRoute } from '@/lib/cachedRoute';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `tennis:rankings:route:${tour}`,
    ttlMs: CACHE_TTL_MS,
    build: () => getTennisRankings(tour),
    errorMessage: 'Tennis rankings lookup failed.',
    request,
  });
}
