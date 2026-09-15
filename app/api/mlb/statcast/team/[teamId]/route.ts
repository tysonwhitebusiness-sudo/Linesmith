/**
 * One MLB team's Statcast season — lineup ('batting') and staff ('pitching'),
 * pitch-weighted, with every team's value and percentiles among them.
 *
 * GET /api/mlb/statcast/team/118?season=2026
 *
 * Feeds R7's team "Contact & pitch quality" and the compare and starters cards.
 * Replaces `teamStatcast.ts`'s per-player average when those cards are rebuilt.
 * Shape: `lib/sports/mlb/statcastRollupShapes.ts`.
 *
 * PATTERN 2 — a direct read of `mlb_statcast_team_season`, rewritten after every
 * corpus refresh by `build_statcast_rollups.py` (CLAUDE.md). Two rows; nothing
 * to cache.
 */

import { NextResponse } from 'next/server';
import { readTeamStatcast } from '@/lib/sports/mlb/statcastRollups';
import { parseMlbId, parseStatcastSeason } from '@/lib/sports/mlb/statcastParams';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId: raw } = await params;
  const teamId = parseMlbId(raw);
  if (teamId == null) return NextResponse.json({ error: 'teamId must be a positive integer' }, { status: 400 });
  const url = new URL(request.url);
  const season = parseStatcastSeason(url.searchParams.get('season') ?? String(new Date().getUTCFullYear()));
  if (season == null) return NextResponse.json({ error: 'season must be a year from 2025 onwards' }, { status: 400 });

  try {
    const rows = await readTeamStatcast(String(teamId), season);
    if (!rows.length) {
      return NextResponse.json({ error: `No Statcast rollup for team ${teamId} in ${season}` }, { status: 404 });
    }
    return NextResponse.json({
      season,
      teamId: String(teamId),
      batting: rows.find((r) => r.side === 'bat') ?? null,
      pitching: rows.find((r) => r.side === 'pit') ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Statcast lookup failed' }, { status: 500 });
  }
}
