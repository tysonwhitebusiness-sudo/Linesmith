/**
 * One golfer's season depth — strokes-gained (pgatourStats.ts) + tournament
 * log (playerSeason.ts) — GET /api/golf/player/[playerId]
 *
 * Reads the field to match against from the golf snapshot's own cache, same
 * as api/golf/lines/route.ts.
 */

import { NextResponse } from 'next/server';
import { getGolferStrokesGained, getGolferAdvancedStats } from '@/lib/sports/golf/pgatourStats';
import { getPlayerSeasonLog } from '@/lib/sports/golf/playerSeason';
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

export async function GET(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;

  try {
    const subjects = readGolfSubjects();
    const [strokesGained, seasonLog, advanced] = await Promise.all([
      getGolferStrokesGained(playerId, subjects),
      getPlayerSeasonLog(playerId),
      getGolferAdvancedStats(playerId, subjects),
    ]);

    return NextResponse.json(
      { strokesGained, seasonLog, advancedStats: advanced.stats, advancedWarnings: advanced.warnings },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[api/golf/player]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Golf player lookup failed.' },
      { status: 502 },
    );
  }
}
