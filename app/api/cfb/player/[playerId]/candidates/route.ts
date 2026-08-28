/**
 * Real, honestly-priceless per-market candidates for one CFB player with no
 * current `prop_odds` row — see `buildSyntheticPlayerCandidates` in
 * lib/sports/cfb/adapter.ts. Same on-demand rationale as NBA's/NHL's/
 * tennis's sibling routes: only fetched for the one player actually being
 * viewed, never built into the eager snapshot.
 *
 * GET /api/cfb/player/[playerId]/candidates?name=...&team=GT
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { buildSyntheticPlayerCandidates } from '@/lib/sports/cfb/adapter';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const subjectId = decodeURIComponent(playerId);
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const team = url.searchParams.get('team');
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!team) return NextResponse.json({ error: 'team is required' }, { status: 400 });

  return cachedRoute({
    cacheKey: `cfb:player-candidates:${subjectId}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const candidates = await buildSyntheticPlayerCandidates(subjectId, name, team);
      return { candidates, fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'CFB player candidate lookup failed',
    request,
  });
}
