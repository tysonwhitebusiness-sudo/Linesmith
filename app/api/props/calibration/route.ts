/**
 * GET /api/props/calibration[?scope=player|game|all][&dimension=X]
 *
 * Phase C.0.5 (+ G7) — reliability data for /diagnostics: does the model's
 * predicted probability actually match the realized rate. Reads
 * `pick_history` directly; no live fetches, no odds budget spent. Scoped
 * separately for player props vs. the game-level (moneyline) model — mixing
 * them into one Brier score would blend two very different predictions into
 * a misleading average.
 *
 * Cached for `CALIBRATION_TTL_MS` (see calibrationSnapshot.ts) — the six
 * underlying queries scan `pick_history` fresh every call otherwise, which
 * doesn't need to happen on every request when the table itself only
 * changes as picks get graded, not on every page load.
 */

import { NextResponse } from 'next/server';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { jsonPassthrough } from '@/lib/db/jsonPassthrough';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';
import { computeCalibrationPayload, calibrationCacheKey, CALIBRATION_TTL_MS } from '@/lib/odds/props/calibrationSnapshot';
import type { CalibrationScope } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scopeParam = url.searchParams.get('scope');
  const scope: CalibrationScope = scopeParam === 'player' || scopeParam === 'game' ? scopeParam : 'all';
  // Optional — when set, overrides scope for counts/buckets so a single
  // market (e.g. 'total') gets its own reliability diagram instead of being
  // blended with the rest of its scope. Model Health's split calibration
  // panel is the only caller that passes this.
  const dimension = url.searchParams.get('dimension');
  const cacheKey = calibrationCacheKey(scope, dimension);

  const cached = readSnapshotCache(cacheKey);
  const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

  if (cached && age < CALIBRATION_TTL_MS) {
    return jsonPassthrough(cached.payload, 'hit');
  }

  if (cached) {
    triggerBackgroundRebuild(cacheKey, async () => {
      const payload = await computeCalibrationPayload(scope, dimension);
      writeSnapshotCache(cacheKey, JSON.stringify(payload));
    });
    return jsonPassthrough(cached.payload, 'stale');
  }

  // Nothing cached yet — joins the same dedup pool the stale-path and the
  // proactive scheduler use, so this doesn't duplicate a rebuild already in
  // flight for this exact key.
  const payload = await awaitRebuild(cacheKey, async () => {
    const result = await computeCalibrationPayload(scope, dimension);
    try {
      writeSnapshotCache(cacheKey, JSON.stringify(result));
    } catch {
      // Non-critical — next request just recomputes.
    }
    return result;
  });
  return NextResponse.json(payload, { headers: { 'x-cache': 'miss' } });
}
