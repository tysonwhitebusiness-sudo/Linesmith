/**
 * One subject's pitch profile.
 *
 * GET /api/mlb/pitch-profile?role=pitcher&subjectId=666200&season=2026
 *
 * Feeds MLB's `usageMix` (pitch mix), `spatialGrid` (strike zone) and platoon
 * roles.
 *
 * PATTERN 2 — a direct read, refreshed out of band (CLAUDE.md). This route used
 * `cachedRoute()` because it aggregated `mlb_pitch_events` per request; since
 * R5 it reads one row of `mlb_statcast_player_season`, which
 * `build_statcast_rollups.py` rewrites after every corpus refresh. See
 * `lib/sports/mlb/pitchProfile.ts` for why: the old aggregates had been
 * reading a five-day hot window as the season.
 *
 * R6 builds the new MLB cards on `/api/mlb/statcast/player/[playerId]`, which
 * returns the whole rollup; this route stays until the cards it feeds are
 * replaced, then goes with them.
 */

import { NextResponse } from 'next/server';
import { getPitchProfile } from '@/lib/sports/mlb/pitchProfile';
import { parseMlbId, parseStatcastSeason } from '@/lib/sports/mlb/statcastParams';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);

  const role = url.searchParams.get('role');
  if (role !== 'pitcher' && role !== 'batter') {
    return NextResponse.json({ error: "role must be 'pitcher' or 'batter'" }, { status: 400 });
  }
  const subjectId = parseMlbId(url.searchParams.get('subjectId'));
  if (subjectId == null) {
    return NextResponse.json({ error: 'subjectId must be a positive integer' }, { status: 400 });
  }
  const season = parseStatcastSeason(url.searchParams.get('season') ?? String(new Date().getUTCFullYear()));
  if (season == null) {
    return NextResponse.json({ error: 'season must be a year from 2025 onwards' }, { status: 400 });
  }

  try {
    const profile = await getPitchProfile(role, subjectId, season);
    if (!profile) {
      return NextResponse.json({ error: `No Statcast pitches on record for ${role} ${subjectId} in ${season}` }, { status: 404 });
    }
    return NextResponse.json(profile);
  } catch {
    return NextResponse.json({ error: 'Pitch profile lookup failed' }, { status: 500 });
  }
}
