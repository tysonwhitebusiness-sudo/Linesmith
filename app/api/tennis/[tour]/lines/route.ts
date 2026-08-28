/**
 * Tennis Tournament Winner odds — GET /api/tennis/[tour]/lines?tournamentName=...
 *
 * Reads the field to match against straight from the tennis snapshot's own
 * cache (`snapshot_cache`, key `tennis:snapshot:{tour}`) rather than
 * re-fetching ESPN — same reasoning golf's lines route gives for reading its
 * own snapshot cache instead of re-deriving the roster.
 */

import { NextResponse } from 'next/server';
import { getTennisTournamentLines } from '@/lib/odds/tennisLines';
import { readSnapshotCache } from '@/lib/db/client';
import type { SubjectSummary, TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// getTennisTournamentLines already TTLs against its own odds_cache row
// (5min) — this outer layer adds stale-while-revalidate on top, matching
// golf's own lines route exactly.
const CACHE_TTL_MS = 5 * 60 * 1000;

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

async function readTennisSubjects(tour: TennisTour): Promise<SubjectSummary[]> {
  const cached = await readSnapshotCache(`tennis:snapshot:${tour}`);
  if (!cached) return [];
  try {
    const snapshot = JSON.parse(cached.payload);
    return (snapshot?.subjects ?? []) as SubjectSummary[];
  } catch {
    return [];
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ tour: string }> }) {
  const { tour } = await params;
  if (!isTennisTour(tour)) {
    return NextResponse.json({ error: `Unknown tour "${tour}"` }, { status: 400 });
  }

  const url = new URL(request.url);
  const tournamentName = url.searchParams.get('tournamentName');
  const force = url.searchParams.get('force') !== null;
  if (!tournamentName) {
    return NextResponse.json({ error: 'tournamentName is required.' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `tennis:lines:route:${tour}:${tournamentName}`,
    ttlMs: CACHE_TTL_MS,
    force,
    build: async () => getTennisTournamentLines(tour, tournamentName, await readTennisSubjects(tour), force),
    errorMessage: 'Tennis lines lookup failed.',
    request,
  });
}
