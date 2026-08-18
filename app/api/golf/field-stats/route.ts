/**
 * Season strokes-gained for the whole current field at once — GET /api/golf/field-stats
 *
 * `getSeasonStrokesGained` already fetches and matches the entire tour in one
 * call (see api/golf/player/[playerId]/route.ts, which just filters that same
 * result to one golfer); this exposes the unfiltered field-wide result for
 * the Tournament Detail page's Advanced Stats section, so it doesn't need 69
 * separate per-golfer requests.
 */

import { getSeasonStrokesGained } from '@/lib/sports/golf/pgatourStats';
import { readSnapshotCache } from '@/lib/db/client';
import type { SubjectSummary } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// getSeasonStrokesGained already has its own 24h in-process TTL cache
// (pgatourStats.ts, key `golf:pgatour-sg:${year}` — distinct from this
// route's own key below, see CLAUDE.md's note on avoiding key collisions).
// Season strokes-gained aggregates don't change intra-day, so 24h here
// matches the source's own promise while surviving restarts.
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

export async function GET() {
  const year = new Date().getFullYear();

  return cachedRoute({
    cacheKey: `golf:field-stats:route:${year}`,
    ttlMs: CACHE_TTL_MS,
    build: async () => {
      const subjects = readGolfSubjects();
      const result = await getSeasonStrokesGained(subjects);
      // Only golfers actually in today's field resolved to a real espnId —
      // the rest of the tour rode along in the same fetch but isn't relevant here.
      const golfers = result.golfers.filter((g) => g.espnId !== null);
      return { ...result, golfers };
    },
    errorMessage: 'Golf field stats lookup failed.',
  });
}
