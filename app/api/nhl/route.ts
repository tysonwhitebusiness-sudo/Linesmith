import { buildNhlSnapshot } from '@/lib/sports/nhl/adapter';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TTL_MS = 4 * 60_000;

export async function GET(request: Request) {
  return cachedRoute({
    cacheKey: 'nhl:snapshot',
    ttlMs: TTL_MS,
    build: () => buildNhlSnapshot(),
    errorMessage: 'NHL snapshot failed',
    request,
  });
}
