/**
 * GET /api/model-status
 *
 * M1's register: what each sport's model is (`none` · `baseline` · `gated` ·
 * `failed`), its evidence, and the pre-registered gate that would move it.
 *
 * Pure read of `model_status`, which Python's `modelStatusJob` owns (CLAUDE.md
 * pattern 2: the table is kept fresh out of band, never by a request). The
 * display rule that consumes these rows lives in `lib/models/modelStatus.ts`,
 * so every surface answers "may I show a probability here?" the same way.
 */
import { cachedRoute } from '@/lib/cachedRoute';
import { readModelStatus } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

// A status changes when a fit or a promotion test says so — daily at most.
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'model-status:route:v1',
    ttlMs: CACHE_TTL_MS,
    routeName: 'model-status',
    errorMessage: 'Model status read failed',
    request,
    build: async () => ({ rows: await readModelStatus(), fetchedAt: new Date().toISOString() }),
  });
}
