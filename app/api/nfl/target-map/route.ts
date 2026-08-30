/**
 * GET /api/nfl/target-map?receiverId=00-0036900&season=2024
 *
 * One NFL receiver's target map — the read path for Phase 6.8.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. `nfl_target_events` holds
 * ~18k rows per season and this is an indexed scan over one receiver's slice.
 *
 * TTL is 6 HOURS, not the 30 minutes the pitch and shot profiles use, and the
 * difference is grounded in the writer: `ingestNflPbpJob` runs DAILY because
 * nflverse republishes a whole 99 MB season file rather than an increment. A
 * 30-minute TTL against a daily writer just recomputes an identical answer
 * forty-seven times.
 *
 * CACHE KEY: `nfl:target-map:{receiverId}:{season}` — grepped before choosing.
 * Nothing else uses an `nfl:target-map:` prefix.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getNflTargetMap } from '@/lib/sports/nfl/targetMap';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * GSIS ids look like `00-0036900` — text, not numbers. Bounded by shape before
 * reaching a cache key (task 3.5: an unbounded id mints a permanent
 * `snapshot_cache` row per value).
 */
const RECEIVER_ID = /^[0-9]{2}-[0-9]{7}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);

  const receiverId = url.searchParams.get('receiverId') ?? '';
  if (!RECEIVER_ID.test(receiverId)) {
    return NextResponse.json({ error: 'receiverId must be a GSIS id like 00-0036900' }, { status: 400 });
  }

  const season = Number(url.searchParams.get('season'));
  if (!Number.isInteger(season) || season < 1999 || season > 2100) {
    return NextResponse.json({ error: 'season must be a year from 1999 onwards' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `nfl:target-map:${receiverId}:${season}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'nfl/target-map',
    build: () => getNflTargetMap(receiverId, season),
    errorMessage: 'Target map lookup failed',
    request,
  });
}
