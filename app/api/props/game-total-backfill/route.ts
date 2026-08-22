/**
 * POST /api/props/game-total-backfill
 *
 * Total-market counterpart to /api/props/game-backfill. Unlike that route
 * (which walks the CURRENT season using only the hand-coded formula, since
 * moneyline needs no market line to grade), this needs a real historical
 * total line per game — which only exists for ingested past seasons (see
 * historicalOddsIngest.ts), not the season in progress. Defaults to every
 * season that's actually been ingested; accepts ?seasons=2021-2025 style
 * overrides (comma lists and dash ranges) to backfill a subset.
 */

import { NextResponse } from 'next/server';
import { backfillTotalModel } from '@/lib/sports/mlb/gameModelBackfill';
import { historicalOddsCoverage, logSystemEvent } from '@/lib/db/client';

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
  return [...new Set(seasons)];
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = parseSeasonList(searchParams.get('seasons'));
    const seasons = requested ?? [...new Set((await historicalOddsCoverage()).map((r) => r.season))].sort((a, b) => a - b);

    const results = [];
    for (const season of seasons) {
      const summary = await backfillTotalModel(season);
      results.push({ season, ...summary });
    }

    return NextResponse.json({
      seasons,
      totalGamesConsidered: results.reduce((s, r) => s + r.gamesConsidered, 0),
      totalRowsWritten: results.reduce((s, r) => s + r.rowsWritten, 0),
      bySeason: results,
    });
  } catch (error) {
    console.error('[api/props/game-total-backfill]', error);
    await logSystemEvent({ level: 'error', source: 'api/props/game-total-backfill', message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Total backfill failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
