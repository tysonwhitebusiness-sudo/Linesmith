/**
 * Real, honestly-priceless per-market candidates for one tennis player with
 * no current `prop_odds` row — see `buildSyntheticPlayerCandidates` in
 * lib/sports/tennis/adapter.ts. Same on-demand rationale as the NHL/NBA
 * routes: only fetched for the one player actually being viewed.
 *
 * GET /api/tennis/[tour]/player/[playerId]/candidates?name=...
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';
import { buildSyntheticPlayerCandidates } from '@/lib/sports/tennis/adapter';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string; playerId: string }> }) {
  const { tour, playerId } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }
  const subjectId = decodeURIComponent(playerId);
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  return cachedRoute({
    cacheKey: `tennis:player-candidates:${tour}:${subjectId}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const candidates = await buildSyntheticPlayerCandidates(subjectId, name, tour);
      return { candidates, fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'Tennis player candidate lookup failed',
    request,
  });
}
