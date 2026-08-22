import { buildNflSnapshot } from '@/lib/sports/nfl/adapter';
import { ensureSchedulerStarted } from '@/lib/scheduler';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

ensureSchedulerStarted();

// Matches Tier 1's own refresh cadence for MLB — no point rebuilding faster
// than the underlying prop_odds rows change.
const TTL_MS = 4 * 60_000;

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'nfl:snapshot',
    ttlMs: TTL_MS,
    build: buildNflSnapshot,
    errorMessage: 'NFL snapshot failed',
    request,
  });
}
