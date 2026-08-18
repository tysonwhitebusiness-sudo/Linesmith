/**
 * Every qualified batter on one team's roster, with their overall + position
 * Statcast rank — the whole-roster equivalent of `ownStatcastSummary`
 * (adapter.ts), which only ever covers batters who generated a candidate in
 * today's lineup. TeamDetail's roster list shows the full 40-man roster, most
 * of whom never touch that path, so this reads straight from the same
 * `batterRankings` pool instead.
 *
 * GET /api/mlb/team-batter-ranks?teamId=147
 *
 * Split out for the same "Game/Team Detail only" reason /api/mlb/bullpen and
 * /api/mlb/team-statcast are — safe to call the refreshing (not cache-only)
 * ranking getter since a normal scan never pays for it.
 */

import { NextResponse } from 'next/server';
import { getBatterRankings } from '@/lib/sports/mlb/batterRankings';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));

  if (!Number.isFinite(teamId) || teamId <= 0) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  try {
    const season = Number(easternDate().slice(0, 4));
    const rankings = await getBatterRankings(season);

    const batters = rankings.batters
      .filter((b) => b.teamId === teamId)
      .map((b) => ({
        personId: b.personId,
        overallRank: b.overallRank,
        poolSize: b.poolSize,
        position: b.position,
        positionRank: b.positionRank,
        positionPoolSize: b.positionPoolSize,
        composite: b.composite,
      }));

    return NextResponse.json({ batters, computedAt: rankings.computedAt, season });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Team batter rankings lookup failed' },
      { status: 502 },
    );
  }
}
