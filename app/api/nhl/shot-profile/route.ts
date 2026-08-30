/**
 * GET /api/nhl/shot-profile?shooterId=8478400&season=20242025
 *
 * One NHL shooter's shot map — the read path for Phase 6.7.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md. `nhl_shot_events` holds
 * ~230k rows per season and this is an indexed scan over one shooter's slice,
 * so it is not free; and a player page is exactly the kind of thing reloaded
 * repeatedly.
 *
 * TTL is 30 minutes, grounded in the writer: `ingestNhlShotsJob` runs hourly,
 * so anything shorter recomputes an identical answer and anything much longer
 * would sit behind a fresh ingest for no reason. Same reasoning, same number as
 * `/api/mlb/pitch-profile`.
 *
 * CACHE KEY: `nhl:shot-profile:{shooterId}:{season}` — grepped before choosing,
 * per the warning about `snapshot_cache` being one flat namespace. Nothing else
 * uses an `nhl:shot-profile:` prefix.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getNhlShotProfile } from '@/lib/sports/nhl/shotProfile';

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

/** The NHL writes a season as '20242025'. An allowlist by shape, not a range. */
function parseSeason(raw: string | null): string | null {
  if (raw == null || !/^\d{8}$/.test(raw)) return null;
  const start = Number(raw.slice(0, 4));
  const end = Number(raw.slice(4));
  if (end !== start + 1 || start < 2000 || start > 2100) return null;
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const shooterId = parseShooterId(url.searchParams.get('shooterId'));
  if (shooterId == null) {
    return NextResponse.json({ error: 'shooterId must be a positive integer' }, { status: 400 });
  }

  const season = parseSeason(url.searchParams.get('season'));
  if (season == null) {
    return NextResponse.json({ error: "season must be an NHL season string like '20242025'" }, { status: 400 });
  }

  return cachedRoute({
    cacheKey: `nhl:shot-profile:${shooterId}:${season}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'nhl/shot-profile',
    build: () => getNhlShotProfile(shooterId, season),
    errorMessage: 'Shot profile lookup failed',
    request,
  });
}
