/**
 * Bullpen strength for exactly two teams — closer + top setup relievers.
 *
 * GET /api/mlb/bullpen?teamA=147&teamB=136
 *
 * Split out of the slate snapshot for the same reason `/api/mlb/recent` is:
 * Scan never shows this, only Game Detail does, and only for the two teams
 * on screen — no reason to cost the critical path of every scan refresh.
 * Wraps the already-24h-cached `getPitcherRoleRankings` (built for
 * `/diagnostics`) and filters its full ~536-pitcher league payload down to
 * just these two teams before it ever leaves the server.
 */

import { NextResponse } from 'next/server';
import { getPitcherRoleRankings, type RankedPitcher } from '@/lib/sports/mlb/pitcherRankings';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

const SETUP_COUNT = 3;

function bullpenFor(teamId: number, closers: RankedPitcher[], relievers: RankedPitcher[]) {
  const closer = closers.find((p) => p.raw.teamId === teamId) ?? null;
  const setup = relievers
    .filter((p) => p.raw.teamId === teamId)
    .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))
    .slice(0, SETUP_COUNT);
  return { closer, setup };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamA = Number(url.searchParams.get('teamA'));
  const teamB = Number(url.searchParams.get('teamB'));

  if (!Number.isFinite(teamA) || !Number.isFinite(teamB) || teamA <= 0 || teamB <= 0) {
    return NextResponse.json({ error: 'teamA and teamB are required' }, { status: 400 });
  }

  try {
    const season = Number(easternDate().slice(0, 4));
    const rankings = await getPitcherRoleRankings(season);

    return NextResponse.json({
      [teamA]: bullpenFor(teamA, rankings.closers, rankings.relievers),
      [teamB]: bullpenFor(teamB, rankings.closers, rankings.relievers),
      computedAt: rankings.computedAt,
      season,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bullpen lookup failed' },
      { status: 502 },
    );
  }
}
