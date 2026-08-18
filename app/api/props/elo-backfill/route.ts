/**
 * POST /api/props/elo-backfill — walks one or more seasons chronologically
 * and writes every team's Elo trajectory (team_elo_history). Defaults to
 * just the current season (original behavior). Pass ?seasons=2010-2025 (or
 * a comma list) to backfill historical seasons — these MUST run in
 * ascending order in one request (not fired off in parallel), since each
 * season's season-reversion starting point reads the prior season's just-
 * written final rating via getLatestEloBeforeSeason. Idempotent — safe to
 * re-run; UNIQUE(team_id, season, game_pk) no-ops already-recorded games.
 */

import { NextResponse } from 'next/server';
import { refreshEloBackfill } from '@/lib/sports/mlb/eloModel';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

function parseSeasonList(raw: string | null): number[] | null {
  if (!raw) return null;
  const seasons: number[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d{4})-(\d{4})$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let s = start; s <= end; s++) seasons.push(s);
    } else {
      seasons.push(Number(trimmed));
    }
  }
  return seasons.sort((a, b) => a - b);
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seasons = parseSeasonList(searchParams.get('seasons')) ?? [Number(easternDate().slice(0, 4))];
    const results: Array<{ season: number; gamesWalked: number; rowsWritten: number }> = [];
    for (const season of seasons) {
      const summary = await refreshEloBackfill(season);
      results.push({ season, ...summary });
    }
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[api/props/elo-backfill]', error);
    return NextResponse.json(
      { error: 'Elo backfill failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
