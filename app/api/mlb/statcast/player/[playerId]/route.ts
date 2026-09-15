/**
 * One MLB player's Statcast season — the R5a rollup, as a hitter and/or pitcher.
 *
 * GET /api/mlb/statcast/player/677951?season=2026
 *
 * Feeds R6's "Contact quality & approach" (hitter) and "Arsenal & command"
 * (pitcher) sections. Shape: `lib/sports/mlb/statcastRollupShapes.ts`.
 *
 * PATTERN 2 — a direct read of `mlb_statcast_player_season`, which
 * `build_statcast_rollups.py` rewrites after every corpus refresh (CLAUDE.md).
 * One indexed row per role; nothing to cache. Each row carries `asOf`, so a card
 * can say how current it is.
 */

import { NextResponse } from 'next/server';
import { readPlayerStatcast } from '@/lib/sports/mlb/statcastRollups';
import { parseMlbId, parseStatcastSeason } from '@/lib/sports/mlb/statcastParams';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const { playerId: raw } = await params;
  const playerId = parseMlbId(raw);
  if (playerId == null) return NextResponse.json({ error: 'playerId must be a positive integer' }, { status: 400 });
  const url = new URL(request.url);
  const season = parseStatcastSeason(url.searchParams.get('season') ?? String(new Date().getUTCFullYear()));
  if (season == null) return NextResponse.json({ error: 'season must be a year from 2025 onwards' }, { status: 400 });

  try {
    const rows = await readPlayerStatcast(playerId, season);
    if (!rows.length) {
      return NextResponse.json({ error: `No Statcast pitches on record for player ${playerId} in ${season}` }, { status: 404 });
    }
    return NextResponse.json({
      season,
      playerId,
      batting: rows.find((r) => r.role === 'bat') ?? null,
      pitching: rows.find((r) => r.role === 'pit') ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Statcast lookup failed' }, { status: 500 });
  }
}
