/**
 * Injury lists for specific teams.
 *
 * GET /api/mlb/injuries?teamIds=110,142
 *
 * Split out of the slate snapshot on purpose: this costs one roster request per
 * team, and folding a whole slate's worth into the snapshot put ~30 calls on
 * the critical path of Scan, which never shows injuries. Game Detail asks for
 * the two teams it is actually displaying.
 */

import { NextResponse } from 'next/server';
import { easternDate, getInjuries } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamIds = (url.searchParams.get('teamIds') ?? '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (teamIds.length === 0) {
    return NextResponse.json({ error: 'teamIds is required' }, { status: 400 });
  }

  const season = Number(easternDate().slice(0, 4));

  try {
    const lists = await Promise.all(teamIds.map((id) => getInjuries(id, season)));
    return NextResponse.json({
      byTeam: Object.fromEntries(teamIds.map((id, i) => [id, lists[i]])),
      // The league's roster reports that a player is unavailable and for how
      // long, but not what for. Stated here so the UI doesn't have to guess.
      injuryDetailAvailable: false,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Injury lookup failed' },
      { status: 502 },
    );
  }
}
