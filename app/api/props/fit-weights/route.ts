/**
 * POST /api/props/fit-weights — runs Phase 3's stacking regression against
 * real 2010-2025 history (Phase B/C: multi-season walk-forward with real
 * market probability as a feature, split by season rather than by
 * percentage) and, only if it actually beats the current hand-coded formula
 * on the held-out seasons it never trained on, activates it.
 *
 * Defaults to the gameplan's own split — train 2010-2023, holdout 2024-2025
 * — but accepts ?train=2010-2020&holdout=2021,2022 style overrides (comma
 * lists and dash ranges both work) for re-running with a different split.
 */

import { NextResponse } from 'next/server';
import { fitMoneylineWeights } from '@/lib/sports/mlb/modelFit';
import { logSystemEvent } from '@/lib/db/client';

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
    const summary = await fitMoneylineWeights(trainSeasons, holdoutSeasons);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[api/props/fit-weights]', error);
    await logSystemEvent({ level: 'error', source: 'api/props/fit-weights', message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Fitting failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
