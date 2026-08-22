/**
 * POST /api/props/park-factors — (re)computes park factors from a season's
 * own completed games and caches them (park_factors table). Defaults to the
 * current season (the original behavior); accepts ?seasons=2010-2025 style
 * overrides (comma lists and dash ranges) to backfill historical seasons —
 * needed because modelFit.ts's training walk reads park_factors per season,
 * and it's silently neutral (1.0, ~0 weight) for any season that's never
 * been computed here. computeParkFactors itself needs no changes for this —
 * a past, fully-completed season already has a full slate of real games per
 * venue, so the existing single-season computation is already accurate; it
 * just needs to actually be run for every training season, not only the
 * current one.
 *
 * GET /api/props/park-factors — reads whatever's currently cached for a
 * season (defaults to current), for diagnostics display.
 */

import { NextResponse } from 'next/server';
import { refreshParkFactors } from '@/lib/sports/mlb/parkFactors';
import { readParkFactors, logSystemEvent } from '@/lib/db/client';
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
  return [...new Set(seasons)];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = Number(searchParams.get('season')) || Number(easternDate().slice(0, 4));
  const rows = await readParkFactors(season);
  return NextResponse.json({ season, rows: rows.sort((a, b) => b.factor - a.factor) });
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = parseSeasonList(searchParams.get('seasons'));
    const seasons = requested ?? [Number(easternDate().slice(0, 4))];

    const bySeason = [];
    for (const season of seasons) {
      const results = await refreshParkFactors(season);
      bySeason.push({ season, computed: results.length, rows: results.sort((a, b) => b.factor - a.factor) });
    }

    return NextResponse.json({ seasons, bySeason });
  } catch (error) {
    console.error('[api/props/park-factors]', error);
    await logSystemEvent({ level: 'error', source: 'api/props/park-factors', message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Park factor computation failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
