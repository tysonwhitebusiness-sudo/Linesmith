/**
 * Real per-match Moneyline for a tournament's non-final matches — GET
 * /api/tennis/[tour]/moneylines?eventId=&start=&end=
 *
 * Derives the match list server-side from the already-cached draw
 * (`getTournamentDraw`, same eventId/start/end the Draw card already fetches)
 * rather than accepting an arbitrary match list from the client — keeps this
 * a plain, cacheable GET instead of needing a POST body for a variable-length
 * list. Not part of the props pipeline (`_tennis_specs` in the Python
 * service only pulls `is_player_prop=true` rows) — this is a separate real
 * market SharpAPI carries that nothing else in the app reads yet.
 */

import { NextResponse } from 'next/server';
import { getTournamentDraw } from '@/lib/sports/tennis/schedule';
import { getTennisMatchMoneylines } from '@/lib/odds/tennisLines';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 3 * 60 * 1000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!eventId || !start || !end) {
    return NextResponse.json({ error: 'eventId, start and end are required.' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `tennis:moneylines:route:${tour}:${eventId}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const { draw } = await getTournamentDraw(tour, eventId, start, end);
      const upcoming = (draw?.matches ?? []).filter((m) => !m.completed);
      const matches = upcoming.map((m) => ({
        matchId: m.matchId,
        homeAthleteId: m.home.athleteId,
        homeName: m.home.name,
        awayAthleteId: m.away.athleteId,
        awayName: m.away.name,
      }));
      return getTennisMatchMoneylines(tour, matches);
    },
    errorMessage: 'Tennis moneyline lookup failed.',
    request,
  });
}
