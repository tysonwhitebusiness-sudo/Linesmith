import { NextResponse } from 'next/server';
import { getTournamentWeather } from '@/lib/sports/tennis/weather';
import { cachedRoute } from '@/lib/cachedRoute';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 20 * 60 * 1000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  const url = new URL(request.url);
  const venueCity = url.searchParams.get('venueCity');
  if (!venueCity) {
    return NextResponse.json({ error: 'venueCity is required.' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `tennis:weather:route:${venueCity.toLowerCase()}`,
    ttlMs: CACHE_TTL_MS,
    build: () => getTournamentWeather(venueCity),
    errorMessage: 'Tennis weather lookup failed.',
    request,
  });
}
