/**
 * GET /api/nba/shot-profile?shooterId=4277905&season=2025
 *
 * One NBA shooter's shot map — the read path for Phase 6.7.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. `nba_shot_events` holds
 * ~230k rows per season and this is an indexed scan over one shooter's slice,
 * so it is not free; and a player page is exactly the kind of thing reloaded
 * repeatedly.
 *
 * TTL is 30 minutes, grounded in the writer: `ingestNbaShotsJob` runs hourly,
 * so anything shorter recomputes an identical answer and anything much longer
 * would sit behind a fresh ingest for no reason. Same reasoning, same number as
 * `/api/mlb/pitch-profile`.
 *
 * CACHE KEY: `nba:shot-profile:{shooterId}:{season}` — grepped before choosing,
 * per the warning about `snapshot_cache` being one flat namespace. Nothing else
 * uses an `nba:shot-profile:` prefix.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getNbaShotProfile } from '@/lib/sports/nba/shotProfile';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Bounded before it reaches a cache key — task 3.5's lesson, that an unbounded
 * id mints a permanent `snapshot_cache` row per value.
 */
function parseShooterId(raw: string | null): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 99_999_999) return null;
  return n;
}

/** ESPN's season year — 2025 for the 2024-25 season. */
function parseSeason(raw: string | null): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return null;
  return n;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const shooterId = parseShooterId(url.searchParams.get('shooterId'));
  if (shooterId == null) {
    return NextResponse.json({ error: 'shooterId must be a positive integer' }, { status: 400 });
  }

  const season = parseSeason(url.searchParams.get('season'));
  if (season == null) {
    return NextResponse.json({ error: 'season must be an ESPN season year like 2025' }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `nba:shot-profile:${shooterId}:${season}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'nba/shot-profile',
    build: () => getNbaShotProfile(shooterId, season),
    errorMessage: 'Shot profile lookup failed',
    request,
  });
}
