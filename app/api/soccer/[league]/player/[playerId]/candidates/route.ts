/**
 * Real, honestly-priceless per-market candidates for one soccer player with
 * no current `prop_odds` row — see `buildSyntheticPlayerCandidates` in
 * lib/sports/soccer/adapter.ts (Understat for EPL, ASA for MLS). Same
 * on-demand rationale as CFB's/NBA's/NHL's/tennis's sibling routes: only
 * fetched for the one player actually being viewed.
 *
 * GET /api/soccer/[league]/player/[playerId]/candidates?name=...
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import type { SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';
import { buildSyntheticPlayerCandidates } from '@/lib/sports/soccer/adapter';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ league: string; playerId: string }> }) {
  const { league, playerId } = await params;
  if (!isSoccerLeague(league)) {
    return NextResponse.json({ error: `Unknown league "${league}"` }, { status: 400 });
  }
  const subjectId = decodeURIComponent(playerId);
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  return cachedRoute({
    cacheKey: `soccer:player-candidates:${league}:${subjectId}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const candidates = await buildSyntheticPlayerCandidates(subjectId, name, league);
      return { candidates, fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'Soccer player candidate lookup failed',
    request,
  });
}
