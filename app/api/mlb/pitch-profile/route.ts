/**
 * One subject's pitch-level profile — the read path for Phase 6.6.
 *
 * GET /api/mlb/pitch-profile?role=pitcher&subjectId=666200&season=2026
 *
 * Feeds MLB's `usageMix` (pitch mix) and `spatialGrid` (strike zone) roles,
 * the two that had no source before `mlb_pitch_events` existed.
 *
 * CACHING — pattern 1 (`cachedRoute`), per CLAUDE.md's convention. The
 * underlying table holds ~700k rows per season and both aggregates are indexed
 * scans over one subject's slice, so this is not free; and a player page is
 * exactly the kind of thing that gets reloaded repeatedly.
 *
 * TTL is 30 minutes, grounded in how fast the data actually moves:
 * `ingestStatcastPitchesJob` runs hourly, so anything shorter re-computes an
 * identical answer and anything much longer would sit behind a fresh ingest
 * for no reason.
 *
 * CACHE KEY: `mlb:pitch-profile:{role}:{subjectId}:{season}` — grepped before
 * choosing, per the warning about `snapshot_cache` being one flat namespace.
 * Nothing else uses a `mlb:pitch-profile:` prefix.
 */

import { NextResponse } from 'next/server';
import { cachedRoute } from '@/lib/cachedRoute';
import { getPitchProfile } from '@/lib/sports/mlb/pitchProfile';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Bounded before it reaches a cache key — task 3.5's lesson: an unbounded id
 * mints a permanent `snapshot_cache` row per value, and `Number.isFinite(x) &&
 * x > 0` accepted 888801, 1e9 and 2.5 alike.
 */
function parseId(raw: string | null): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 9_999_999) return null;
  return n;
}

function parseSeason(raw: string | null): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2024 || n > 2100) return null;
  return n;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const role = url.searchParams.get('role');
  if (role !== 'pitcher' && role !== 'batter') {
    return NextResponse.json({ error: "role must be 'pitcher' or 'batter'" }, { status: 400 });
  }

  const subjectId = parseId(url.searchParams.get('subjectId'));
  if (subjectId == null) {
    return NextResponse.json({ error: 'subjectId must be a positive integer' }, { status: 400 });
  }

  // Floor is 2024, not 2000: that is the operator-approved ingest scope, and a
  // request for 2019 would cache an empty profile that looks like a real
  // "this player threw nothing" answer.
  const season = parseSeason(url.searchParams.get('season') ?? String(new Date().getUTCFullYear()));
  if (season == null) {
    return NextResponse.json(
      { error: 'season must be a year from 2024 onwards — mlb_pitch_events holds nothing earlier' },
      { status: 400 },
    );
  }

  return cachedRoute({
    cacheKey: `mlb:pitch-profile:${role}:${subjectId}:${season}`,
    ttlMs: CACHE_TTL_MS,
    routeName: 'mlb/pitch-profile',
    build: () => getPitchProfile(role, subjectId, season),
    errorMessage: 'Pitch profile lookup failed',
    request,
  });
}
