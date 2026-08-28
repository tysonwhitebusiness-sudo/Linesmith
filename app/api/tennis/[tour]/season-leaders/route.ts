/**
 * Season aces/games-won leaders across the whole tour — GET
 * /api/tennis/[tour]/season-leaders?stat=aces|gamesWon
 *
 * Tennis's replacement for golf's "Season SG leaders in this field": same
 * idea (season-long form), sourced from `tennismylife.ts`'s already-fetched
 * season archive (`loadTennisSeasonContext`, which has its own internal 6h
 * cache per season CSV) rather than a new fetch.
 */

import { NextResponse } from 'next/server';
import { currentTennisSeason, loadTennisSeasonContext } from '@/lib/sports/tennis/tennismylife';
import { buildSeasonLeaders, type LeaderStat } from '@/lib/sports/tennis/seasonLeaders';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

function isLeaderStat(v: string | null): v is LeaderStat {
  return v === 'aces' || v === 'gamesWon';
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  const url = new URL(request.url);
  const statParam = url.searchParams.get('stat');
  const stat: LeaderStat = isLeaderStat(statParam) ? statParam : 'aces';

  return cachedRoute({
    cacheKey: `tennis:season-leaders:route:${tour}:${stat}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const season = currentTennisSeason();
      const context = await loadTennisSeasonContext(tour, season);
      return { leaders: buildSeasonLeaders(context, stat), season, stat };
    },
    errorMessage: 'Tennis season leaders lookup failed.',
    request,
  });
}
