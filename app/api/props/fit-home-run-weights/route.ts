/**
 * POST /api/props/fit-home-run-weights — Home Run model, Phases 3-5. Same
 * shape as /api/props/fit-weights (moneyline): walks real historical batter
 * game logs, fits `home-run`'s stacking regression, and only activates it if
 * it beats the current live Beta-Binomial baseline on held-out seasons it
 * never trained on. See docs/hr-predictor-plan.md and homeRunModelFit.ts.
 *
 * Defaults to train=[most recent complete season - 1], holdout=[most recent
 * complete season] — a light default given how much slower this is than the
 * team-level moneyline fit (one row per batter-game, not per game, so a
 * single season is already tens of thousands of rows). Accepts the same
 * ?train=2022-2023&holdout=2024 style overrides as fit-weights.
 */

import { NextResponse } from 'next/server';
import { fitHomeRunWeights, currentSeason } from '@/lib/sports/mlb/homeRunModelFit';
import { logSystemEvent } from '@/lib/db/client';

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
  return seasons;
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const latest = currentSeason();
    const trainSeasons = parseSeasonList(searchParams.get('train')) ?? [latest - 1];
    const holdoutSeasons = parseSeasonList(searchParams.get('holdout')) ?? [latest];
    const summary = await fitHomeRunWeights(trainSeasons, holdoutSeasons);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[api/props/fit-home-run-weights]', error);
    logSystemEvent({ level: 'error', source: 'api/props/fit-home-run-weights', message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Home run fitting failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
