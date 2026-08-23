import { NextResponse } from 'next/server';
import { buildTennisSnapshot } from '@/lib/sports/tennis/adapter';
import { cachedRoute } from '@/lib/cachedRoute';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TTL_MS = 4 * 60_000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `tennis:snapshot:${tour}`,
    ttlMs: TTL_MS,
    build: () => buildTennisSnapshot(tour),
    errorMessage: 'Tennis snapshot failed',
    request,
  });
}
