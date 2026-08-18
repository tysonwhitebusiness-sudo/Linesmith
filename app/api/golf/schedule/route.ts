import { getSeasonSchedule } from '@/lib/sports/golf/schedule';
import { cachedRoute } from '@/lib/cachedRoute';

export const dynamic = 'force-dynamic';

// getSeasonSchedule already has its own 24h in-process TTL cache
// (schedule.ts) — reset on every server restart. The season schedule
// genuinely doesn't change intra-day, so 24h here matches the source's own
// promise exactly while surviving restarts.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const yearParam = url.searchParams.get('year');
  const yearInput = yearParam ? Number(yearParam) : new Date().getFullYear();
  const year = Number.isFinite(yearInput) ? yearInput : new Date().getFullYear();

  // Namespaced distinctly from getSeasonSchedule's own internal cache key
  // (`golf:schedule:${year}`, lib/sports/golf/schedule.ts) — that key holds
  // just the raw events array, a different shape than this route's wrapped
  // {events, fetchedAt, fromCache, warnings} response. Reusing the same key
  // here collided with it: this route would read the library's raw-array
  // entry and serve it directly, dropping the wrapper (caught live — the
  // response came back as a bare array instead of {events: [...]}).
  return cachedRoute({
    cacheKey: `golf:schedule:route:${year}`,
    ttlMs: CACHE_TTL_MS,
    build: () => getSeasonSchedule(year),
    errorMessage: 'Golf schedule lookup failed.',
  });
}
