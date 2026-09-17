/**
 * One MLB team's Statcast season rollup — both sides, including the vs-hand
 * splits compare needs.
 *
 * GET /api/mlb/team-statcast-season?teamId=147&season=2026
 *
 * NOT the same thing as `/api/mlb/team-statcast`, which serves the older
 * league-wide contact rollup as display tiles and carries no hand splits. This
 * reads `mlb_team_statcast` (R5a, written by the Python rollup) and answers with
 * the stored payload for one team: `bat` (the lineup), `pit` (the staff), each
 * with `vsHand`. Feeds R10.4's "what this staff allows to left-handed hitters".
 *
 * PATTERN 2 — a direct read of a table whose sole writer is the Python job
 * (CLAUDE.md), so there is nothing here to cache beyond what Postgres already
 * does.
 */

import { NextResponse } from 'next/server';
import { readTeamStatcast } from '@/lib/sports/mlb/statcastRollups';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get('teamId');
  const season = Number(url.searchParams.get('season'));
  if (!teamId || !/^\d{1,4}$/.test(teamId)) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: 'season is required' }, { status: 400 });
  }
  const rows = await readTeamStatcast(teamId, season).catch(() => []);
  if (!rows.length) return NextResponse.json({ error: 'no rollup for this team and season' }, { status: 404 });
  return NextResponse.json({
    teamId,
    season,
    bat: rows.find((r) => r.side === 'bat')?.payload ?? null,
    pit: rows.find((r) => r.side === 'pit')?.payload ?? null,
    asOf: rows[0].asOf,
  });
}
