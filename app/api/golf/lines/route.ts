/**
 * Golf Match Winner odds — GET /api/golf/lines
 *
 * Reads the field to match against straight from the golf snapshot's own
 * cache (`snapshot_cache`, key `golf:snapshot`) rather than re-fetching
 * ESPN — this route only needs the subject list (id + name) for name
 * matching, and the snapshot route (api/golf/route.ts) already refreshes
 * that on its own 5-minute cycle.
 */

import { getGolfTournamentLines } from '@/lib/odds/golfLines';
import { readSnapshotCache } from '@/lib/db/client';
import type { SubjectSummary } from '@/lib/core/types';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// getGolfTournamentLines already TTLs and force-bypasses against its own
// odds_cache table (5min, lib/odds/golfLines.ts — a different table from
// snapshot_cache, so no key-collision risk), but that layer is blocking on a
// miss. This outer layer adds real stale-while-revalidate on top: a stale
// hit here is served instantly while a background rebuild (which itself
// still respects the inner 5min TTL) refreshes it. TTL matches the inner
// layer so this never serves data staler than what it already promises.
const CACHE_TTL_MS = 5 * 60 * 1000;

async function readGolfSubjects(): Promise<SubjectSummary[]> {
  const cached = await readSnapshotCache('golf:snapshot');
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

  return cachedRoute({
    cacheKey: 'golf:lines:route',
    ttlMs: CACHE_TTL_MS,
    force,
    build: async () => getGolfTournamentLines(await readGolfSubjects(), force),
    errorMessage: 'Golf lines lookup failed.',
    request,
  });
}
