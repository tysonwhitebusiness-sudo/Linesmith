/**
 * League-wide production for and allowed, per team, with allowed split by
 * position group — optionally cut at a date, for "strength as of kickoff".
 *
 * GET /api/team-production?sport=nba&season=2026
 * GET /api/team-production?sport=nfl&season=2026&before=2026-09-14
 *
 * Feeds R8's "Strength vs strength" (one side's production against what the
 * other allows, with league ranks), compare's "what this team allows to the
 * position", and R7's team strength. Every team is returned because a rank
 * needs the league. Shape (G2's `matchup-*.json` rollup):
 * `lib/sports/shared/teamProductionShapes.ts`.
 *
 * PATTERN 2 — a direct read of `team_game_production`, rewritten daily by
 * `teamProductionJob` (CLAUDE.md). The query sums per-game rows already rolled
 * up per team, not box scores. Sport is a query param because a dynamic `[sport]` segment beside `app/api/mlb/`
 * and the rest would swallow every unrecognised path.
 */

import { NextResponse } from 'next/server';
import { readLeagueProduction } from '@/lib/sports/shared/teamProduction';
import { TEAM_PRODUCTION_SPORTS, isTeamProductionSport } from '@/lib/sports/shared/teamProductionShapes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') ?? '';
  if (!isTeamProductionSport(sport)) {
    return NextResponse.json({ error: `sport must be one of: ${TEAM_PRODUCTION_SPORTS.join(', ')}` }, { status: 400 });
  }
  const season = Number(url.searchParams.get('season'));
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: "season is required, as player_game_history labels it for this sport" }, { status: 400 });
  }
  const before = url.searchParams.get('before');
  if (before != null && !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return NextResponse.json({ error: 'before must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const body = await readLeagueProduction(sport, season, before);
    if (!Object.keys(body.for).length) {
      return NextResponse.json(
        { error: `No production rolled up for ${sport} ${season}${before ? ` before ${before}` : ''}` },
        { status: 404 },
      );
    }
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: 'Team production lookup failed' }, { status: 500 });
  }
}
