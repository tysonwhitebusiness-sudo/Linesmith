/**
 * One golfer's season depth — strokes-gained (pgatourStats.ts) + tournament
 * log (playerSeason.ts) — GET /api/golf/player/[playerId]
 *
 * Reads the field to match against from the golf snapshot's own cache, same
 * as api/golf/lines/route.ts.
 */

import { getGolferStrokesGained, getGolferAdvancedStats } from '@/lib/sports/golf/pgatourStats';
import { getPlayerSeasonLog } from '@/lib/sports/golf/playerSeason';
import { readSnapshotCache } from '@/lib/db/client';
import type { SubjectSummary } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// All three constituents (getGolferStrokesGained, getPlayerSeasonLog,
// getGolferAdvancedStats) already have their own 24h in-process TTL caches,
// under keys distinct from this route's own (see CLAUDE.md's note on
// avoiding key collisions) — season-depth stats don't change intra-day, so
// 24h here matches all three sources' own promise while surviving restarts.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  const year = new Date().getFullYear();

  return cachedRoute({
    cacheKey: `golf:player:route:${playerId}:${year}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const subjects = readGolfSubjects();
      const [strokesGained, seasonLog, advanced] = await Promise.all([
        getGolferStrokesGained(playerId, subjects),
        getPlayerSeasonLog(playerId),
        getGolferAdvancedStats(playerId, subjects),
      ]);
      return { strokesGained, seasonLog, advancedStats: advanced.stats, advancedWarnings: advanced.warnings };
    },
    errorMessage: 'Golf player lookup failed.',
  });
}
