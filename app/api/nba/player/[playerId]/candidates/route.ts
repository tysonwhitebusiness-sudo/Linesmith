/**
 * Real, honestly-priceless per-market candidates for one NBA player with no
 * current `prop_odds` row — see `buildSyntheticPlayerCandidates` in
 * lib/sports/nba/adapter.ts. Same on-demand rationale as the NHL route
 * (app/api/nhl/player/[playerId]/candidates/route.ts): only fetched for the
 * one player actually being viewed, never built into the eager snapshot.
 *
 * GET /api/nba/player/[playerId]/candidates?name=...&team=LAL
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { buildSyntheticPlayerCandidates } from '@/lib/sports/nba/adapter';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const subjectId = decodeURIComponent(playerId);
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const team = url.searchParams.get('team') ?? undefined;
  const headshotUrl = url.searchParams.get('headshot') ?? undefined;
  const teamLogoUrl = url.searchParams.get('teamLogo') ?? undefined;

  return cachedRoute({
    cacheKey: `nba:player-candidates:${subjectId}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const candidates = await buildSyntheticPlayerCandidates(subjectId, name, team, headshotUrl, teamLogoUrl);
      return { candidates, fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'NBA player candidate lookup failed',
    request,
  });
}
