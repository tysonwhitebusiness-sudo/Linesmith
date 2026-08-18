/**
 * GET /api/props/elo-sanity?sport=mlb — current Elo rating for every team,
 * sorted, so a glance catches something obviously broken (a team frozen at
 * the 1500 starting value mid-season, an unexplained outlier) without
 * needing to know a single team's rating history by heart.
 */

import { NextResponse } from 'next/server';
import { getAllTeams, easternDate } from '@/lib/sports/mlb/statsapi';
import { getCurrentElo } from '@/lib/sports/mlb/eloModel';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const season = Number(easternDate().slice(0, 4));
    const teams = await getAllTeams();

    const ratings = teams.map((t) => {
      const current = getCurrentElo(t.id, season);
      return {
        teamId: t.id,
        name: t.name,
        abbreviation: t.abbreviation,
        elo: Math.round(current.elo),
        gamesPlayed: current.gamesPlayed,
      };
    });

    ratings.sort((a, b) => b.elo - a.elo);

    return NextResponse.json({ season, teams: ratings });
  } catch (error) {
    console.error('[api/props/elo-sanity]', error);
    return NextResponse.json(
      { error: 'Elo sanity check failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
