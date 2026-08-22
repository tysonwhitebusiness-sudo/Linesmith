import { getGolfSnapshot } from '@/lib/sports/golf/adapter';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  // Stale-serve-then-refresh-in-background — a stale cache used to still
  // block the response on a full ESPN+weather+PGA-Tour rebuild (measured
  // 14.3s on a cold cache).
  return cachedRoute({
    cacheKey: 'golf:snapshot',
    ttlMs: CACHE_TTL_MS,
    build: getGolfSnapshot,
    errorMessage: 'Golf snapshot failed',
    request,
  });
}
