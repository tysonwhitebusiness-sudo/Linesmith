import { NextResponse } from 'next/server';
import { getStandings } from '@/lib/sports/nfl/espn';
import type { TeamStandingRow } from '@/components/useAllTeams';

export const dynamic = 'force-dynamic';

/** All 32 teams with current standings — NFL's version of /api/mlb/teams, same TeamStandingRow shape so StandingsTables/TeamLogo etc. need no changes. */
export async function GET() {
  try {
    const standings = await getStandings();
    const teams: TeamStandingRow[] = standings.map((t) => ({
      teamId: Number(t.teamId),
      name: t.displayName,
      abbreviation: t.abbreviation,
      logoUrl: t.logoUrl ?? '',
      leagueName: t.conference,
      divisionName: `${t.conference} ${t.division}`,
      divisionShortName: t.division,
      wins: t.wins,
      losses: t.losses,
      divisionRank: '',
      gamesBack: '',
      lastTen: null,
    }));
    return NextResponse.json({ teams });
  } catch (error) {
    return NextResponse.json(
      { error: 'NFL teams failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
