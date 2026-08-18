/**
 * Season strokes-gained for the whole current field at once — GET /api/golf/field-stats
 *
 * `getSeasonStrokesGained` already fetches and matches the entire tour in one
 * call (see api/golf/player/[playerId]/route.ts, which just filters that same
 * result to one golfer); this exposes the unfiltered field-wide result for
 * the Tournament Detail page's Advanced Stats section, so it doesn't need 69
 * separate per-golfer requests.
 */

import { NextResponse } from 'next/server';
import { getSeasonStrokesGained } from '@/lib/sports/golf/pgatourStats';
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

export async function GET() {
  try {
    const subjects = readGolfSubjects();
    const result = await getSeasonStrokesGained(subjects);
    // Only golfers actually in today's field resolved to a real espnId —
    // the rest of the tour rode along in the same fetch but isn't relevant here.
    const golfers = result.golfers.filter((g) => g.espnId !== null);

    return NextResponse.json({ ...result, golfers }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[api/golf/field-stats]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Golf field stats lookup failed.' },
      { status: 502 },
    );
  }
}
