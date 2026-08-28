/**
 * Real, honestly-priceless per-market candidates for one NHL player with no
 * current `prop_odds` row — see `buildSyntheticPlayerCandidates` in
 * lib/sports/nhl/adapter.ts for the full rationale. On-demand rather than
 * built into the slate snapshot: the snapshot's roster-subjects fallback
 * covers ~1100 real NHL players, and eagerly computing every market's real
 * history for all of them would be the exact payload-bloat mistake NFL's
 * per-candidate season stats already caused once this session — this only
 * ever fetches for the one player actually being viewed.
 *
 * GET /api/nhl/player/[playerId]/candidates?team=COL&pos=C&name=...
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { buildSyntheticPlayerCandidates } from '@/lib/sports/nhl/adapter';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const subjectId = decodeURIComponent(playerId);
  const url = new URL(request.url);
  const team = url.searchParams.get('team');
  if (!team) return NextResponse.json({ error: 'team is required' }, { status: 400 });
  const name = url.searchParams.get('name') ?? subjectId;
  const position = url.searchParams.get('pos');
  const headshotUrl = url.searchParams.get('headshot') ?? undefined;
  const teamLogoUrl = url.searchParams.get('teamLogo') ?? undefined;

  return cachedRoute({
    cacheKey: `nhl:player-candidates:${subjectId}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const candidates = await buildSyntheticPlayerCandidates(subjectId, name, team, position, headshotUrl, teamLogoUrl);
      return { candidates, fetchedAt: new Date().toISOString() };
    },
    errorMessage: 'NHL player candidate lookup failed',
    request,
  });
}
