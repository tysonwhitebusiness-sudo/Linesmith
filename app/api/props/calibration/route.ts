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

import { computeCalibrationPayload, calibrationCacheKey, CALIBRATION_TTL_MS } from '@/lib/odds/props/calibrationSnapshot';
import type { CalibrationScope } from '@/lib/db/client';
import { cachedRoute } from '@/lib/cachedRoute';

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
  // Real, not cosmetic (Phase 2 of docs/scan-playerdetail-parity-gameplan-
  // 2026-08-27.md) — default 'mlb' preserves every existing caller's
  // behavior exactly; every other sport's Scan/PlayerDetail page now
  // passes its own real sport instead of silently reading MLB's data.
  const sport = url.searchParams.get('sport') ?? 'mlb';

  return cachedRoute({
    cacheKey: calibrationCacheKey(sport, scope, dimension),
    ttlMs: CALIBRATION_TTL_MS,
    build: () => computeCalibrationPayload(sport, scope, dimension),
    errorMessage: 'Calibration lookup failed',
    request,
  });
}
