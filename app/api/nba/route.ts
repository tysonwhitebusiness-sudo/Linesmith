import { buildNbaSnapshot } from '@/lib/sports/nba/adapter';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TTL_MS = 4 * 60_000;

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'nba:snapshot',
    ttlMs: TTL_MS,
    build: () => buildNbaSnapshot(),
    errorMessage: 'NBA snapshot failed',
    request,
  });
}
