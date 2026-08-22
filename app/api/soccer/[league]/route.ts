import { NextResponse } from 'next/server';
import { buildSoccerSnapshot } from '@/lib/sports/soccer/adapter';
import { cachedRoute } from '@/lib/cachedRoute';
import type { SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TTL_MS = 4 * 60_000;

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  if (!isSoccerLeague(league)) {
    return NextResponse.json({ error: `Unknown league "${league}"` }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `soccer:snapshot:${league}`,
    ttlMs: TTL_MS,
    build: () => buildSoccerSnapshot(league),
    errorMessage: 'Soccer snapshot failed',
    request,
  });
}
