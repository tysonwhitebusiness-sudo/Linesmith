/**
 * POST /api/props/evaluate-total-baselines — read-only diagnostic, writes
 * nothing to model_weights. Answers "how much of the fitted total model's
 * edge is real, versus just inheriting the market's own accuracy": scores
 * formula-alone, market-alone, the pre-Phase-0 blend, and the fitted model
 * on the identical holdout rows. Same default split and override syntax as
 * fit-total-weights.
 */

import { NextResponse } from 'next/server';
import { evaluateTotalHoldoutBaselines } from '@/lib/sports/mlb/modelFit';

export const dynamic = 'force-dynamic';

const DEFAULT_TRAIN_SEASONS = Array.from({ length: 2023 - 2010 + 1 }, (_, i) => 2010 + i);
const DEFAULT_HOLDOUT_SEASONS = [2024, 2025];

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
    const trainSeasons = parseSeasonList(searchParams.get('train')) ?? DEFAULT_TRAIN_SEASONS;
    const holdoutSeasons = parseSeasonList(searchParams.get('holdout')) ?? DEFAULT_HOLDOUT_SEASONS;
    const summary = await evaluateTotalHoldoutBaselines(trainSeasons, holdoutSeasons);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[api/props/evaluate-total-baselines]', error);
    return NextResponse.json(
      { error: 'Evaluation failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
