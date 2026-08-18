/**
 * GET /api/mlb/home-run-candidates — today's top 15 home-run candidates,
 * ranked by the standalone home-run model's own probability (the active
 * fitted version when one exists, the Beta-Binomial baseline otherwise — see
 * adapter.ts's Phase 6 wiring). Same filter+sort AppShell's `views.homeRuns`
 * already does for the Scan tab, just server-side and reading straight off
 * the already-cached slate snapshot (`mlb:snapshot`, populated by the main
 * /api/mlb route) instead of shipping the whole ~19MB snapshot down to a
 * small "Today's Picks" panel that only needs 15 rows of it.
 *
 * Returns an empty list rather than rebuilding the snapshot on a cache miss
 * — this is a lightweight companion view, not the primary data path, so it
 * shouldn't trigger its own expensive slate rebuild. Whoever loads Scan (or
 * this app's own polling) keeps the cache warm.
 */

import { NextResponse } from 'next/server';
import { readSnapshotCache } from '@/lib/db/client';
import type { PickCandidate } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

const TODAY_CACHE_KEY = 'mlb:snapshot';
const TOP_N = 15;

function modelProbOf(candidate: PickCandidate): number | null {
  const meta = candidate.subjectMeta as Record<string, unknown> | undefined;
  const prob = meta?.modelProb;
  return typeof prob === 'number' && Number.isFinite(prob) ? prob : null;
}

export async function GET() {
  const cached = readSnapshotCache(TODAY_CACHE_KEY);
  if (!cached) {
    return NextResponse.json({ candidates: [], fetchedAt: null });
  }

  let snapshot: { candidates?: PickCandidate[] };
  try {
    snapshot = JSON.parse(cached.payload);
  } catch {
    return NextResponse.json({ candidates: [], fetchedAt: null });
  }

  const ranked = (snapshot.candidates ?? [])
    .filter((c) => c.dimension === 'home-runs')
    .map((c) => ({ candidate: c, prob: modelProbOf(c) }))
    .filter((r): r is { candidate: PickCandidate; prob: number } => r.prob != null)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, TOP_N)
    .map((r) => r.candidate);

  return NextResponse.json({ candidates: ranked, fetchedAt: cached.fetchedAt });
}
