/**
 * Golf Match Winner odds — GET /api/golf/lines
 *
 * Reads the field to match against straight from the golf snapshot's own
 * cache (`snapshot_cache`, key `golf:snapshot`) rather than re-fetching
 * ESPN — this route only needs the subject list (id + name) for name
 * matching, and the snapshot route (api/golf/route.ts) already refreshes
 * that on its own 5-minute cycle.
 */

import { NextResponse } from 'next/server';
import { getGolfTournamentLines } from '@/lib/odds/golfLines';
import { readSnapshotCache } from '@/lib/db/client';
import type { SubjectSummary } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

function readGolfSubjects(): SubjectSummary[] {
  const cached = readSnapshotCache('golf:snapshot');
  if (!cached) return [];
  try {
    const snapshot = JSON.parse(cached.payload);
    return (snapshot?.subjects ?? []) as SubjectSummary[];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get('force') !== null;

  try {
    const subjects = readGolfSubjects();
    const result = await getGolfTournamentLines(subjects, force);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[api/golf/lines]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Golf lines lookup failed.' },
      { status: 502 },
    );
  }
}
